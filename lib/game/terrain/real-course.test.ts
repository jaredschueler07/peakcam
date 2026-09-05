import assert from "node:assert/strict";
import { brotliDecompressSync } from "node:zlib";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import type { DropInResortSlug } from "../config/schema";
import { createWorld, getChunk } from "./obstacles";
import { createTerrainSource } from "./terrain-source";
import type { TerrainMeta, TrailsFile } from "./formats";
import type { DrapedRun } from "./real-heightfield";
import { buildRealCourse, nearestPointOnRun, pointAtArcLength } from "./real-course";

function load(slug: DropInResortSlug) {
  const dir = path.join(process.cwd(), "public/game/terrain");
  const packed = brotliDecompressSync(readFileSync(path.join(dir, `${slug}.height.u16.br`)));
  return {
    heightfield: packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength) as ArrayBuffer,
    meta: JSON.parse(readFileSync(path.join(dir, `${slug}.meta.json`), "utf8")) as TerrainMeta,
    trails: JSON.parse(readFileSync(path.join(dir, `${slug}.trails.json`), "utf8")) as TrailsFile,
  };
}

const expectedSelections = {
  "ski-portillo": {
    runs: ["Roca Jack", "Bajada Del Tren", "Plateau", "Garganta", "Super C", "Las Lomas"],
    lift: "Los Canarios",
  },
  breckenridge: {
    runs: ["Horseshoe Bowl", "Imperial Bowl", "Devils Crotch", "4 O'Clock", "Whale's Tail", "Psychopath"],
    lift: "Beaver Run SuperChair",
  },
  heavenly: {
    runs: ["Gunbarrel", "Ridge Run", "Milky Way Bowl", "Mott Canyon Trail", "Olympic Downhill", "Canyonland"],
    lift: "Heavenly Gondola",
  },
} as const;

for (const slug of ["ski-portillo", "breckenridge", "heavenly"] as const) {
  test(`real course selects full downhill named network and deterministic furniture for ${slug}`, () => {
    const profile = DROP_IN_GAME_PROFILES[slug];
    const real = createTerrainSource({ profile, assets: load(slug), mode: "real" }).real!;
    const a = buildRealCourse(profile, real.runs, real.lifts, profile.terrainSeed);
    const b = buildRealCourse(profile, real.runs, real.lifts, profile.terrainSeed);
    assert.ok(a.runs.length >= 6);
    assert.deepEqual(a.runs.slice(0, 6).map((run) => run.name), expectedSelections[slug].runs);
    assert.ok(new Set(a.runs.map((run) => run.name)).size >= 6);
    assert.ok(a.runs.every((run) => run.points[0].y > run.points.at(-1)!.y));
    assert.deepEqual(a, b);
    assert.ok(a.runs.every((run) => run.gates.length > 0));
    assert.ok(a.runs.every((run) => run.finishM === run.lengthM));
    assert.ok(a.mainLift && a.mainLift.points.length >= 2);
    assert.equal(a.mainLift.name, expectedSelections[slug].lift);
  });
}

test("arc-length sampling interpolates real x/z/y geometry instead of a sine corridor", () => {
  const sample = pointAtArcLength([
    { x: 0, y: 100, z: 0 }, { x: 30, y: 90, z: 40 }, { x: 30, y: 80, z: 90 },
  ], 75);
  assert.deepEqual(sample, { x: 30, y: 85, z: 65, heading: 0 });
});

test("arc-length sampling can write into a caller-supplied out object (zero-alloc)", () => {
  const points = [
    { x: 0, y: 100, z: 0 }, { x: 30, y: 90, z: 40 }, { x: 30, y: 80, z: 90 },
  ] as const;
  const out = { x: -1, y: -1, z: -1, heading: -1 };
  const sample = pointAtArcLength(points, 75, out);
  assert.equal(sample, out, "must return the same out object");
  assert.deepEqual(out, { x: 30, y: 85, z: 65, heading: 0 });
});

test("real course skips a flat summit bench before choosing its spawn", () => {
  const flatThenDownhill: DrapedRun = {
    name: "Roca Jack", difficulty: "expert", grooming: null, gladed: false,
    oneway: true, groomed: true, halfWidthM: 14,
    points: [
      { x: 0, y: 100, z: 0 }, { x: 50, y: 100, z: 0 },
      { x: 100, y: 99.8, z: 0 }, { x: 150, y: 92, z: 0 },
      { x: 220, y: 78, z: 0 },
    ],
  };
  const course = buildRealCourse(DROP_IN_GAME_PROFILES["ski-portillo"], [flatThenDownhill], [], 7);
  assert.deepEqual(course.runs[0].points[0], { x: 100, y: 99.8, z: 0 });
});

for (const slug of ["ski-portillo", "breckenridge", "heavenly"] as const) {
  test(`obstacles clear every curated real run corridor for ${slug}`, () => {
    const profile = DROP_IN_GAME_PROFILES[slug];
    const terrain = createTerrainSource({ profile, assets: load(slug), mode: "real" }).sampler;
    const world = createWorld(profile, profile.seed, terrain);
    for (const run of terrain.realRuns ?? []) {
      const xs = run.points.map((point) => point.x);
      const zs = run.points.map((point) => point.z);
      const minCx = Math.floor((Math.min(...xs) - 60) / 120);
      const maxCx = Math.floor((Math.max(...xs) + 60) / 120);
      const minCz = Math.floor((Math.min(...zs) - 60) / 120);
      const maxCz = Math.floor((Math.max(...zs) + 60) / 120);
      for (let cz = minCz; cz <= maxCz; cz += 1) {
        for (let cx = minCx; cx <= maxCx; cx += 1) {
          for (const obstacle of getChunk(world, cx, cz)) {
            const clearance = nearestPointOnRun(run, obstacle.x, obstacle.z).distance - obstacle.r;
            assert.ok(clearance >= run.halfWidthM * 1.2,
              `${slug}/${run.name}: obstacle edge clearance ${clearance.toFixed(2)}m`);
          }
        }
      }
    }
  });
}
