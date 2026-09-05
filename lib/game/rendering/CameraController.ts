import * as THREE from "three";
import type { SimulationState, TerrainSampler } from "../core/types";
import { BACK_SPEED_REF, CAMERA_PRESETS, HEIGHT_SPEED_REF, type CameraPreset } from "./camera-presets";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const damp = (from: number, to: number, lambda: number, dt: number) =>
  from + (to - from) * (1 - Math.exp(-lambda * dt));

function noise1(value: number): number {
  const cell = Math.floor(value), fraction = value - cell;
  const smooth = fraction * fraction * (3 - 2 * fraction);
  const at = (index: number) => {
    const raw = Math.sin(index * 127.1 + 19.19) * 43758.5453;
    return (raw - Math.floor(raw)) * 2 - 1;
  };
  return THREE.MathUtils.lerp(at(cell), at(cell + 1), smooth);
}

/** Writes into `out` — returning a tuple would allocate every camera frame. */
function criticalSpring(
  value: number, velocity: number, target: number, frequency: number, dt: number,
  out: { value: number; velocity: number },
): void {
  const omega = Math.PI * 2 * frequency;
  const f = 1 + 2 * dt * omega;
  const oo = omega * omega, hoo = dt * oo, hhoo = dt * hoo;
  const inverse = 1 / (f + hhoo);
  out.value = (f * value + dt * velocity + hhoo * target) * inverse;
  out.velocity = (velocity + hoo * (target - value)) * inverse;
}

const springOut = { value: 0, velocity: 0 };

export class CameraController {
  private readonly position = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private elapsed = 0;
  private readonly reducedMotion: boolean;
  private shake = 0;
  private shakeVelocity = 0;
  private roll = 0;
  readonly speedUniform: THREE.IUniform<number> = { value: 0 };

  get motionAmplitude(): number { return this.shake; }

  /**
   * The framing is injected, never read from the URL here — resolving `?cam=` is the renderer's
   * job (`cameraPresetName()`), which keeps this class pure and testable under any preset.
   */
  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    state: SimulationState,
    reducedMotion?: boolean,
    private readonly preset: CameraPreset = CAMERA_PRESETS.classic,
  ) {
    this.reducedMotion = reducedMotion ?? (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    // Start at the actual chase pose. Real runs can face any heading; seeding a fixed
    // south-facing offset makes shader warmup duration decide the first visible composition.
    const speed = Math.hypot(state.vel.x, state.vel.z);
    const forwardX = Math.sin(state.yaw), forwardZ = Math.cos(state.yaw);
    const back = preset.backBase + clamp01(speed / BACK_SPEED_REF) * preset.backSpeedGain;
    this.position.set(
      state.pos.x - forwardX * back,
      state.pos.y + preset.heightBase + clamp01(speed / HEIGHT_SPEED_REF) * preset.heightSpeedGain + (state.onGround ? 0 : preset.airLift),
      state.pos.z - forwardZ * back,
    );
    this.camera.position.copy(this.position);
    this.target.set(state.pos.x + forwardX * preset.lookAheadM, state.pos.y + preset.lookHeightM, state.pos.z + forwardZ * preset.lookAheadM);
    this.camera.lookAt(this.target);
    this.camera.fov = preset.fovBase;
    this.camera.updateProjectionMatrix();
  }

  update(state: SimulationState, terrain: TerrainSampler, dt: number, tuck: number): void {
    this.elapsed += dt;
    const speed = Math.hypot(state.vel.x, state.vel.z);
    const speed01 = clamp01(speed / 58);
    this.speedUniform.value = damp(this.speedUniform.value, speed01, 7.5, dt);
    if (state.liftRide > 0) {
      const desiredX = state.pos.x + 6.8, desiredY = state.pos.y + 3.2, desiredZ = state.pos.z + 8.5;
      this.position.x = damp(this.position.x, desiredX, 4.2, dt);
      this.position.y = damp(this.position.y, desiredY, 4.2, dt);
      this.position.z = damp(this.position.z, desiredZ, 4.2, dt);
      this.camera.position.copy(this.position);
      this.target.set(state.pos.x, state.pos.y + 0.6, state.pos.z - 5);
      this.camera.lookAt(this.target);
      this.camera.fov = damp(this.camera.fov, 58, 4, dt);
      this.camera.updateProjectionMatrix();
      return;
    }
    const preset = this.preset;
    const forwardX = Math.sin(state.yaw), forwardZ = Math.cos(state.yaw);
    const back = preset.backBase + clamp01(speed / BACK_SPEED_REF) * preset.backSpeedGain;
    const desiredX = state.pos.x - forwardX * back;
    const desiredZ = state.pos.z - forwardZ * back;
    const desiredY = state.pos.y + preset.heightBase + clamp01(speed / HEIGHT_SPEED_REF) * preset.heightSpeedGain
      + (state.onGround ? 0 : preset.airLift);
    const lambda = state.crash > 0 ? 3 : 6.5;
    this.position.x = damp(this.position.x, desiredX, lambda, dt);
    this.position.y = damp(this.position.y, desiredY, lambda * 1.35, dt);
    this.position.z = damp(this.position.z, desiredZ, lambda, dt);
    this.position.y = Math.max(this.position.y, terrain.height(this.position.x, this.position.z) + preset.floorClearance);
    const targetShake = this.reducedMotion ? 0 : (state.crash > 0 ? state.crash * 0.06 : this.speedUniform.value * this.speedUniform.value * 0.036);
    criticalSpring(this.shake, this.shakeVelocity, targetShake, 2.2, dt, springOut);
    this.shake = springOut.value; this.shakeVelocity = springOut.velocity;
    this.camera.position.set(
      this.position.x + noise1(this.elapsed * 9.7) * this.shake,
      this.position.y + noise1(this.elapsed * 11.3 + 43) * this.shake,
      this.position.z + noise1(this.elapsed * 8.1 + 91) * this.shake * 0.35,
    );
    this.target.set(
      state.pos.x + forwardX * preset.lookAheadM,
      state.pos.y + preset.lookHeightM,
      state.pos.z + forwardZ * preset.lookAheadM,
    );
    this.camera.lookAt(this.target);
    const fovRamp = this.reducedMotion ? preset.fovSpeedGain / 2 : preset.fovSpeedGain;
    this.camera.fov = damp(this.camera.fov, preset.fovBase + this.speedUniform.value * fovRamp, 5.2, dt);
    const targetRoll = this.reducedMotion ? 0 : THREE.MathUtils.clamp((-state.lean * 0.055 - tuck * state.lean * 0.012) * this.speedUniform.value, -0.065, 0.065);
    this.roll = damp(this.roll, targetRoll, 9, dt);
    this.camera.rotateZ(this.roll);
    this.camera.updateProjectionMatrix();
  }
}
