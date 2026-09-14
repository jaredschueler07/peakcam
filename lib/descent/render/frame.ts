/**
 * lib/descent/render/frame.ts
 * ───────────────────────────
 * What every render module receives once per rendered frame. Modules are
 * classes with `constructor(scene, world)`, `update(frame)`, `dispose()`; they
 * never touch the sim, only read it.
 */

import type * as THREE from "three";
import type { CameraPreset, DescentPhase, ResortWeather, RiderState, World } from "../types";

export interface RenderFrame {
  readonly state: RiderState;
  readonly world: World;
  /** Wall-clock seconds since the renderer started (for animation). */
  readonly time: number;
  /** Seconds since the previous rendered frame, clamped. */
  readonly dt: number;
  readonly camera: THREE.PerspectiveCamera;
  readonly cameraPreset: CameraPreset;
  readonly weather: ResortWeather;
  readonly weatherIndex: number;
  readonly phase: DescentPhase;
  /** Index into `world.courses` of the line being ridden. */
  readonly courseIndex: number;
  readonly trailHint: boolean;
  /** 0 = full quality … 2 = lowest; modules may skip work at higher rungs. */
  readonly quality: 0 | 1 | 2;
}

export interface RenderModule {
  update(frame: RenderFrame): void;
  dispose(): void;
}
