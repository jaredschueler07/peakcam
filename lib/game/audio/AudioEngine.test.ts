import assert from "node:assert/strict";
import test from "node:test";
import { AudioEngine, LISTENER_UPDATE_HZ } from "./AudioEngine";
import type { FetchImpl, SampleManifest } from "./SampleLayers";
import { FakeAudioContext, FakeGainNode } from "./testAudioContext";
import type { AudioContextLike, AudioEventName } from "./types";

/**
 * A real DOM AudioContext must satisfy AudioContextLike, or the structural
 * typing that lets the tests inject a stub would be a lie. Type-level only.
 */
const _acceptsRealContext: (ctx: AudioContext) => AudioContextLike = (ctx) => ctx;
void _acceptsRealContext;

function setup(options: ConstructorParameters<typeof AudioEngine>[0] = {}) {
  const ctx = new FakeAudioContext();
  const engine = new AudioEngine({ now: () => 0, ...options });
  engine.init(ctx);
  // init() creates master, music, sfx, procedural, sampleSfx in that order,
  // then the bank's own nodes.
  const gains = ctx.nodesOfKind("gain") as FakeGainNode[];
  return {
    ctx, engine,
    master: gains[0], music: gains[1], sfx: gains[2],
    procedural: gains[3], sampleSfx: gains[4],
  };
}

test("importing the module constructs no AudioContext and reads no audio globals", async () => {
  // Node has no AudioContext; a module that touched one at import time would
  // throw here. Re-imported with a cache-busting query to force evaluation.
  assert.equal("AudioContext" in globalThis, false, "precondition: the test env has no Web Audio");
  const mod = await import(`./index?fresh=${Date.now()}`);
  assert.equal(typeof mod.AudioEngine, "function");
  const engine = new mod.AudioEngine();
  assert.equal(engine.ready, false, "constructing the engine does not create a context either");
});

test("init is gesture-deferred: nothing exists until it is called", () => {
  let factoryCalls = 0;
  const engine = new AudioEngine({
    createContext: () => {
      factoryCalls++;
      return new FakeAudioContext();
    },
  });
  assert.equal(engine.ready, false);
  assert.equal(engine.context, null);
  assert.equal(factoryCalls, 0, "no context is created before the gesture");
  assert.equal(engine.init(), true);
  assert.equal(factoryCalls, 1);
  assert.equal(engine.ready, true);
});

test("init is idempotent", () => {
  const ctx = new FakeAudioContext();
  const engine = new AudioEngine();
  assert.equal(engine.init(ctx), true);
  const nodeCount = ctx.created.length;
  assert.equal(engine.init(ctx), true);
  assert.equal(engine.init(new FakeAudioContext()), true);
  assert.equal(ctx.created.length, nodeCount, "the graph is built exactly once");
  assert.equal(engine.context, ctx);
});

test("init reports failure instead of throwing when Web Audio is unavailable", () => {
  const engine = new AudioEngine({ createContext: () => null });
  assert.equal(engine.init(), false);
  assert.equal(engine.ready, false);
  // Everything still no-ops rather than crashing the run.
  engine.playEvent("crash");
  assert.equal(engine.setListenerState({ speed: 20 }), false);
  engine.setVolume("master", 0.5);
  engine.dispose();
});

test("init survives a context factory that throws", () => {
  const engine = new AudioEngine({
    createContext: () => {
      throw new Error("NotAllowedError: gesture required");
    },
  });
  assert.equal(engine.init(), false);
});

test("the bus graph is master -> destination with music and sfx beneath it", () => {
  const { ctx, master, music, sfx, procedural, sampleSfx } = setup();
  assert.ok(master.connections.includes(ctx.destination));
  assert.ok(music.connections.includes(master));
  assert.ok(sfx.connections.includes(master));
  assert.ok(procedural.connections.includes(sfx));
  assert.ok(sampleSfx.connections.includes(sfx));
  assert.equal(procedural.gain.value, 1, "procedural is the default mix");
  assert.equal(sampleSfx.gain.value, 0, "sample layers start muted until they load");
});

test("initial volumes are applied to the buses and defaults match v1's master", () => {
  const { master, sfx } = setup();
  assert.equal(master.gain.scheduled, 0.85);
  assert.equal(sfx.gain.scheduled, 1);
});

test("caller-supplied volumes and mutes are honoured, including before init", () => {
  const engine = new AudioEngine({ volumes: { master: 0.4, music: 0.1 }, muted: { music: true } });
  assert.equal(engine.getVolume("master"), 0.4);
  engine.setVolume("sfx", 0.25);
  const ctx = new FakeAudioContext();
  engine.init(ctx);
  const [master, music, sfx] = ctx.nodesOfKind("gain") as FakeGainNode[];
  assert.equal(master.gain.scheduled, 0.4, "volume set before init is applied at init");
  assert.equal(music.gain.scheduled, 0, "a muted bus is silent regardless of its volume");
  assert.equal(sfx.gain.scheduled, 0.25);
  assert.equal(engine.getVolume("music"), 0.1, "mute does not clobber the stored volume");
  engine.setMuted("music", false);
  assert.equal(music.gain.scheduled, 0.1, "unmuting restores it");
});

test("volumes clamp to 0..1", () => {
  const { engine } = setup();
  engine.setVolume("sfx", 5);
  assert.equal(engine.getVolume("sfx"), 1);
  engine.setVolume("sfx", -2);
  assert.equal(engine.getVolume("sfx"), 0);
});

test("the global enable flag silences the master bus and drops one-shots", () => {
  const { ctx, engine, master } = setup();
  engine.setEnabled(false);
  assert.equal(engine.isEnabled, false);
  assert.equal(master.gain.scheduled, 0);
  const mark = ctx.created.length;
  engine.playEvent("crash");
  assert.equal(ctx.created.length, mark, "a disabled engine allocates no voices");
  assert.equal(engine.setListenerState({ speed: 30 }, 1000), false);
  engine.setEnabled(true);
  assert.equal(master.gain.scheduled, 0.85, "re-enabling restores the stored volume");
});

test("setListenerState is throttled to the listener update rate", () => {
  const { engine } = setup();
  const step = 1000 / LISTENER_UPDATE_HZ;
  assert.equal(engine.setListenerState({ speed: 10 }, 0), true);
  assert.equal(engine.setListenerState({ speed: 12 }, step - 1), false, "within the window");
  assert.equal(engine.setListenerState({ speed: 14 }, step), true);
});

test("setListenerState merges partial updates and clamps them", () => {
  const { engine } = setup();
  engine.setListenerState({ speed: 20, surface: "ice" }, 0);
  engine.setListenerState({ carve: 4, windLevel: -1, speed: -5 }, 1000);
  assert.deepEqual({ ...engine.listenerState }, {
    speed: 0, carve: 1, airborne: false, surface: "ice", windLevel: 0, liftProximity: 0,
  });
});

test("the throttled state still reaches the wind bed", () => {
  const { ctx, engine } = setup();
  // Bed gains follow the five bus gains created by init().
  const windGain = (ctx.nodesOfKind("gain") as FakeGainNode[])[5];
  engine.setListenerState({ speed: 0 }, 0);
  const idle = windGain.gain.scheduled;
  engine.setListenerState({ speed: 50 }, 1000);
  assert.ok(windGain.gain.scheduled > idle, "speed reached the procedural bank");
});

const EVENT_NAMES: AudioEventName[] = ["jump", "land", "crash", "gate", "trick", "lift", "ui"];

test("every event name produces audible nodes on the sfx side of the graph", () => {
  const { ctx, engine, procedural } = setup();
  for (const name of EVENT_NAMES) {
    const mark = ctx.created.length;
    engine.playEvent(name);
    const made = ctx.created.slice(mark);
    assert.ok(made.length > 0, `${name} produced no nodes`);
    const gains = made.filter((n) => n.kind === "gain");
    assert.ok(gains.length > 0, `${name} has no envelope`);
    for (const gain of gains) {
      assert.ok(gain.connections.includes(procedural), `${name} bypassed the procedural bus`);
    }
  }
});

test("playEvent before init is a no-op", () => {
  const engine = new AudioEngine({ createContext: () => null });
  engine.playEvent("jump");
  assert.equal(engine.ready, false);
});

test("resume and suspend follow the context state", async () => {
  const { ctx, engine } = setup();
  assert.equal(ctx.state, "suspended");
  await engine.resume();
  assert.equal(ctx.resumeCount, 1);
  assert.equal(ctx.state, "running");
  await engine.resume();
  assert.equal(ctx.resumeCount, 1, "resuming a running context is a no-op");
  await engine.suspend();
  assert.equal(ctx.suspendCount, 1);
  await engine.suspend();
  assert.equal(ctx.suspendCount, 1);
});

test("a rejected resume is swallowed", async () => {
  const ctx = new FakeAudioContext();
  ctx.resume = async () => {
    throw new Error("NotAllowedError");
  };
  const engine = new AudioEngine();
  engine.init(ctx);
  await engine.resume();
});

test("resume before init does nothing", async () => {
  const engine = new AudioEngine({ createContext: () => null });
  await engine.resume();
  await engine.suspend();
});

const MANIFEST: SampleManifest = {
  version: 1,
  layers: [{ name: "wind", url: "/game/audio/wind.ogg" }],
};

const okFetch: FetchImpl = async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) });
const badFetch: FetchImpl = async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) });

test("loading sample layers crossfades them in", async () => {
  const { engine, procedural, sampleSfx } = setup();
  const report = await engine.loadSampleLayers(MANIFEST, okFetch);
  assert.equal(report.anyLoaded, true);
  assert.equal(sampleSfx.gain.calls.at(-1)?.value, 1);
  assert.ok((procedural.gain.calls.at(-1)?.value ?? 1) < 1, "the procedural bed ducked");
});

test("a failed sample load leaves the procedural mix untouched and the engine working", async () => {
  const { ctx, engine, procedural, sampleSfx } = setup();
  const report = await engine.loadSampleLayers(MANIFEST, badFetch);
  assert.equal(report.anyLoaded, false);
  assert.equal(procedural.gain.calls.length, 0, "no crossfade was scheduled");
  assert.equal(sampleSfx.gain.value, 0);
  const mark = ctx.created.length;
  engine.playEvent("crash");
  assert.ok(ctx.created.length > mark, "one-shots still play");
  assert.equal(engine.setListenerState({ speed: 30 }, 1000), true);
});

test("loading sample layers before init reports nothing loaded", async () => {
  const engine = new AudioEngine({ createContext: () => null });
  assert.deepEqual(await engine.loadSampleLayers(MANIFEST, okFetch), { anyLoaded: false, results: [] });
});

test("dispose disconnects every node, stops every source and closes an owned context", async () => {
  const ctx = new FakeAudioContext();
  const engine = new AudioEngine({ createContext: () => ctx });
  engine.init();
  await engine.loadSampleLayers(MANIFEST, okFetch);
  engine.playEvent("crash");
  engine.dispose();

  for (const node of ctx.created) {
    assert.ok(node.disconnectCount >= 1, `${node.kind} node survived dispose`);
    const source = node as unknown as { startCount?: number; stopCount?: number };
    if (source.startCount !== undefined) assert.ok((source.stopCount ?? 0) >= 1);
  }
  assert.equal(ctx.closeCount, 1, "a context the engine created is closed");
  assert.equal(engine.ready, false);
});

test("dispose leaves an injected context open — the caller owns it", () => {
  const { ctx, engine } = setup();
  engine.dispose();
  assert.equal(ctx.closeCount, 0);
});

test("a disposed engine cannot be revived and no-ops safely", () => {
  const { ctx, engine } = setup();
  engine.dispose();
  const mark = ctx.created.length;
  assert.equal(engine.init(new FakeAudioContext()), false);
  engine.playEvent("jump");
  engine.setEnabled(true);
  engine.setVolume("master", 1);
  engine.dispose();
  assert.equal(ctx.created.length, mark);
});
