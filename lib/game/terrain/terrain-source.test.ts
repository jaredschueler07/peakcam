import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { brotliDecompressSync } from "node:zlib";

import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import type { TerrainMeta, TrailsFile } from "./formats";
import { createProceduralTerrain } from "./heightfield";
import { createTerrainSource, type RealTerrainAssets } from "./terrain-source";

const profile = DROP_IN_GAME_PROFILES["ski-portillo"];

function loadPortilloAssets(): RealTerrainAssets {
  const dir = path.join(process.cwd(), "public", "game", "terrain");
  const raw = brotliDecompressSync(readFileSync(path.join(dir, "ski-portillo.height.u16.br")));
  return {
    heightfield: raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer,
    meta: JSON.parse(
      readFileSync(path.join(dir, "ski-portillo.meta.json"), "utf8"),
    ) as TerrainMeta,
    trails: JSON.parse(
      readFileSync(path.join(dir, "ski-portillo.trails.json"), "utf8"),
    ) as TrailsFile,
  };
}

test("without assets the source is the v1-parity procedural terrain", () => {
  const source = createTerrainSource({ profile });
  assert.strictEqual(source.kind, "procedural");
  assert.strictEqual(source.real, null);

  // Bit-identical to constructing the procedural terrain directly — the parity
  // path must not change shape just because it now comes through the factory.
  const reference = createProceduralTerrain(profile, profile.terrainSeed);
  const a = { x: 0, y: 0, z: 0 }, b = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 200; i += 1) {
    const x = -300 + i * 3.1;
    const z = -400 + i * 7.3;
    assert.strictEqual(source.sampler.height(x, z), reference.height(x, z));
    assert.deepStrictEqual(
      source.sampler.normal(x, z, a), reference.normal(x, z, b),
    );
    assert.strictEqual(source.sampler.trailField(x, z), reference.trailField(x, z));
  }
});

test("with assets the source is the real terrain", () => {
  const assets = loadPortilloAssets();
  const source = createTerrainSource({ profile, assets });
  assert.strictEqual(source.kind, "real");
  assert.ok(source.real);
  assert.strictEqual(source.real.meta.slug, "ski-portillo");
  assert.strictEqual(source.sampler, source.real);
  assert.ok(Number.isFinite(source.sampler.height(0, 0)));
  // The real path really is a different surface from the procedural one.
  const procedural = createProceduralTerrain(profile, profile.terrainSeed);
  assert.notStrictEqual(source.sampler.height(0, 0), procedural.height(0, 0));
});

test("mode forces or forbids the real path", () => {
  const assets = loadPortilloAssets();
  assert.strictEqual(createTerrainSource({ profile, assets, mode: "procedural" }).kind, "procedural");
  assert.strictEqual(createTerrainSource({ profile, assets, mode: "real" }).kind, "real");
  assert.throws(
    () => createTerrainSource({ profile, mode: "real" }),
    /without baked assets/,
  );
});

test("assets baked for another resort are rejected", () => {
  const assets = loadPortilloAssets();
  assert.throws(
    () => createTerrainSource({ profile: DROP_IN_GAME_PROFILES.breckenridge, assets }),
    /baked assets are for ski-portillo/,
  );
});

test("micro-detail options flow through to the real terrain", () => {
  const assets = loadPortilloAssets();
  const loud = createTerrainSource({ profile, assets, microDetail: { amplitudeM: 0.8 } });
  const quiet = createTerrainSource({ profile, assets, microDetail: { amplitudeM: 0.3 } });
  assert.ok(loud.real && quiet.real);
  let loudPeak = 0, quietPeak = 0;
  for (let i = 0; i < 500; i += 1) {
    const x = -200 + i * 0.83;
    const z = 150 - i * 1.11;
    loudPeak = Math.max(loudPeak, Math.abs(loud.real.microDetail(x, z)));
    quietPeak = Math.max(quietPeak, Math.abs(quiet.real.microDetail(x, z)));
  }
  assert.ok(loudPeak > quietPeak * 2);
  assert.ok(loudPeak <= 0.8 + 1e-12);
  assert.ok(quietPeak <= 0.3 + 1e-12);
});
