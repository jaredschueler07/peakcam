import { COURSE_VERSION } from "../../config/versions";
import assert from "node:assert/strict";
import test from "node:test";
import { HEIGHTFIELD_ORIENTATION, type TerrainMeta, type TrailsFile } from "../../terrain/formats";
import { TerrainAssetLoader } from "./TerrainAssetLoader";
import { assertAcceptableReceivers, receiverCheckingFetch } from "./fetch-receiver.fixture";

const meta: TerrainMeta = {
  version: 1, slug: "heavenly", center: [38.9404, -119.912], sizeM: 16, grid: 2,
  minZ: 1900, maxZ: 1901, quantum: 0.1, source: "terrarium", sourceZoom: 14,
  demSource: { kind: "terrarium" }, epsg: null, sourceResolutionM: 7,
  orientation: HEIGHTFIELD_ORIENTATION, bakedAt: "2026-08-01T00:00:00.000Z",
};
const trails: TrailsFile = {
  v: 1, center: meta.center, sizeM: meta.sizeM, unit: 0.1,
  runs: [{ n: "Gunbarrel", p: [0, 0, 10, 10] }], lifts: [],
};

test("terrain loader fetches the three public pack files and reports byte-weighted progress", async () => {
  const requested: string[] = [];
  const bodyByUrl = new Map<string, BodyInit>([
    [`/game/terrain/heavenly.meta.json?course=${COURSE_VERSION}`, JSON.stringify(meta)],
    [`/game/terrain/heavenly.trails.json?course=${COURSE_VERSION}`, JSON.stringify(trails)],
    [`/game/terrain/heavenly.height.u16.br?course=${COURSE_VERSION}`, new Uint8Array(8)],
  ]);
  const progress: number[] = [];
  const loader = new TerrainAssetLoader(async (input) => {
    const url = String(input); requested.push(url);
    const body = bodyByUrl.get(url);
    assert.notEqual(body, undefined);
    return new Response(body, { status: 200 });
  });

  const assets = await loader.load("heavenly", { onProgress: (value) => progress.push(value) });

  assert.deepEqual(requested, [
    `/game/terrain/heavenly.meta.json?course=${COURSE_VERSION}`,
    `/game/terrain/heavenly.trails.json?course=${COURSE_VERSION}`,
    `/game/terrain/heavenly.height.u16.br?course=${COURSE_VERSION}`,
  ]);
  assert.equal(assets.heightfield.byteLength, 8);
  assert.equal(assets.meta.slug, "heavenly");
  assert.equal(assets.trails.runs[0].n, "Gunbarrel");
  assert.equal(progress.at(-1), 1);
  assert.ok(progress.every((value, index) => index === 0 || value >= progress[index - 1]));
  assert.ok(progress.some((value) => value > 0 && value < 1));
});

test("terrain loader aborts all in-flight pack requests", async () => {
  const loader = new TerrainAssetLoader((_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  }));
  const pending = loader.load("heavenly");
  loader.abort();
  await assert.rejects(pending, (reason) => reason instanceof DOMException && reason.name === "AbortError");
});

test("the terrain fetcher is also invoked with a receiver real fetch accepts", async () => {
  // This loader is correct today only by accident of call shape: it hands the fetcher to a free
  // helper (`checked`), which calls it unbound. A refactor to `this.fetcher(...)` would break it
  // exactly as it broke FarFieldAssetLoader — a browser-only `TypeError: Illegal invocation` that
  // no plain-function fake can see. Pin it here so the refactor fails in CI instead.
  const bodies = new Map<string, BodyInit>([
    [`/game/terrain/heavenly.meta.json?course=${COURSE_VERSION}`, JSON.stringify(meta)],
    [`/game/terrain/heavenly.trails.json?course=${COURSE_VERSION}`, JSON.stringify(trails)],
    [`/game/terrain/heavenly.height.u16.br?course=${COURSE_VERSION}`, new Uint8Array(8)],
  ]);
  const recorded = receiverCheckingFetch((url) => new Response(bodies.get(url) ?? "", { status: bodies.has(url) ? 200 : 404 }));

  const assets = await new TerrainAssetLoader(recorded.fetcher).load("heavenly");

  assertAcceptableReceivers(recorded, "TerrainAssetLoader");
  assert.equal(recorded.urls.length, 3);
  assert.equal(assets.meta.slug, "heavenly");
});

test("the terrain loader's default fetcher survives being called as a method", () => {
  const loader = new TerrainAssetLoader() as unknown as { fetcher: { name: string } };
  assert.equal(loader.fetcher.name, "bound fetch");
});

test("height and trails begin while metadata is unresolved, using matching preload fetch credentials", async () => {
  const pending = new Map<string, (response: Response) => void>();
  const loader = new TerrainAssetLoader((input, init) => {
    assert.equal(init?.mode, "cors"); assert.equal(init?.credentials, "same-origin");
    return new Promise(resolve => pending.set(String(input), resolve));
  });
  const promise = loader.load("heavenly");
  assert.equal(pending.size, 3, "metadata must not gate either large request");
  pending.get(`/game/terrain/heavenly.height.u16.br?course=${COURSE_VERSION}`)!(new Response(new Uint8Array(8)));
  pending.get(`/game/terrain/heavenly.trails.json?course=${COURSE_VERSION}`)!(new Response(JSON.stringify(trails)));
  pending.get(`/game/terrain/heavenly.meta.json?course=${COURSE_VERSION}`)!(new Response(JSON.stringify(meta)));
  assert.equal((await promise).heightfield.byteLength, 8);
});

test("a failed pack response cancels both peer requests and pre-abort fetches nothing", async () => {
  const peerSignals: AbortSignal[] = [];
  const loader = new TerrainAssetLoader((input, init) => {
    if (String(input).includes("meta.json")) return Promise.resolve(new Response("missing", { status: 404 }));
    peerSignals.push(init!.signal!);
    return new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true }));
  });
  await assert.rejects(loader.load("heavenly"), /404/);
  assert.equal(peerSignals.length, 2); assert.ok(peerSignals.every(signal => signal.aborted));
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  await assert.rejects(new TerrainAssetLoader(async () => { calls++; return new Response(); }).load("heavenly", { signal: controller.signal }), { name: "AbortError" });
  assert.equal(calls, 0);
});
