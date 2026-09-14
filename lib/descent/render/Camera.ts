/**
 * lib/descent/render/Camera.ts
 * ────────────────────────────
 * The chase camera. Follows the rider's *direction of travel* (never the
 * ski heading, so a skid or a spin doesn't whip the view), sits on a
 * critically-damped spring so it swings into turns and settles without
 * overshoot, widens its field of view with speed, and never dips below the
 * snow. In the menu it drifts slowly around the gate.
 */

import * as THREE from "three";
import type { CameraPreset, RiderState, World } from "../types";

interface PresetSpec { back: number; up: number; lookAhead: number; lookUp: number; fov: number; lag: number }

const PRESETS: Record<CameraPreset, PresetSpec> = {
  chase: { back: 7.2, up: 2.9, lookAhead: 4.0, lookUp: 1.2, fov: 62, lag: 5.5 },
  far: { back: 11.5, up: 4.4, lookAhead: 5.0, lookUp: 1.3, fov: 58, lag: 5.0 },
  high: { back: 8.5, up: 6.5, lookAhead: 3.0, lookUp: 0.8, fov: 60, lag: 5.5 },
  helmet: { back: -0.15, up: 1.55, lookAhead: 12, lookUp: 1.2, fov: 78, lag: 40 },
};

export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  preset: CameraPreset = "chase";
  private readonly position = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();
  private heading = 0;
  private fov = 62;
  private menuAngle = 0;
  private initialised = false;

  constructor(private readonly world: World, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.3, 60_000);
  }

  /** Snap behind the rider (start of a run, reset, camera preset change). */
  snap(state: RiderState): void {
    this.heading = state.travelYaw;
    this.solveTarget(state, this.heading, 1);
    this.position.copy(this.target);
    this.velocity.set(0, 0, 0);
    this.look.copy(this.lookTarget);
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.look);
    this.initialised = true;
  }

  private solveTarget(state: RiderState, heading: number, speedT: number): void {
    const p = PRESETS[this.preset];
    const fx = Math.sin(heading), fz = Math.cos(heading);
    // Pull back a touch more at speed; helmet cam stays put.
    const back = p.back * (this.preset === "helmet" ? 1 : 1 + speedT * 0.35);
    this.target.set(state.x - fx * back, state.y + p.up, state.z - fz * back);
    // Keep the camera above the snow between it and the rider.
    const ground = this.world.terrain.height(this.target.x, this.target.z);
    if (this.target.y < ground + 1.4) this.target.y = ground + 1.4;
    const mid = this.world.terrain.height((this.target.x + state.x) * 0.5, (this.target.z + state.z) * 0.5);
    if (this.target.y < mid + 0.9) this.target.y = mid + 0.9;
    this.lookTarget.set(state.x + fx * p.lookAhead, state.y + p.lookUp, state.z + fz * p.lookAhead);
  }

  update(state: RiderState, dt: number, phase: "menu" | "ride"): void {
    if (!this.initialised) this.snap(state);
    if (phase === "menu") { this.updateMenu(state, dt); return; }
    const p = PRESETS[this.preset];
    const speed = Math.hypot(state.vx, state.vz);
    const speedT = Math.min(1, speed / 40);

    // Heading follows travel, slower when nearly stopped so the view doesn't twitch at the gate.
    const wanted = state.liftIndex >= 0 ? state.liftSeat.heading : (speed > 1.5 ? state.travelYaw : state.yaw);
    let delta = wanted - this.heading;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    const turnLag = state.onGround ? 4.2 : 2.4;
    this.heading += delta * (1 - Math.exp(-turnLag * dt));

    this.solveTarget(state, this.heading, speedT);

    // Critically damped spring toward the target.
    const omega = p.lag;
    const k = 1 + omega * dt;
    const k2 = k * k;
    this.scratch.copy(this.target).sub(this.position).multiplyScalar(omega * omega * dt);
    this.velocity.add(this.scratch).divideScalar(k2);
    this.position.addScaledVector(this.velocity, dt);
    // Look point eases too, a little quicker than the body.
    this.look.lerp(this.lookTarget, 1 - Math.exp(-9 * dt));

    const wantedFov = p.fov + speedT * (this.preset === "helmet" ? 10 : 14) + (state.tucking ? 3 : 0);
    this.fov += (wantedFov - this.fov) * (1 - Math.exp(-3 * dt));

    this.camera.position.copy(this.position);
    this.camera.lookAt(this.look);
    if (Math.abs(this.camera.fov - this.fov) > 0.05) { this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); }
  }

  private updateMenu(state: RiderState, dt: number): void {
    this.menuAngle += dt * 0.06;
    const radius = 26;
    const a = state.yaw + Math.PI + Math.sin(this.menuAngle) * 0.9;
    const x = state.x + Math.sin(a) * radius;
    const z = state.z + Math.cos(a) * radius;
    const y = Math.max(state.y + 9, this.world.terrain.height(x, z) + 6);
    this.target.set(x, y, z);
    this.position.lerp(this.target, 1 - Math.exp(-1.2 * dt));
    this.lookTarget.set(state.x + Math.sin(state.yaw) * 14, state.y + 1, state.z + Math.cos(state.yaw) * 14);
    this.look.lerp(this.lookTarget, 1 - Math.exp(-1.5 * dt));
    this.fov += (58 - this.fov) * (1 - Math.exp(-2 * dt));
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.look);
    if (Math.abs(this.camera.fov - this.fov) > 0.05) { this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); }
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
