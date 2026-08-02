import assert from "node:assert/strict";
import test from "node:test";
import { HEIGHTFIELD_ORIENTATION, type TerrainMeta, type TrailsFile } from "../../terrain/formats";
import { TerrainAssetLoader } from "./TerrainAssetLoader";

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
    ["/game/terrain/heavenly.meta.json", JSON.stringify(meta)],
    ["/game/terrain/heavenly.trails.json", JSON.stringify(trails)],
    ["/game/terrain/heavenly.height.u16.br", new Uint8Array(8)],
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
    "/game/terrain/heavenly.meta.json",
    "/game/terrain/heavenly.trails.json",
    "/game/terrain/heavenly.height.u16.br",
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
