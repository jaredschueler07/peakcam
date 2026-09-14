/**
 * lib/descent/world/loadWorld.ts
 * ──────────────────────────────
 * Fetch a resort's baked assets and build the immutable `World`.
 *
 * Reuses the v2 data path wholesale — `TerrainAssetLoader` (heightfield +
 * trails, brotli undone by the server), `FarFieldAssetLoader` (30 km horizon),
 * and `createTerrainSource` (bicubic sampler with draped runs, lifts,
 * junctions, tree sites). Everything Descent adds is derived here once:
 * courses with start poses and checkpoints, rideable lifts with terminals, a
 * tree spatial hash, and the lake outline for Portillo / Heavenly.
 */

import { TerrainAssetLoader } from "@/lib/game/rendering/loaders/TerrainAssetLoader";
import { FarFieldAssetLoader } from "@/lib/game/rendering/loaders/FarFieldAssetLoader";
import { FAR_FIELD_RADIUS_M } from "@/lib/game/rendering/FarFieldRenderer";
import { createTerrainSource, type RealTerrainAssets } from "@/lib/game/terrain/terrain-source";
import type { DecodedFarField } from "@/lib/game/terrain/far-field-format";
import { RESORT_BAKE_CONFIGS } from "@/lib/game/terrain/resorts";
import { liftSpeed } from "@/lib/game/core/lifts";
import { pointAtArcLength, polylineLength } from "@/lib/game/terrain/real-course";
import { mulberry32 } from "@/lib/game/core/rng";
import type { RealRun } from "@/lib/game/core/types";
import type { DropInResortSlug } from "@/lib/game/config/schema";
import {
  treeCellKey,
  type ConditionsSnapshot, type Course, type CourseGate, type ResortGameProfile, type TreeSite, type World, type WorldLift,
} from "../types";

export interface LoadWorldOptions {
  profile: ResortGameProfile;
  conditions: ConditionsSnapshot;
  seed?: number;
  signal?: AbortSignal;
  onProgress?(fraction: number, label: string): void;
}

const TREE_CELL_M = 16;

export interface LandmarksFile {
  lakes?: Record<string, { name: string; elevationM: number; outer: [number, number][] }>;
}

export async function loadWorld(options: LoadWorldOptions): Promise<World> {
  const { profile, conditions, signal } = options;
  const seed = options.seed ?? profile.terrainSeed;
  const report = options.onProgress ?? (() => {});
  const slug = profile.slug as DropInResortSlug;

  report(0.02, "Reaching the mountain");
  const terrainLoader = new TerrainAssetLoader(fetchWithBrotliFallback);
  const farLoader = new FarFieldAssetLoader(fetchWithBrotliFallback);
  const bake = RESORT_BAKE_CONFIGS[slug];

  const [assets, farField, landmarks] = await Promise.all([
    terrainLoader.load(slug, { signal, onProgress: (p) => report(0.05 + p * 0.6, "Reading the lidar survey") }),
    farLoader.load(slug, { signal, expect: { centre: bake.center, radiusM: FAR_FIELD_RADIUS_M }, onWarn: () => {} }),
    fetch("/game/terrain/landmarks.json", { signal }).then((r) => (r.ok ? (r.json() as Promise<LandmarksFile>) : null)).catch(() => null),
  ]);
  signal?.throwIfAborted();

  report(0.7, "Draping the trail map");
  const world = buildWorld({ profile, conditions, seed, assets, farField, landmarks, onProgress: report });
  report(1, "Ready");
  return world;
}

/**
 * Static `.br` assets carry `Content-Encoding: br`, which browsers only honour
 * over HTTPS. When that fetch fails (plain-HTTP dev on a LAN address, say) the
 * same bytes come back decompressed from the API route instead.
 */
async function fetchWithBrotliFallback(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const isBrotli = /\.br(\?|$)/.test(url);
  try {
    const response = await fetch(input, init);
    if (response.ok || !isBrotli) return response;
  } catch (error) {
    if (!isBrotli) throw error;
  }
  const file = url.split("?")[0].split("/").pop() ?? "";
  return fetch(`/api/drop-in/terrain/${encodeURIComponent(file)}`, { signal: init?.signal });
}

export interface BuildWorldOptions {
  profile: ResortGameProfile;
  conditions: ConditionsSnapshot;
  seed: number;
  assets: RealTerrainAssets;
  farField: DecodedFarField | null;
  landmarks: LandmarksFile | null;
  onProgress?(fraction: number, label: string): void;
}

/** Pure: everything after the network. Tests call this with assets read from disk. */
export function buildWorld(options: BuildWorldOptions): World {
  const { profile, conditions, seed, assets, farField, landmarks } = options;
  const report = options.onProgress ?? (() => {});
  const slug = profile.slug as DropInResortSlug;
  const bake = RESORT_BAKE_CONFIGS[slug];
  const source = createTerrainSource({ profile, assets, mode: "real", seed });
  const terrain = source.real!;

  report(0.82, "Cutting the lines");
  const courses = (terrain.realRuns ?? []).filter((run) => run.points.length >= 2 && run.lengthM >= 60)
    .map((run) => toCourse(run, (x, z) => terrain.height(x, z)));

  const lifts: WorldLift[] = (terrain.realLifts ?? []).map((lift, index) => {
    const stations = lift.stations ?? [];
    const first = lift.points[0], last = lift.points[lift.points.length - 1];
    const bottom = stations.length === 2 ? stations[0] : { ...first, radiusM: 12 };
    const top = stations.length === 2 ? stations[1] : { ...last, radiusM: 12 };
    const lo = bottom.y <= top.y ? bottom : top;
    const hi = bottom.y <= top.y ? top : bottom;
    return {
      index,
      lift,
      name: lift.name,
      rideable: lift.complete !== false && lift.points.length >= 2 && lift.lengthM > 40,
      base: { x: lo.x, y: terrain.height(lo.x, lo.z), z: lo.z, radiusM: lo.radiusM },
      top: { x: hi.x, y: terrain.height(hi.x, hi.z), z: hi.z, radiusM: hi.radiusM },
      speedMps: liftSpeed(lift),
    };
  });

  report(0.9, "Planting the forest");
  const random = mulberry32(seed ^ 0x5eed);
  const treeLineM = bake.treeLineElevationM;
  const trees: TreeSite[] = [];
  for (const site of terrain.treeSites ?? []) {
    if (treeLineM > 0 && site.y > treeLineM) continue;
    const variant = random();
    const heightM = 5 + variant * 9;
    trees.push({ x: site.x, y: site.y, z: site.z, radiusM: Math.max(0.35, Math.min(0.9, site.radiusM * 0.5)), heightM, variant });
  }
  const treeCells = new Map<number, number[]>();
  for (let i = 0; i < trees.length; i++) {
    const key = treeCellKey(Math.floor(trees[i].x / TREE_CELL_M), Math.floor(trees[i].z / TREE_CELL_M));
    let list = treeCells.get(key);
    if (!list) { list = []; treeCells.set(key, list); }
    list.push(i);
  }

  const lakeEntry = landmarks?.lakes?.[slug];
  const lakes = lakeEntry
    ? [{ name: lakeEntry.name, elevationM: lakeEntry.elevationM, outer: lakeEntry.outer.map(([x, y]) => ({ x, z: -y })) }]
    : [];

  return {
    profile,
    conditions,
    seed,
    terrain,
    sampler: terrain,
    halfSizeM: terrain.field.sizeM / 2,
    courses,
    lifts,
    junctions: terrain.junctions ?? [],
    trees,
    treeCells,
    treeCellM: TREE_CELL_M,
    farField,
    lakes,
    treeLineM,
  };
}

/**
 * A mapped line's first vertex often sits on a ridge, on a few metres of rise
 * before the fall line. The gate moves down the line to the first point where
 * the DEM says "sustained downhill", but never more than this far — the
 * leaderboard validator accepts a start within 60 m of the mapped vertex.
 */
const MAX_START_SHIFT_M = 45;
const START_LOOK_M = 30;
const START_MIN_GRADE = 0.05;

function shiftStart(run: RealRun, height: (x: number, z: number) => number): RealRun {
  const points = run.points;
  if (points.length < 2 || run.lengthM < START_LOOK_M + 10) return run;
  let shift = 0;
  for (let s = 0; s <= MAX_START_SHIFT_M; s += 5) {
    const a = pointAtArcLength(points, s), b = pointAtArcLength(points, s + START_LOOK_M);
    const drop = height(a.x, a.z) - height(b.x, b.z);
    if (drop / START_LOOK_M >= START_MIN_GRADE) { shift = s; break; }
    if (s === MAX_START_SHIFT_M) shift = s;
  }
  if (shift === 0) return run;
  const start = pointAtArcLength(points, shift);
  // Drop vertices before the new start and splice the start in.
  let walked = 0, cut = 1;
  for (let i = 1; i < points.length; i++) {
    walked += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    if (walked > shift) { cut = i; break; }
    cut = i + 1;
  }
  const trimmed = [{ x: start.x, y: height(start.x, start.z), z: start.z }, ...points.slice(cut).map((p) => ({ ...p }))];
  if (trimmed.length < 2) return run;
  const lengthM = polylineLength(trimmed);
  const gates = run.gates.map((gate) => ({ ...gate, distanceM: gate.distanceM - shift })).filter((gate) => gate.distanceM > 20 && gate.distanceM < lengthM - 20);
  return { ...run, points: trimmed, lengthM, finishM: lengthM, gates, topElevationM: trimmed[0].y };
}

function toCourse(source: RealRun, height: (x: number, z: number) => number): Course {
  const run = shiftStart(source, height);
  const first = run.points[0], second = run.points[1];
  const last = run.points[run.points.length - 1], penultimate = run.points[run.points.length - 2];
  const gates: CourseGate[] = run.gates.map((gate) => ({
    distanceM: gate.distanceM, x: gate.x, y: gate.y, z: gate.z, heading: gate.heading, halfWidthM: gate.halfWidthM,
  }));
  return {
    id: run.id ?? `run:${run.sourceIndex}`,
    name: run.name,
    difficulty: run.difficulty,
    run,
    gates,
    lengthM: run.lengthM,
    topElevationM: run.topElevationM ?? first.y,
    bottomElevationM: run.bottomElevationM ?? last.y,
    start: { x: first.x, y: first.y, z: first.z, yaw: Math.atan2(second.x - first.x, second.z - first.z) },
    finish: { x: last.x, y: last.y, z: last.z, yaw: Math.atan2(last.x - penultimate.x, last.z - penultimate.z) },
  };
}
