import type { SimulationState, SimulationWorld } from "./types";
import { createSimulation } from "./simulation";
import { resetSimulationOnTerrain } from "./run-lifecycle";

/** Fresh ranked spawn on every restart; no jump charge, crouch or timer leaks from the last lap. */
export function resetRankedStart(state: SimulationState, world: SimulationWorld): void {
  const fresh = createSimulation(world.profile, world.seed, world.terrain);
  fresh.selectedTrail = state.selectedTrail;
  resetSimulationOnTerrain(fresh, world.terrain);
  // Keep renderer-held vector/event references stable. Allocations occur only at run start.
  const pos = state.pos, vel = state.vel, events = state.events;
  Object.assign(pos, fresh.pos); Object.assign(vel, fresh.vel);
  Object.assign(state, fresh, { pos, vel, events });
}
