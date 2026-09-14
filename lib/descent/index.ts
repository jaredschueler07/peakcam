/**
 * lib/descent/index.ts
 * ────────────────────
 * Public entry point for the Descent engine. Client-only: it pulls in
 * three.js, so import it lazily from a `"use client"` component.
 */

import type { ConditionsSnapshot, DescentEvent, DescentRuntime, ResortGameProfile, RiderMode, RiderStyle, SnowboardStance } from "./types";
import { loadWorld } from "./world/loadWorld";
import { Descent } from "./Descent";

export type { DescentRuntime, DescentEvent, HudSnapshot, World, Course, CameraPreset, DescentPhase } from "./types";

export interface CreateDescentOptions {
  canvas: HTMLCanvasElement;
  profile: ResortGameProfile;
  conditions: ConditionsSnapshot;
  riderStyle: RiderStyle;
  riderMode?: RiderMode;
  stance?: SnowboardStance;
  weatherIndex: number;
  audioEnabled?: boolean;
  forceLowQuality?: boolean;
  seed?: number;
  signal?: AbortSignal;
  onProgress?(fraction: number, label: string): void;
  onEvent?(event: DescentEvent): void;
}

/** Load the mountain and start the runtime, with the rider waiting at the first gate. */
export async function createDescent(options: CreateDescentOptions): Promise<DescentRuntime> {
  const world = await loadWorld({
    profile: options.profile, conditions: options.conditions, seed: options.seed, signal: options.signal, onProgress: options.onProgress,
  });
  options.signal?.throwIfAborted();
  options.onProgress?.(1, "Building the scene");
  return new Descent({
    canvas: options.canvas, world, riderStyle: options.riderStyle, riderMode: options.riderMode, stance: options.stance, weatherIndex: options.weatherIndex,
    audioEnabled: options.audioEnabled ?? true, forceLowQuality: options.forceLowQuality, onEvent: options.onEvent,
  });
}
