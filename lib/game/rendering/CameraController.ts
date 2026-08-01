import * as THREE from "three";
import type { SimulationState, TerrainSampler } from "../core/types";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const damp = (from: number, to: number, lambda: number, dt: number) =>
  from + (to - from) * (1 - Math.exp(-lambda * dt));

export class CameraController {
  private readonly position = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private elapsed = 0;
  private readonly reducedMotion: boolean;

  constructor(private readonly camera: THREE.PerspectiveCamera, state: SimulationState, reducedMotion?: boolean) {
    this.reducedMotion = reducedMotion ?? (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    this.position.set(state.pos.x, state.pos.y + 5, state.pos.z - 9);
  }

  update(state: SimulationState, terrain: TerrainSampler, dt: number, tuck: number): void {
    this.elapsed += dt;
    const speed = Math.hypot(state.vel.x, state.vel.z);
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
    const forwardX = Math.sin(state.yaw), forwardZ = Math.cos(state.yaw);
    const back = 8.6 + clamp01(speed / 55) * 5.2;
    const desiredX = state.pos.x - forwardX * back;
    const desiredZ = state.pos.z - forwardZ * back;
    const desiredY = state.pos.y + 3.5 + clamp01(speed / 60) * 1.4 + (state.onGround ? 0 : 1);
    const lambda = state.crash > 0 ? 3 : 6.5;
    this.position.x = damp(this.position.x, desiredX, lambda, dt);
    this.position.y = damp(this.position.y, desiredY, lambda * 1.35, dt);
    this.position.z = damp(this.position.z, desiredZ, lambda, dt);
    this.position.y = Math.max(this.position.y, terrain.height(this.position.x, this.position.z) + 1.8);
    const shake = this.reducedMotion ? 0 : (state.crash > 0 ? state.crash * 0.06 : clamp01((speed - 34) / 40) * 0.012);
    this.camera.position.set(
      this.position.x + Math.sin(this.elapsed * 31) * shake * 3,
      this.position.y + Math.cos(this.elapsed * 27) * shake * 3,
      this.position.z,
    );
    this.target.set(state.pos.x + forwardX * 8, state.pos.y + 1.6, state.pos.z + forwardZ * 8);
    this.camera.lookAt(this.target);
    this.camera.fov = damp(this.camera.fov, 62 + clamp01(speed / 62) * 24 + tuck * 3, 4, dt);
    this.camera.updateProjectionMatrix();
  }
}
