import { lerp, length, lengthSq, normalize, setVec3, TAU } from "../core/math";
import { addScore, bumpCombo } from "../core/scoring";
import type { SimulationState, SimulationWorld, Vec3 } from "../core/types";
import { CHUNK_SIZE, getChunk } from "../terrain/obstacles";
import { trailCenter } from "../terrain/trails";
import { nearestPointOnRun } from "../terrain/real-course";
import { GATE_SPACING } from "./constants";

const runPointScratch = { distance: 0, progressM: 0, x: 0, z: 0 };
const forwardScratch: Vec3 = { x: 0, y: 0, z: 0 };
const flatScratch: Vec3 = { x: 0, y: 0, z: 0 };
const nearestScratch = { i: 0, t: null!, d: 0, dx: 0, on: false };

export function crash(state: SimulationState, reason: "TREE" | "ROCK" | "LANDING"): void {
  if (state.crash > 0) return;
  state.crash = 1.7; state.combo = 1; state.comboTimer = 0;
  state.vel.x *= 0.32; state.vel.y *= 0.32; state.vel.z *= 0.32;
  state.vel.y = 5.5;
  state.events.crashed = true; state.events.crashReason = reason;
  state.events.comboChanged = true;
}

export function onLand(state: SimulationState, impactSpeed: number, impactThresholdMultiplier = 1): void {
  state.events.landed = true;
  state.events.landingKind = impactSpeed < 18 ? "soft" : "hard";
  if (state.airTime > 0.28) {
    state.events.trickLanded = true;
    const spins = Math.floor(state.spin / TAU);
    const airPoints = Math.round(state.airTime * 130);
    setVec3(forwardScratch, Math.sin(state.yaw), 0, Math.cos(state.yaw));
    setVec3(flatScratch, state.vel.x, 0, state.vel.z);
    const align = lengthSq(flatScratch) > 0.01
      ? (normalize(flatScratch), flatScratch.x * forwardScratch.x +
          flatScratch.y * forwardScratch.y + flatScratch.z * forwardScratch.z)
      : 1;
    const badLanding = align < 0.25 && impactSpeed > 22 * impactThresholdMultiplier;
    if (badLanding && state.invuln <= 0) {
      crash(state, "LANDING");
      return;
    }
    let points = airPoints;
    if (spins >= 1) points += spins * 320;
    addScore(state, points);
    bumpCombo(state);
  }
  state.airTime = 0; state.spin = 0;
}

export function checkObstacleCollision(state: SimulationState, world: SimulationWorld): void {
  if (state.invuln > 0 || state.crash > 0) return;
  const radius = 4;
  const c0x = Math.floor((state.pos.x - radius) / CHUNK_SIZE);
  const c1x = Math.floor((state.pos.x + radius) / CHUNK_SIZE);
  const c0z = Math.floor((state.pos.z - radius) / CHUNK_SIZE);
  const c1z = Math.floor((state.pos.z + radius) / CHUNK_SIZE);
  for (let cz = c0z; cz <= c1z; cz += 1) {
    for (let cx = c0x; cx <= c1x; cx += 1) {
      const chunk = getChunk(world, cx, cz);
      for (let i = 0; i < chunk.length; i += 1) {
        const obstacle = chunk[i];
        const dx = obstacle.x - state.pos.x, dz = obstacle.z - state.pos.z;
        const radiusSum = obstacle.r + 0.8;
        if (dx * dx + dz * dz < radiusSum * radiusSum &&
          state.pos.y < obstacle.y + (obstacle.type === "tree" ? 6 : 2.2) * obstacle.s) {
          crash(state, obstacle.type === "tree" ? "TREE" : "ROCK");
          return;
        }
      }
    }
  }
}

export function checkGates(state: SimulationState, world: SimulationWorld): void {
  if (world.terrain.kind === "real" && world.terrain.realRuns) {
    checkRealGates(state, world);
    return;
  }
  const nearest = world.terrain.nearestTrail(state.pos.x, state.pos.z, nearestScratch);
  for (let trailIndex = 0; trailIndex < world.profile.trails.length; trailIndex += 1) {
    const k0 = Math.floor(state.prevZ / GATE_SPACING) - 1;
    for (let k = k0; k <= k0 + 3; k += 1) {
      if (k < 1) continue;
      const trail = world.profile.trails[trailIndex];
      const gateZ = k * GATE_SPACING + trailIndex * 31;
      const gateX = trailCenter(trail, gateZ);
      const gateHalf = trail.half * 0.52;
      const key = trailIndex * 100003 + k;
      if (state.passedGates.has(key)) continue;
      if (state.prevZ < gateZ && state.pos.z >= gateZ) {
        const fraction = (gateZ - state.prevZ) / Math.max(1e-5, state.pos.z - state.prevZ);
        const crossingX = lerp(state.prevX, state.pos.x, fraction);
        if (Math.abs(crossingX - gateX) < gateHalf + 0.7) {
          state.passedGates.add(key); bumpCombo(state); addScore(state, 120);
          state.events.gatePassed = true;
        } else if (trailIndex === nearest.i && nearest.on) {
          state.passedGates.add(key);
          if (state.combo > 1) { state.combo = 1; state.events.comboChanged = true; }
          state.events.gateMissed = true;
        }
      }
    }
  }
  state.prevZ = state.pos.z; state.prevX = state.pos.x;
}

function distanceToMovementSegment(state: SimulationState, x: number, z: number): number {
  const dx = state.pos.x - state.prevX, dz = state.pos.z - state.prevZ;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq > 0 ? Math.max(0, Math.min(1,
    ((x - state.prevX) * dx + (z - state.prevZ) * dz) / lengthSq)) : 0;
  return Math.hypot(x - (state.prevX + dx * t), z - (state.prevZ + dz * t));
}

function checkRealGates(state: SimulationState, world: SimulationWorld): void {
  const run = world.terrain.realRuns?.[state.selectedTrail];
  if (!run) return;
  const hit = nearestPointOnRun(run, state.pos.x, state.pos.z, runPointScratch);
  const previous = state.courseProgress;
  state.prevCourseProgress = previous;
  state.courseProgress = hit.progressM;
  for (const gate of run.gates) {
    const key = state.selectedTrail * 100003 + gate.key;
    if (state.passedGates.has(key) || previous >= gate.distanceM || hit.progressM < gate.distanceM) continue;
    state.passedGates.add(key);
    if (distanceToMovementSegment(state, gate.x, gate.z) <= gate.halfWidthM + 0.7) {
      bumpCombo(state); addScore(state, 120); state.events.gatePassed = true;
    } else if (hit.distance <= run.halfWidthM) {
      if (state.combo > 1) { state.combo = 1; state.events.comboChanged = true; }
      state.events.gateMissed = true;
    }
  }
  if (!state.finished && hit.progressM >= run.finishM - 2 && hit.distance <= run.halfWidthM) {
    state.finished = true; state.events.finished = true;
  }
  state.prevZ = state.pos.z; state.prevX = state.pos.x;
}

export function velocityMagnitude(state: SimulationState): number { return length(state.vel); }
