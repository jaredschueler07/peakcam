import type { ResortGameProfile } from "../config/schema";
import { clamp01, normalize, smoothstep } from "../core/math";
import { mulberry32 } from "../core/rng";
import type { NearestTrail, TerrainSampler, Vec3 } from "../core/types";
import { fbm } from "./noise";
import { nearestTrail, trailCenter, trailField } from "./trails";

export const RAMP_SPACING = 430;
export const RAMP_LEN = 22;
export const RAMP_W = 10.5;
export const RAMP_H = 7;

export function createProceduralTerrain(profile: ResortGameProfile, seed: number): TerrainSampler {
  const random = mulberry32(seed);
  const noiseOffset = { x: 1000 + random() * 90000, z: 1000 + random() * 90000 };

  function rampHeight(x: number, z: number): number {
    let sum = 0;
    for (let i = 0; i < profile.trails.length; i += 1) {
      const trail = profile.trails[i];
      const k = Math.round((z - trail.ramp) / RAMP_SPACING);
      if (k < 0) continue;
      const dz = z - (trail.ramp + k * RAMP_SPACING);
      if (dz < 0 || dz > RAMP_LEN + 3.5) continue;
      const dx = Math.abs(x - trailCenter(trail, z));
      if (dx > RAMP_W) continue;
      const lateral = smoothstep(1 - dx / RAMP_W);
      const rise = clamp01(dz / RAMP_LEN);
      let shape = rise * rise;
      if (dz > RAMP_LEN) shape *= clamp01(1 - (dz - RAMP_LEN) / 3.5);
      sum += RAMP_H * shape * lateral;
    }
    return sum;
  }

  function baseHeight(x: number, z: number): number {
    const nx = x + noiseOffset.x, nz = z + noiseOffset.z;
    let height = -z * profile.fall;
    height += (fbm(nx * 0.00160, nz * 0.00030, 3) - 0.5) * 165 * profile.relief;
    height += (fbm(nx * 0.00740, nz * 0.00120, 3) - 0.5) * 36 * profile.relief;
    return height;
  }

  function height(x: number, z: number): number {
    const groomed = trailField(profile.trails, x, z);
    let value = baseHeight(x, z);
    const nx = x + noiseOffset.x, nz = z + noiseOffset.z;
    const detail = (fbm(nx * 0.049, nz * 0.038, 3) - 0.5) * 2.6
      + (fbm(nx * 0.168, nz * 0.140, 2) - 0.5) * 0.45;
    value += detail * (1 - 0.88 * groomed);
    value -= groomed * 0.75;
    value += rampHeight(x, z);
    return value;
  }

  function normal(x: number, z: number, out: Vec3): Vec3 {
    const epsilon = 0.9;
    const hL = height(x - epsilon, z), hR = height(x + epsilon, z);
    const hD = height(x, z - epsilon), hU = height(x, z + epsilon);
    out.x = hL - hR; out.y = 2 * epsilon; out.z = hD - hU;
    return normalize(out);
  }

  return {
    kind: "procedural", profile, seed, noiseOffset, height, normal,
    trailField: (x, z) => trailField(profile.trails, x, z),
    nearestTrail: (x: number, z: number, out: NearestTrail) =>
      nearestTrail(profile.trails, x, z, out),
  };
}
