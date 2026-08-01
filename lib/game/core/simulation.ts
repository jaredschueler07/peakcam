import type { ResortGameProfile } from "../config/schema";
import { integrateSkier, preparePhysicsStep } from "../physics/integrator";
import { createSkierState } from "../physics/skier";
import { createProceduralTerrain } from "../terrain/heightfield";
import { cycleTrail, resetSimulation, resetSimulationOnTerrain } from "./run-lifecycle";
import { tickCombo } from "./scoring";
import type { SimulationEvents } from "./events";
import type { InputFrame, SimulationState, SimulationWorld } from "./types";

export function createSimulation(profile: ResortGameProfile, seed: number): SimulationState {
  const state = createSkierState();
  resetSimulationOnTerrain(state, createProceduralTerrain(profile, seed), 0);
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
  integrateSkier(state, input, dt, world);
  return state.events;
}

export { resetSimulation } from "./run-lifecycle";
