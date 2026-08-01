import type { RunDefinition } from "../config/modes";
import { trailCenter } from "../terrain/trails";
import type { SimulationState, SimulationWorld, TerrainSampler } from "./types";
import { LIFT_DURATION, LIFT_VERTICAL } from "../physics/constants";

export type RunStatus = "ready" | "running" | "finished";
export type RunEndReason = "finish" | "timeout";

export interface RunLifecycle {
  readonly definition: RunDefinition;
  status: RunStatus;
  elapsedMs: number;
  endReason: RunEndReason | null;
}

export function createRunLifecycle(definition: RunDefinition): RunLifecycle {
  return { definition, status: "ready", elapsedMs: 0, endReason: null };
}

export function startRun(lifecycle: RunLifecycle): boolean {
  if (lifecycle.status !== "ready") return false;
  lifecycle.status = "running";
  return true;
}

export function updateRunLifecycle(
  lifecycle: RunLifecycle, state: SimulationState,
): RunEndReason | null {
  if (lifecycle.status !== "running") return null;
  lifecycle.elapsedMs = state.time * 1000;
  const { startZ, finishZ, durationLimitMs } = lifecycle.definition;
  const crossedFinish = finishZ >= startZ ? state.pos.z >= finishZ : state.pos.z <= finishZ;
  let reason: RunEndReason | null = crossedFinish ? "finish" : null;
  if (!reason && durationLimitMs !== undefined && lifecycle.elapsedMs >= durationLimitMs) {
    reason = "timeout";
  }
  if (reason) {
    lifecycle.status = "finished";
    lifecycle.endReason = reason;
  }
  return reason;
}

export function resetSimulationOnTerrain(
  state: SimulationState, terrain: TerrainSampler, z0 = 0,
): void {
  const x0 = trailCenter(terrain.profile.trails[state.selectedTrail], z0);
  state.pos.x = x0; state.pos.y = terrain.height(x0, z0); state.pos.z = z0;
  state.vel.x = 0; state.vel.y = 0; state.vel.z = 15;
  state.yaw = 0; state.onGround = true; state.airTime = 0; state.spin = 0;
  state.crash = 0; state.best = Math.max(state.best, state.score); state.score = 0;
  state.combo = 1; state.comboTimer = 0; state.time = 0; state.startY = state.pos.y;
  state.invuln = 1; state.distance = 0; state.passedGates.clear();
  state.events.reset = true;
}

export function resetSimulation(state: SimulationState, world: SimulationWorld, z0 = 0): void {
  resetSimulationOnTerrain(state, world.terrain, z0);
}

export function cycleTrail(state: SimulationState, world: SimulationWorld): void {
  if (state.liftRide > 0) return;
  state.selectedTrail = (state.selectedTrail + 1) % world.profile.trails.length;
  resetSimulation(state, world, 0);
  state.events.trailChanged = true;
}

export function beginLiftRide(state: SimulationState): void {
  if (state.crash > 0) return;
  state.liftRide = LIFT_DURATION;
  state.liftFromZ = state.pos.z;
  state.liftToZ = Math.max(0, state.pos.z - LIFT_VERTICAL);
  state.vel.x = 0; state.vel.y = 0; state.vel.z = 0;
  state.crash = 0; state.onGround = false;
}
