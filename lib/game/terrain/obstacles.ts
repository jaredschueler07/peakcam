import type { ResortGameProfile } from "../config/schema";
import { clamp01, TAU } from "../core/math";
import { hashInt, mulberry32 } from "../core/rng";
import type { Obstacle, SimulationWorld, Vec3 } from "../core/types";
import { createProceduralTerrain } from "./heightfield";
import { fbm } from "./noise";

export const CHUNK_SIZE = 120;
const normalScratch: Vec3 = { x: 0, y: 1, z: 0 };

export function createProceduralWorld(profile: ResortGameProfile, seed: number): SimulationWorld {
  return { profile, seed, terrain: createProceduralTerrain(profile, seed), chunks: new Map() };
}

export function getChunk(world: SimulationWorld, cx: number, cz: number): Obstacle[] {
  const key = `${cx}:${cz}`;
  let chunk = world.chunks.get(key);
  if (chunk) return chunk;
  const { profile, terrain } = world;
  const random = mulberry32(hashInt(cx * 7919 + world.seed, cz * 104729 + world.seed));
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
      type = "tree";
    }
    if (type === "rock" && random() > profile.forest.rockKeep) continue;
    const s = type === "tree"
      ? (0.72 + random() * 1.05) * profile.forest.treeScale
      : 0.7 + random() * 2.3;
    chunk.push({
      x, y, z, s, rot: random() * TAU, type,
      r: type === "tree" ? 1.15 * Math.min(1.6, s) : 1.1 * s,
    });
  }
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
