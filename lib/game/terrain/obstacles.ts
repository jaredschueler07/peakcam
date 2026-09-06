import type { ResortGameProfile } from "../config/schema";
import { clamp01, TAU } from "../core/math";
import { hashInt, mulberry32 } from "../core/rng";
import type { NearestTrail, Obstacle, SimulationWorld, Vec3 } from "../core/types";
import { simulationConfig, type SimulationConfig } from "../core/config";
import { createProceduralTerrain } from "./heightfield";
import { fbm } from "./noise";

export const CHUNK_SIZE = 120;
const forestChunks = new WeakMap<SimulationWorld, Map<string, Obstacle[]>>();
const normalScratch: Vec3 = { x: 0, y: 1, z: 0 };

export function createProceduralWorld(
  profile: ResortGameProfile, seed: number, config: SimulationConfig = simulationConfig(),
): SimulationWorld {
  return { profile, seed, terrain: createProceduralTerrain(profile, seed), config, chunks: new Map() };
}

export function createWorld(
  profile: ResortGameProfile, seed: number, terrain: SimulationWorld["terrain"],
  config: SimulationConfig = simulationConfig(),
): SimulationWorld {
  const world: SimulationWorld = { profile, seed, terrain, config, chunks: new Map() };
  if (terrain.kind === "real" && terrain.treeSites) {
    const buckets = new Map<string, Obstacle[]>();
    for (const site of terrain.treeSites) {
      const key = `${Math.floor(site.x / CHUNK_SIZE)}:${Math.floor(site.z / CHUNK_SIZE)}`;
      const random = mulberry32(hashInt(Math.round(site.x * 10) + seed, Math.round(site.z * 10)));
      const scale = (0.72 + random() * 1.05) * profile.forest.treeScale;
      const obstacle: Obstacle = { x: site.x, y: site.y, z: site.z, s: scale,
        r: 1.15 * Math.min(1.6, scale), rot: random() * TAU, type: "tree" };
      const bucket = buckets.get(key);
      if (bucket) bucket.push(obstacle); else buckets.set(key, [obstacle]);
    }
    forestChunks.set(world, buckets);
  }
  return world;
}

export function getChunk(world: SimulationWorld, cx: number, cz: number): Obstacle[] {
  const key = `${cx}:${cz}`;
  let chunk = world.chunks.get(key);
  if (chunk) return chunk;
  const { profile, terrain } = world;
  const random = mulberry32(hashInt(cx * 7919 + world.seed, cz * 104729 + world.seed));
  const nearest: NearestTrail = {
    i: -1, t: { kind: "procedural", trail: profile.trails[0] }, d: Infinity, dx: 0, on: false,
  };
  chunk = [];
  for (let i = 0; i < 34; i += 1) {
    const x = cx * CHUNK_SIZE + random() * CHUNK_SIZE;
    const z = cz * CHUNK_SIZE + random() * CHUNK_SIZE;
    if (terrain.trailField(x, z) > 0.015) continue;
    const density = fbm((x + terrain.noiseOffset.x) * 0.0038,
      (z + terrain.noiseOffset.z) * 0.0038, 2);
    const y = terrain.height(x, z);
    terrain.normal(x, z, normalScratch);
    const steep = 1 - normalScratch.y;
    let type: Obstacle["type"];
    if (steep > 0.30) type = "rock";
    else if (random() < profile.forest.rockBias) type = "rock";
    else {
      if (density < profile.forest.treeline) continue;
      if (random() > clamp01((density - (profile.forest.treeline - 0.04)) * 3.1)) continue;
      if (terrain.kind === "real" && terrain.treeSites) continue;
      type = "tree";
    }
    if (type === "rock" && random() > profile.forest.rockKeep) continue;
    const s = type === "tree"
      ? (0.72 + random() * 1.05) * profile.forest.treeScale
      : 0.7 + random() * 2.3;
    const r = type === "tree" ? 1.15 * Math.min(1.6, s) : 1.1 * s;
    if (terrain.kind === "real") {
      terrain.nearestTrail(x, z, nearest);
      if (nearest.t.kind === "real" && nearest.d - r < nearest.t.run.halfWidthM * 1.2) continue;
    }
    chunk.push({
      x, y, z, s, rot: random() * TAU, type,
      r,
    });
  }
  const forest = forestChunks.get(world)?.get(key);
  if (forest) for (const tree of forest) chunk.push(tree);
  world.chunks.set(key, chunk);
  if (world.chunks.size > 700) {
    let count = 0;
    for (const oldKey of world.chunks.keys()) {
      world.chunks.delete(oldKey);
      count += 1;
      if (count > 200) break;
    }
  }
  return chunk;
}

export function forEachObstacleNear(
  world: SimulationWorld, x: number, z: number, radius: number,
  callback: (obstacle: Obstacle) => void,
): void {
  const c0x = Math.floor((x - radius) / CHUNK_SIZE), c1x = Math.floor((x + radius) / CHUNK_SIZE);
  const c0z = Math.floor((z - radius) / CHUNK_SIZE), c1z = Math.floor((z + radius) / CHUNK_SIZE);
  for (let cz = c0z; cz <= c1z; cz += 1) {
    for (let cx = c0x; cx <= c1x; cx += 1) {
      const chunk = getChunk(world, cx, cz);
      for (let i = 0; i < chunk.length; i += 1) callback(chunk[i]);
    }
  }
}
