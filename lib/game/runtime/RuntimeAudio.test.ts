import assert from "node:assert/strict";
import test from "node:test";
import { AudioEngine } from "../audio/AudioEngine";
import { FakeAudioContext } from "../audio/testAudioContext";
import { createSimulationEvents } from "../core/events";
import { RuntimeAudio } from "./RuntimeAudio";

test("runtime audio initializes only when the Start hook is invoked", () => {
  let contexts = 0;
  const audio = new RuntimeAudio(() => new AudioEngine({
    createContext: () => { contexts += 1; return new FakeAudioContext(); },
  }));
  assert.equal(contexts, 0);
  assert.equal(audio.start(), true);
  assert.equal(contexts, 1);
});

test("simulation events map to typed audio events and disposal closes owned audio", async () => {
  const context = new FakeAudioContext();
  const played: Array<[string, string | undefined]> = [];
  const engine = new AudioEngine({ createContext: () => context });
  const originalPlay = engine.playEvent.bind(engine);
  engine.playEvent = (name, options) => { played.push([name, options?.variant]); originalPlay(name, options); };
  const audio = new RuntimeAudio(() => engine);
  audio.start();
  const events = createSimulationEvents();
  Object.assign(events, {
    jumped: true, landed: true, landingKind: "soft", crashed: true,
    crashReason: "TREE", gatePassed: true, gateMissed: true, trickLanded: true,
    liftFinished: true,
  });
  audio.playSimulationEvents(events);
  audio.playLift();
  audio.playUi("confirm");
  assert.deepEqual(played, [
    ["jump", undefined], ["land", "soft"], ["crash", undefined],
    ["gate", "hit"], ["gate", "miss"], ["trick", undefined],
    ["lift", undefined], ["ui", "confirm"],
  ]);
  audio.dispose();
  await Promise.resolve();
  assert.equal(context.state, "closed");
});

test("listener updates carry the complete conditions and simulation state", () => {
  const engine = new AudioEngine({ createContext: () => new FakeAudioContext() });
  const audio = new RuntimeAudio(() => engine);
  audio.start();
  audio.updateListener({ speed: 22, carve: 0.6, onGround: false, liftRide: 2 }, "ice", 0.8, 100);
  assert.deepEqual(engine.listenerState, {
    speed: 22, carve: 0.6, airborne: true, surface: "ice",
    windLevel: 0.8, liftProximity: 1,
  });
});

test("sample loading begins after init and reuses the runtime teardown signal", async () => {
  const context = new FakeAudioContext();
  const engine = new AudioEngine({ createContext: () => context });
  const audio = new RuntimeAudio(() => engine);
  const controller = new AbortController();
  const calls: Array<{ url: string; signal: AbortSignal | undefined; ready: boolean }> = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, signal: init?.signal ?? undefined, ready: engine.ready });
    if (url.endsWith("manifest.json")) return new Response(JSON.stringify({
      version: 1,
      layers: [
        { name: "wind-bed", url: "/game/audio/wind-bed.ogg", fallbackUrl: "/game/audio/wind-bed.m4a", gain: 1, loop: true, bus: "sfx" },
        { name: "jump-whoosh", url: "/game/audio/jump-whoosh.ogg", fallbackUrl: "/game/audio/jump-whoosh.m4a", gain: 1, loop: false, bus: "sfx" },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  };
  assert.equal(calls.length, 0);
  audio.start();
  const sourcesBeforeSamples = context.nodesOfKind("bufferSource").length;
  await audio.loadSamples(controller.signal, fetchImpl as typeof fetch);
  assert.equal(context.nodesOfKind("bufferSource").length, sourcesBeforeSamples + 1, "the decoded procedural-enrichment bed starts immediately");
  const jump = createSimulationEvents(); jump.jumped = true;
  audio.playSimulationEvents(jump);
  assert.equal(context.nodesOfKind("bufferSource").length, sourcesBeforeSamples + 3, "jump plays both procedural noise and its decoded sample");
  assert.deepEqual(calls.map(({ ready }) => ready), [true, true, true]);
  assert.equal(calls[0].signal, controller.signal);
  controller.abort();
  assert.deepEqual(calls.map(({ signal }) => signal?.aborted), [true, true, true]);
});
