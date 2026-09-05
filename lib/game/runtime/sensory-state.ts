import type { SurfaceKind } from "../core/config";
import type { SimulationState, SimulationWorld } from "../core/types";
const normal = { x: 0, y: 1, z: 0 };
const clamp = (x: number) => Math.max(0, Math.min(1, x));
export interface SensoryState { surface: SurfaceKind; windLevel: number; liftProximity: number; signContact: boolean }
/** Renderer/audio-only read of the frozen environment and local terrain; fills caller scratch. */
export function sampleSensoryState(state: SimulationState, world: SimulationWorld, presetWind: number, out: SensoryState): SensoryState {
  const env = world.config.environment;
  const corridor = clamp(world.terrain.trailField(state.pos.x, state.pos.z));
  world.terrain.normal(state.pos.x, state.pos.z, normal);
  const exposure = clamp((1 - normal.y) * 3);
  out.surface = env?.powderDepthCm && corridor < 0.5 ? "powder"
    : env?.morningIce && normal.z * env.northSign > 0.08 && corridor >= 0.5 ? "ice" : world.config.surface;
  out.windLevel = env ? clamp(env.windSpeedMps / 20 * (0.3 + exposure * 0.7)) : clamp(presetWind / 15);
  out.liftProximity = 0;
  if (world.terrain.realLifts) for (const lift of world.terrain.realLifts) {
    if (!lift.stations) continue;
    for (const station of lift.stations) {
      const distance = Math.hypot(state.pos.x - station.x, state.pos.y - station.y, state.pos.z - station.z);
      out.liftProximity = Math.max(out.liftProximity, clamp(1 - distance / 55));
    }
  }
  out.signContact = false;
  if (state.onGround && world.terrain.junctions) for (const j of world.terrain.junctions) {
    const sx = j.x + Math.cos(j.heading) * (j.halfWidthM + 4) - Math.sin(j.heading) * 12;
    const sz = j.z - Math.sin(j.heading) * (j.halfWidthM + 4) - Math.cos(j.heading) * 12;
    if (Math.hypot(state.pos.x - sx, state.pos.z - sz) <= 1.2) { out.signContact = true; break; }
  }
  return out;
}

/** Daily is the signed morning snapshot; fixed Time Trial uses noon. Free Ride uses resort time. */
export function sensoryLocalHour(slug: string, mode: "free_ski" | "time_trial" | "score_attack", now = Date.now()): number {
  if (mode === "score_attack") return 7;
  if (mode === "time_trial") return 12;
  const zone = slug === "breckenridge" ? "America/Denver" : slug === "heavenly" ? "America/Los_Angeles" : "America/Santiago";
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "2-digit", hourCycle: "h23" }).format(now));
}
