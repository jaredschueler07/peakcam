import type { ResortTrail } from "../config/schema";
import { smoothstep } from "../core/math";
import type { NearestTrail } from "../core/types";

export function trailCenter(trail: ResortTrail, z: number): number {
  return trail.off + Math.sin(z * trail.freq + trail.phase) * trail.amp
    + Math.sin(z * trail.freq * 2.71 + trail.phase * 1.9) * trail.amp * 0.26;
}

export function trailField(trails: readonly ResortTrail[], x: number, z: number): number {
  let groomed = 0;
  for (let i = 0; i < trails.length; i += 1) {
    const trail = trails[i];
    const distance = Math.abs(x - trailCenter(trail, z));
    if (distance > trail.half * 1.55) continue;
    const value = smoothstep(1 - (distance - trail.half * 0.42) / (trail.half * 1.13));
    if (value > groomed) groomed = value;
  }
  return groomed;
}

export function nearestTrail(
  trails: readonly ResortTrail[], x: number, z: number, out: NearestTrail,
): NearestTrail {
  let best = 0, bestDistance = 1e9, bestDx = 0;
  for (let i = 0; i < trails.length; i += 1) {
    const dx = x - trailCenter(trails[i], z);
    const distance = Math.abs(dx);
    if (distance < bestDistance) { bestDistance = distance; best = i; bestDx = dx; }
  }
  out.i = best; out.t = trails[best]; out.d = bestDistance; out.dx = bestDx;
  out.on = bestDistance < trails[best].half * 1.35;
  return out;
}
