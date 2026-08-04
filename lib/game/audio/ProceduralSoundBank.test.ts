import assert from "node:assert/strict";
import test from "node:test";
import { EVENT_RECIPES, ProceduralSoundBank } from "./ProceduralSoundBank";
import {
  FakeAudioContext,
  FakeBiquadFilterNode,
  FakeGainNode,
  FakeOscillatorNode,
} from "./testAudioContext";
import { createListenerState, type AudioEventName, type ListenerState } from "./types";

function setup() {
  const ctx = new FakeAudioContext();
  const destination = new FakeGainNode();
  const bank = new ProceduralSoundBank(ctx, destination);
  // Nodes created by the constructor, in wiring order.
  const gains = ctx.created.filter((n) => n instanceof FakeGainNode) as FakeGainNode[];
  const filters = ctx.created.filter((n) => n instanceof FakeBiquadFilterNode) as FakeBiquadFilterNode[];
  return {
    ctx, destination, bank,
    windGain: gains[0], edgeGain: gains[1], liftGain: gains[2],
    windFilter: filters[0], edgeFilter: filters[1],
  };
}

function listener(overrides: Partial<ListenerState>): ListenerState {
  return { ...createListenerState(), ...overrides };
}

/** Gains/filters created after the constructor's beds — i.e. by one-shots. */
function newNodesSince<T>(ctx: FakeAudioContext, mark: number, kind: string): T[] {
  return ctx.created.slice(mark).filter((n) => n.kind === kind) as unknown as T[];
}

test("the constructor wires three beds into the destination and starts every source", () => {
  const { ctx, destination, windGain, edgeGain, liftGain } = setup();
  const intoDestination = ctx.created.filter((n) => n.connections.includes(destination));
  assert.deepEqual(
    intoDestination, [windGain, edgeGain, liftGain],
    "wind, edge and lift beds each terminate at the destination",
  );
  for (const gain of [windGain, edgeGain, liftGain]) {
    assert.equal(gain.gain.value, 0, "beds start silent");
    assert.ok(gain.connections.includes(destination));
  }
  const sources = ctx.nodesOfKind("bufferSource");
  const oscillators = ctx.nodesOfKind("oscillator");
  assert.equal(sources.length, 2, "wind + edge noise sources");
  assert.equal(oscillators.length, 3, "saw + sine hum, plus the wobble LFO");
  for (const node of [...sources, ...oscillators]) {
    assert.equal((node as unknown as { startCount: number }).startCount, 1);
  }
});

test("wind gain and cutoff rise monotonically with speed", () => {
  const { bank, windGain, windFilter } = setup();
  const gains: number[] = [];
  const cutoffs: number[] = [];
  for (const speed of [0, 5, 12, 25, 40, 55, 80]) {
    bank.setListenerState(listener({ speed }));
    gains.push(windGain.gain.scheduled);
    cutoffs.push(windFilter.frequency.scheduled);
  }
  for (let i = 1; i < gains.length; i++) {
    assert.ok(gains[i] >= gains[i - 1], `wind gain must not fall between steps ${i - 1} and ${i}`);
    assert.ok(cutoffs[i] >= cutoffs[i - 1], `wind cutoff must not fall between steps ${i - 1} and ${i}`);
  }
  assert.ok(gains[0] > 0, "there is a floor of wind even at rest");
  assert.ok(gains[5] > gains[0] * 5, "full speed is dramatically windier than rest");
  assert.equal(gains[5], gains[6], "speed saturates at the 55 m/s reference");
});

test("ambient wind level adds on top of the speed term", () => {
  const { bank, windGain } = setup();
  bank.setListenerState(listener({ speed: 20, windLevel: 0 }));
  const calm = windGain.gain.scheduled;
  bank.setListenerState(listener({ speed: 20, windLevel: 1 }));
  assert.ok(windGain.gain.scheduled > calm, "a storm preset is louder at the same speed");
});

test("edge gain tracks carve and is cut entirely while airborne", () => {
  const { bank, edgeGain } = setup();
  bank.setListenerState(listener({ speed: 20, carve: 0 }));
  assert.equal(edgeGain.gain.scheduled, 0, "no edge noise when running flat");
  bank.setListenerState(listener({ speed: 20, carve: 0.5 }));
  const half = edgeGain.gain.scheduled;
  bank.setListenerState(listener({ speed: 20, carve: 1 }));
  const full = edgeGain.gain.scheduled;
  assert.ok(half > 0 && full > half, "harder carves are louder");
  bank.setListenerState(listener({ speed: 20, carve: 1, airborne: true }));
  assert.equal(edgeGain.gain.scheduled, 0, "airborne kills the edge layer");
});

test("surface switches the edge filter type, resonance and brightness", () => {
  const { bank, edgeFilter, edgeGain } = setup();
  bank.setListenerState(listener({ speed: 20, carve: 0.8, surface: "powder" }));
  assert.equal(edgeFilter.type, "lowpass", "powder is a soft lowpassed hiss");
  const powderHz = edgeFilter.frequency.scheduled;
  const powderGain = edgeGain.gain.scheduled;

  bank.setListenerState(listener({ speed: 20, carve: 0.8, surface: "packed" }));
  assert.equal(edgeFilter.type, "bandpass");

  bank.setListenerState(listener({ speed: 20, carve: 0.8, surface: "ice" }));
  assert.equal(edgeFilter.type, "bandpass", "ice is a bandpassed scrape");
  assert.ok(edgeFilter.frequency.scheduled > powderHz, "ice scrapes brighter than powder hisses");
  assert.ok(edgeGain.gain.scheduled > powderGain, "ice scrapes louder than powder");
  assert.ok(edgeFilter.Q.value > 1, "the scrape is resonant");
});

test("lift proximity drives the machinery hum", () => {
  const { bank, liftGain } = setup();
  bank.setListenerState(listener({ liftProximity: 0 }));
  assert.equal(liftGain.gain.scheduled, 0);
  bank.setListenerState(listener({ liftProximity: 1 }));
  assert.equal(liftGain.gain.scheduled, 0.075, "matches the v1 hum level");
});

test("burst() reproduces the v1 noise recipe", () => {
  const { ctx, bank, destination } = setup();
  const mark = ctx.created.length;
  ctx.currentTime = 4;
  bank.burst(0.22, 320, 0.3, "lowpass");

  const [source] = newNodesSince<{ loop: boolean; buffer: unknown; startCount: number; stopCount: number }>(ctx, mark, "bufferSource");
  const [filter] = newNodesSince<FakeBiquadFilterNode>(ctx, mark, "biquad");
  const [gain] = newNodesSince<FakeGainNode>(ctx, mark, "gain");
  assert.ok(source.buffer, "bursts reuse the shared noise buffer");
  assert.equal(source.loop, true);
  assert.equal(filter.type, "lowpass");
  assert.equal(filter.frequency.value, 320);
  assert.equal(gain.gain.peak, 0.22);
  assert.deepEqual(
    gain.gain.calls.map((c) => c.time),
    [4, 4.012, 4.3],
    "attack at 12ms, decay over the stated duration",
  );
  assert.equal(source.startCount, 1);
  assert.equal(source.stopCount, 1);
  assert.ok(gain.connections.includes(destination));
});

test("blip() reproduces the v1 rising triangle", () => {
  const { ctx, bank } = setup();
  const mark = ctx.created.length;
  bank.blip(760, 0.14, 0.13);
  const [osc] = newNodesSince<FakeOscillatorNode>(ctx, mark, "oscillator");
  const [gain] = newNodesSince<FakeGainNode>(ctx, mark, "gain");
  assert.equal(osc.type, "triangle");
  assert.deepEqual(osc.frequency.calls.map((c) => c.value), [760, 760 * 1.9], "sweeps up ~an octave");
  assert.equal(gain.gain.peak, 0.14);
});

const EXPECTED_RECIPES: ReadonlyArray<{
  name: AudioEventName;
  variant?: string;
  bufferSources: number;
  oscillators: number;
  peaks: number[];
}> = [
  { name: "jump", bufferSources: 1, oscillators: 0, peaks: [0.16] },
  { name: "land", bufferSources: 2, oscillators: 0, peaks: [0.22, 0.09] },
  { name: "land", variant: "soft", bufferSources: 1, oscillators: 0, peaks: [0.09] },
  { name: "crash", bufferSources: 2, oscillators: 0, peaks: [0.36, 0.22] },
  { name: "gate", bufferSources: 0, oscillators: 1, peaks: [0.14] },
  { name: "gate", variant: "miss", bufferSources: 0, oscillators: 1, peaks: [0.12] },
  { name: "lift", bufferSources: 1, oscillators: 0, peaks: [0.18] },
  { name: "trick", bufferSources: 0, oscillators: 1, peaks: [0.12] },
  { name: "ui", bufferSources: 0, oscillators: 1, peaks: [0.06] },
];

for (const expected of EXPECTED_RECIPES) {
  const label = expected.variant ? `${expected.name}/${expected.variant}` : expected.name;
  test(`playEvent("${label}") builds the expected node recipe`, () => {
    const { ctx, bank } = setup();
    const mark = ctx.created.length;
    bank.playEvent(expected.name, { variant: expected.variant });
    assert.equal(newNodesSince(ctx, mark, "bufferSource").length, expected.bufferSources);
    assert.equal(newNodesSince(ctx, mark, "oscillator").length, expected.oscillators);
    const gains = newNodesSince<FakeGainNode>(ctx, mark, "gain");
    assert.deepEqual(gains.map((g) => g.gain.peak), expected.peaks);
  });
}

test("every name in the event vocabulary has a default recipe", () => {
  for (const [name, variants] of Object.entries(EVENT_RECIPES)) {
    assert.ok(variants.default?.length, `${name} needs a default variant`);
  }
});

test("an unknown variant falls back to the default recipe", () => {
  const { ctx, bank } = setup();
  const mark = ctx.created.length;
  bank.playEvent("gate", { variant: "nonsense" });
  const gains = newNodesSince<FakeGainNode>(ctx, mark, "gain");
  assert.deepEqual(gains.map((g) => g.gain.peak), [0.14]);
});

test("the gain option scales a recipe and zero drops it entirely", () => {
  const { ctx, bank } = setup();
  let mark = ctx.created.length;
  bank.playEvent("jump", { gain: 0.5 });
  assert.equal((newNodesSince<FakeGainNode>(ctx, mark, "gain")[0] as FakeGainNode).gain.peak, 0.08);
  mark = ctx.created.length;
  bank.playEvent("jump", { gain: 0 });
  assert.equal(ctx.created.length, mark, "a silent event allocates nothing");
});

test("finished one-shot voices are swept as new ones are played", () => {
  const { ctx, bank } = setup();
  bank.playEvent("gate");
  assert.equal(bank.activeVoiceCount, 1);
  ctx.currentTime = 10;
  bank.playEvent("gate");
  assert.equal(bank.activeVoiceCount, 1, "the expired voice was reaped, not accumulated");
});

test("dispose stops every source and disconnects every node, including live one-shots", () => {
  const { ctx, bank } = setup();
  bank.playEvent("crash");
  const nodes = ctx.created;
  bank.dispose();
  for (const node of nodes) {
    assert.ok(node.disconnectCount >= 1, `${node.kind} node was left connected`);
    const schedulable = node as unknown as { stopCount?: number; startCount?: number };
    if (schedulable.startCount !== undefined) {
      assert.ok((schedulable.stopCount ?? 0) >= 1, `${node.kind} source was left running`);
    }
  }
});

test("a disposed bank ignores further calls", () => {
  const { ctx, bank } = setup();
  bank.dispose();
  const mark = ctx.created.length;
  bank.setListenerState(listener({ speed: 40, carve: 1 }));
  bank.playEvent("crash");
  bank.burst(0.5, 400, 0.2, "lowpass");
  bank.blip(400, 0.2, 0.2);
  assert.equal(ctx.created.length, mark, "no nodes are created after dispose");
});

test("dispose is idempotent", () => {
  const { ctx, bank } = setup();
  bank.dispose();
  const counts = ctx.created.map((n) => n.disconnectCount);
  bank.dispose();
  assert.deepEqual(ctx.created.map((n) => n.disconnectCount), counts);
});

test("the shared noise buffer is two seconds of the v1 brown-ish noise", () => {
  const ctx = new FakeAudioContext(16000);
  const bank = new ProceduralSoundBank(ctx, new FakeGainNode());
  const source = ctx.nodesOfKind("bufferSource")[0] as unknown as { buffer: { length: number; getChannelData(i: number): Float32Array } };
  assert.equal(source.buffer.length, 32000);
  const data = source.buffer.getChannelData(0);
  assert.ok(data.some((v: number) => v !== 0), "the buffer was filled");
  bank.dispose();
});

test("setListenerState uses setTargetAtTime so 15Hz updates still glide", () => {
  const { bank, windGain } = setup();
  bank.setListenerState(listener({ speed: 30 }));
  const methods = new Set((windGain.gain.calls as ReadonlyArray<{ method: string }>).map((c) => c.method));
  assert.deepEqual([...methods], ["setTargetAtTime"]);
});
