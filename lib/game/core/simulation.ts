import { prepareLiftPath } from "./lifts";
import type { ResortGameProfile } from "../config/schema";
import { integrateSkier, preparePhysicsStep } from "../physics/integrator";
import { integrateSkierV2 } from "../physics/integrator-v2";
import { createSkierState } from "../physics/skier";
import { createProceduralTerrain } from "../terrain/heightfield";
import { cycleTrail, resetSimulation, resetSimulationOnTerrain } from "./run-lifecycle";
import { tickCombo } from "./scoring";
import type { SimulationEvents } from "./events";
import type { InputFrame, SimulationState, SimulationWorld, TerrainSampler } from "./types";

export function createSimulation(
  profile: ResortGameProfile, seed: number, terrain?: TerrainSampler,
): SimulationState {
  for (const lift of terrain?.realLifts ?? []) prepareLiftPath(lift, terrain!.height);
  const state = createSkierState();
  resetSimulationOnTerrain(state, terrain ?? createProceduralTerrain(profile, seed), 0);
  state.events.reset = false;
  return state;
}

export function stepSimulation(
  state: SimulationState, input: InputFrame, dt: number, world: SimulationWorld,
): SimulationEvents {
  preparePhysicsStep(state);
  if (input.restartPressed) {
    resetSimulation(state, world, 0);
    return state.events;
  }
  if (input.trailPressed) {
    cycleTrail(state, world);
    return state.events;
  }
  state.time += dt;
  tickCombo(state, dt);
  (world.config.physicsModel === "v2" ? integrateSkierV2 : integrateSkier)(state, input, dt, world);
  return state.events;
}

export { resetSimulation } from "./run-lifecycle";
