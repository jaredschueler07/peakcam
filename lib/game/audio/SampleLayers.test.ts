import assert from "node:assert/strict";
import test from "node:test";
import { SampleLayers, type FetchImpl, type SampleManifest } from "./SampleLayers";
import { FakeAudioBuffer, FakeAudioContext, FakeGainNode } from "./testAudioContext";

const MANIFEST: SampleManifest = {
  version: 1,
  layers: [
    { name: "wind-alpine", url: "/game/audio/wind-alpine.ogg", gain: 0.8, loop: true, bus: "sfx" },
    { name: "lift-hum", url: "/game/audio/lift-hum.ogg", bus: "sfx" },
    { name: "ambience", url: "/game/audio/portillo.ogg", gain: 0.5, bus: "music" },
  ],
};

function setup() {
  const ctx = new FakeAudioContext();
  const proceduralGain = new FakeGainNode();
  const sampleGain = new FakeGainNode();
  const musicBus = new FakeGainNode();
  const layers = new SampleLayers({
    ctx, proceduralGain, sampleGain, buses: { sfx: sampleGain, music: musicBus },
  });
  return { ctx, proceduralGain, sampleGain, musicBus, layers };
}

/** A fetch that succeeds for every url unless it is listed in `failing`. */
function fakeFetch(failing: string[] = [], options: { status?: number; throwOn?: string[] } = {}): FetchImpl {
  return async (url) => {
    if (options.throwOn?.some((u) => url.includes(u))) throw new TypeError("network down");
    const ok = !failing.some((u) => url.includes(u));
    return {
      ok,
      status: ok ? 200 : (options.status ?? 404),
      arrayBuffer: async () => new ArrayBuffer(16),
    };
  };
}

test("a manifest loads every layer", async () => {
  const { layers } = setup();
  const report = await layers.loadLayers(MANIFEST, fakeFetch());
  assert.equal(report.anyLoaded, true);
  assert.deepEqual(report.results.map((r) => r.status), ["loaded", "loaded", "loaded"]);
  assert.deepEqual(layers.loadedLayerNames, ["wind-alpine", "lift-hum", "ambience"]);
});

test("layer gain and defaults come from the manifest", async () => {
  const { ctx, layers, sampleGain, musicBus } = setup();
  await layers.loadLayers(MANIFEST, fakeFetch());
  const created = ctx.nodesOfKind("gain") as FakeGainNode[];
  assert.deepEqual(created.map((g) => g.gain.value), [0.8, 1, 0.5], "omitted gain defaults to 1");
  assert.ok(created[0].connections.includes(sampleGain), "sfx layers feed the crossfade gain");
  assert.ok(created[2].connections.includes(musicBus), "music layers feed the music bus directly");
});

test("a failed fetch is isolated: the other layers still load and the engine stays usable", async () => {
  const { layers } = setup();
  const report = await layers.loadLayers(MANIFEST, fakeFetch(["lift-hum"], { status: 503 }));
  assert.equal(report.anyLoaded, true, "one bad layer does not sink the load");
  assert.deepEqual(report.results.map((r) => `${r.name}:${r.status}`), [
    "wind-alpine:loaded", "lift-hum:failed", "ambience:loaded",
  ]);
  assert.equal(report.results[1].reason, "HTTP 503");
  assert.equal(layers.play("lift-hum"), false, "a layer that failed simply does not play");
  assert.equal(layers.play("wind-alpine"), true);
});

test("a thrown fetch is reported, not propagated", async () => {
  const { layers } = setup();
  const report = await layers.loadLayers(MANIFEST, fakeFetch([], { throwOn: ["wind-alpine"] }));
  assert.equal(report.results[0].status, "failed");
  assert.equal(report.results[0].reason, "network down");
  assert.equal(report.anyLoaded, true);
});

test("a decode failure is reported per layer", async () => {
  const { ctx, layers } = setup();
  ctx.decodeAudioData = async () => {
    throw new Error("EncodingError");
  };
  const report = await layers.loadLayers(MANIFEST, fakeFetch());
  assert.deepEqual(report.results.map((r) => r.status), ["failed", "failed", "failed"]);
  assert.equal(report.anyLoaded, false);
  assert.deepEqual(layers.loadedLayerNames, []);
});

test("every layer fails cleanly when the environment has no fetch", async () => {
  const { layers } = setup();
  const original = globalThis.fetch;
  Reflect.deleteProperty(globalThis, "fetch");
  try {
    const report = await layers.loadLayers(MANIFEST);
    assert.equal(report.anyLoaded, false);
    assert.deepEqual(
      report.results.map((r) => r.reason),
      ["no fetch implementation", "no fetch implementation", "no fetch implementation"],
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("abort() cancels in-flight loads and marks them aborted", async () => {
  const { layers } = setup();
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const slowFetch: FetchImpl = async (_url, init) => {
    await gate;
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => {
        if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        return new ArrayBuffer(16);
      },
    };
  };
  const pending = layers.loadLayers(MANIFEST, slowFetch);
  layers.abort();
  release?.();
  const report = await pending;
  assert.deepEqual(report.results.map((r) => r.status), ["aborted", "aborted", "aborted"]);
  assert.equal(report.anyLoaded, false);
});

test("an external signal aborts the load too", async () => {
  const { layers } = setup();
  const controller = new AbortController();
  controller.abort();
  const report = await layers.loadLayers(MANIFEST, fakeFetch(), controller.signal);
  assert.deepEqual(report.results.map((r) => r.status), ["aborted", "aborted", "aborted"]);
});

test("starting a new load supersedes an in-flight one", async () => {
  const { layers } = setup();
  const signals: AbortSignal[] = [];
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const gated: FetchImpl = async (_url, init) => {
    if (init?.signal) signals.push(init.signal);
    if (signals.length <= MANIFEST.layers.length) await gate;
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(16) };
  };
  const first = layers.loadLayers(MANIFEST, gated);
  const second = layers.loadLayers(MANIFEST, gated);
  release?.();
  const [firstReport, secondReport] = await Promise.all([first, second]);
  assert.ok(signals[0].aborted, "the superseded load was cancelled");
  assert.ok(firstReport.results.every((r) => r.status === "aborted"));
  assert.equal(secondReport.anyLoaded, true, "the newer load still completes");
});

test("setMix crossfades: procedural ducks but never goes silent", () => {
  const { ctx, layers, proceduralGain, sampleGain } = setup();
  ctx.currentTime = 2;
  assert.equal(sampleGain.gain.value, 0, "samples start silent");

  layers.setMix(1, 1.5);
  assert.equal(layers.currentMix, 1);
  const sampleRamp = sampleGain.gain.calls.at(-1);
  const proceduralRamp = proceduralGain.gain.calls.at(-1);
  assert.deepEqual(sampleRamp, { method: "linearRampToValueAtTime", value: 1, time: 3.5 });
  assert.equal(proceduralRamp?.value, 0.35, "the reactive bed stays audible under the samples");
  assert.equal(proceduralRamp?.time, 3.5);
  assert.ok(
    proceduralGain.gain.calls.some((c) => c.method === "cancelScheduledValues"),
    "an in-flight fade is cancelled before the new ramp",
  );

  layers.setMix(0, 0.5);
  assert.equal(sampleGain.gain.calls.at(-1)?.value, 0);
  assert.equal(proceduralGain.gain.calls.at(-1)?.value, 1, "back to procedural-only");
});

test("setMix clamps out-of-range values", () => {
  const { layers } = setup();
  layers.setMix(4);
  assert.equal(layers.currentMix, 1);
  layers.setMix(-1);
  assert.equal(layers.currentMix, 0);
});

test("play() restarts a layer rather than stacking sources", async () => {
  const { ctx, layers } = setup();
  await layers.loadLayers(MANIFEST, fakeFetch());
  layers.play("wind-alpine");
  const first = ctx.nodesOfKind("bufferSource").at(-1) as unknown as { stopCount: number; loop: boolean };
  assert.equal(first.loop, true);
  layers.play("wind-alpine");
  assert.equal(first.stopCount, 1, "the previous source was stopped");
  assert.equal(ctx.nodesOfKind("bufferSource").length, 2);
});

test("dispose stops sources, disconnects layer gains and blocks further work", async () => {
  const { ctx, layers } = setup();
  await layers.loadLayers(MANIFEST, fakeFetch());
  layers.play("wind-alpine");
  const source = ctx.nodesOfKind("bufferSource").at(-1) as unknown as { stopCount: number };
  const gains = ctx.nodesOfKind("gain");
  layers.dispose();
  assert.equal(source.stopCount, 1);
  for (const gain of gains) assert.equal(gain.disconnectCount, 1);
  assert.deepEqual(layers.loadedLayerNames, []);
  assert.equal(layers.play("wind-alpine"), false);
  const report = await layers.loadLayers(MANIFEST, fakeFetch());
  assert.deepEqual(report, { anyLoaded: false, results: [] });
});

test("an empty manifest is a no-op, not an error", async () => {
  const { layers } = setup();
  const report = await layers.loadLayers({ version: 1, layers: [] }, fakeFetch());
  assert.deepEqual(report, { anyLoaded: false, results: [] });
});

test("the decoded buffer is kept for playback", async () => {
  const { ctx, layers } = setup();
  const buffer = new FakeAudioBuffer(2, 64, ctx.sampleRate);
  ctx.decodeAudioData = async () => buffer;
  await layers.loadLayers({ version: 1, layers: [{ name: "one", url: "/a.ogg" }] }, fakeFetch());
  layers.play("one");
  const source = ctx.nodesOfKind("bufferSource").at(-1) as unknown as { buffer: unknown };
  assert.equal(source.buffer, buffer);
});

test("continuous levels fade existing loops without creating new sources", async () => {
  const { ctx, layers } = setup();
  await layers.loadLayers(MANIFEST, fakeFetch());
  layers.setLayerLevel("wind-alpine", 0, true);
  layers.play("wind-alpine");
  const count = ctx.nodesOfKind("bufferSource").length;
  const gain = (ctx.nodesOfKind("gain") as FakeGainNode[])[0].gain;
  assert.equal(gain.value, 0);
  layers.setLayerLevel("wind-alpine", 0.5);
  assert.equal(gain.scheduled, 0.4);
  layers.setLayerLevel("wind-alpine", 100);
  assert.equal(gain.scheduled, 0.8);
  layers.setLayerLevel("wind-alpine", -1);
  assert.equal(gain.scheduled, 0);
  assert.equal(ctx.nodesOfKind("bufferSource").length, count);
});
