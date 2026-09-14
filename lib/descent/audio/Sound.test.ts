import { test } from "node:test";
import assert from "node:assert";
import { FakeAudioContext, FakeGainNode } from "@/lib/game/audio/testAudioContext";
import { Sound, type SoundEvent, type SoundState } from "./Sound";

function state(overrides: Partial<SoundState> = {}): SoundState {
  return {
    speed: 0, onGround: true, edge: 0, surface: "packed", braking: false, tucked: false, crashed: false,
    wind: 2, corridor: 1, liftRiding: false, ...overrides,
  };
}

const EVENTS: SoundEvent[] = ["pop", "land", "landHard", "crash", "trick", "gate", "ui", "liftBoard", "finish", "countdown", "go"];

test("without an AudioContext every call is a silent no-op", () => {
  const sound = new Sound(() => null);
  assert.doesNotThrow(() => { sound.unlock(); sound.update(state({ speed: 20 }), 1 / 60); for (const e of EVENTS) sound.play(e); sound.setEnabled(false); sound.dispose(); });
});

test("unlock builds the graph once, plays every event, and disposes cleanly", () => {
  const ctx = new FakeAudioContext();
  const sound = new Sound(() => ctx);
  sound.unlock();
  sound.unlock();
  assert.strictEqual(ctx.nodesOfKind("bufferSource").length, 1, "one looping noise source");
  assert.strictEqual(ctx.resumeCount >= 1, true);
  assert.doesNotThrow(() => { for (const e of EVENTS) sound.play(e); });
  assert.ok(ctx.nodesOfKind("oscillator").length > 0);
  sound.dispose();
  assert.strictEqual(ctx.closeCount, 1);
  assert.doesNotThrow(() => sound.update(state(), 1 / 60));
});

test("wind gain target rises with speed", () => {
  const ctx = new FakeAudioContext();
  const sound = new Sound(() => ctx);
  sound.unlock();
  const gains = ctx.nodesOfKind("gain") as FakeGainNode[];
  const wind = gains[1]; // master, then wind, edge, skid, hush
  sound.update(state({ speed: 0 }), 1 / 60);
  const slow = wind.gain.scheduled;
  sound.update(state({ speed: 30 }), 1 / 60);
  const fast = wind.gain.scheduled;
  assert.ok(fast > slow, `wind ${fast} should exceed ${slow}`);
});

test("edge layer is silent in the air and follows the surface", () => {
  const ctx = new FakeAudioContext();
  const sound = new Sound(() => ctx);
  sound.unlock();
  const gains = ctx.nodesOfKind("gain") as FakeGainNode[];
  const edge = gains[2];
  const filters = ctx.nodesOfKind("biquad");
  sound.update(state({ speed: 25, edge: 0.9, surface: "ice" }), 1 / 60);
  assert.ok(edge.gain.scheduled > 0);
  const iceFreq = (filters[1] as unknown as { frequency: { scheduled: number } }).frequency.scheduled;
  sound.update(state({ speed: 25, edge: 0.9, surface: "powder" }), 1 / 60);
  const powderFreq = (filters[1] as unknown as { frequency: { scheduled: number } }).frequency.scheduled;
  assert.ok(iceFreq > powderFreq);
  sound.update(state({ speed: 25, edge: 0.9, onGround: false }), 1 / 60);
  assert.strictEqual(edge.gain.scheduled, 0);
});

test("setEnabled drives the master gain", () => {
  const ctx = new FakeAudioContext();
  const sound = new Sound(() => ctx);
  sound.unlock();
  const master = ctx.nodesOfKind("gain")[0] as FakeGainNode;
  sound.setEnabled(false);
  assert.strictEqual(sound.enabled, false);
  assert.strictEqual(master.gain.scheduled, 0);
  sound.setEnabled(true);
  assert.strictEqual(master.gain.scheduled, 1);
});
