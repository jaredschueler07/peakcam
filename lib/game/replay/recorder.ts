import type { SimulationState } from "../core/types";
import { FIXED_HZ } from "../core/clock";
import {
  MAX_KEYFRAMES,
  POSE_AIRBORNE,
  POSE_CRASHED,
  POSE_TUCKED,
  dequantizeYaw,
  quantizeYaw,
  type GhostSample,
} from "./codec";

export const GHOST_SAMPLE_HZ = 30;
const STEPS_PER_SAMPLE = FIXED_HZ / GHOST_SAMPLE_HZ;

function centimetres(metres: number): number {
  return Math.round(metres * 100);
}

export class GhostRecorder {
  private samples: GhostSample[] | null = null;
  private startedAt = 0;
  private nextTick = 0;

  get recording(): boolean {
    return this.samples !== null;
  }

  begin(nowSimTime: number): void {
    this.samples = [];
    this.startedAt = nowSimTime;
    this.nextTick = 0;
  }

  sample(state: SimulationState, simTime: number): void {
    if (this.samples === null || this.samples.length >= MAX_KEYFRAMES) return;

    const tick = Math.max(0, Math.round((simTime - this.startedAt) * FIXED_HZ));
    if (tick < this.nextTick) return;

    let poseFlags = 0;
    if (!state.onGround) poseFlags |= POSE_AIRBORNE;
    if (state.crouch > 0) poseFlags |= POSE_TUCKED;
    if (state.crash > 0) poseFlags |= POSE_CRASHED;

    this.samples.push({
      tick,
      xCm: centimetres(state.pos.x),
      zCm: centimetres(state.pos.z),
      groundOffsetCm: centimetres(state.pos.y),
      yaw: dequantizeYaw(quantizeYaw(state.yaw)),
      speedCms: centimetres(Math.hypot(state.vel.x, state.vel.z)),
      poseFlags,
    });
    this.nextTick = tick + STEPS_PER_SAMPLE;
  }

  finish(): GhostSample[] | null {
    const finished = this.samples;
    this.samples = null;
    return finished?.length ? finished : null;
  }
}
