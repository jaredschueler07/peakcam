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
  const realRun = terrain.kind === "real" ? terrain.realRuns?.[state.selectedTrail] : undefined;
  let x0: number, startZ: number, yaw: number;
  if (realRun) {
    const start = realRun.points[0], next = realRun.points[1];
    x0 = start.x; startZ = start.z; yaw = Math.atan2(next.x - start.x, next.z - start.z);
  } else {
    x0 = trailCenter(terrain.profile.trails[state.selectedTrail], z0); startZ = z0; yaw = 0;
  }
  state.pos.x = x0; state.pos.y = terrain.height(x0, startZ); state.pos.z = startZ;
  state.vel.x = Math.sin(yaw) * 15; state.vel.y = 0; state.vel.z = Math.cos(yaw) * 15;
  state.yaw = yaw; state.onGround = true; state.airTime = 0; state.spin = 0;
  state.liftIndex = -1; state.liftProgress = 0; state.liftDistanceM = 0; state.liftCooldown = 0; state.liftRide = 0;
  state.edgeAngle = 0; state.landingTimer = 0;
  state.crash = 0; state.best = Math.max(state.best, state.score); state.score = 0;
  state.combo = 1; state.comboTimer = 0; state.time = 0; state.startY = state.pos.y;
  state.invuln = 1; state.distance = 0; state.courseProgress = 0;
  state.prevCourseProgress = 0; state.finished = false; state.prevX = x0; state.prevZ = startZ;
  state.passedGates.clear();
  state.events.reset = true;
}

export function resetSimulation(state: SimulationState, world: SimulationWorld, z0 = 0): void {
  resetSimulationOnTerrain(state, world.terrain, z0);
}

export function cycleTrail(state: SimulationState, world: SimulationWorld): void {
  if (state.liftRide > 0) return;
  const count = world.terrain.kind === "real" ? world.terrain.realRuns?.length ?? 0 : world.profile.trails.length;
  state.selectedTrail = (state.selectedTrail + 1) % Math.max(1, count);
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
