/**
 * Query-string switches for bisecting a rendering defect against a real GPU.
 *
 * Deliberately NOT gated on `NODE_ENV`, for the same reason `?e2ecanvas` is not: the browser matrix
 * is shot against a production build, where a dev-only flag can never fire. Nothing links to these,
 * they only ever subtract work, and each one is inert unless typed by hand.
 */

import { resolveCameraPresetName, type CameraPresetName } from "./camera-presets";

/** Which `SnowNodeMaterial` terms to switch off. Higher numbers subtract more. */
export const SNOW_DEBUG = {
  NONE: 0,
  /** 1 — both glint terms (the `sin()` hash suspected of NaN at large world coordinates). */
  NO_GLINT: 1,
  /** 2 — the wrap / rim / backscatter lighting block. */
  NO_WRAP_RIM: 2,
  /** 3 — the triplanar detail-normal perturbation. */
  NO_DETAIL_NORMAL: 3,
  /** 4 — every custom term: a plain MeshStandardNodeMaterial with the same surface settings. */
  PLAIN: 4,
  /** 5 — leave the snow material alone but do not install `scene.fogNode`. */
  NO_FOG: 5,
} as const;

export type SnowDebugMode = (typeof SNOW_DEBUG)[keyof typeof SNOW_DEBUG];

function search(): string {
  return typeof location === "undefined" ? "" : location.search;
}

function numericFlag(name: string, from = search()): number {
  const raw = new URLSearchParams(from).get(name);
  if (raw === null) return 0;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** `?snowdbg=<n>` — see `SNOW_DEBUG`. 0 when absent or unparseable. */
export function snowDebugMode(from = search()): number {
  return numericFlag("snowdbg", from);
}

/** `?treedbg=1` — drop the vertex-colour multiply on the instanced props, so they shade flat. */
export function treeDebugEnabled(from = search()): boolean {
  return numericFlag("treedbg", from) > 0;
}

/** `?nopost` — skip the post chain entirely and present the raw scene. */
export function postBypassEnabled(from = search()): boolean {
  return new URLSearchParams(from).has("nopost");
}

/** Partitions a cascaded-shadow defect: is it the light, or the cascades? */
export const CSM_DEBUG = {
  NONE: 0,
  /** 1 — keep the directional light, drop its shadow node (`castShadow = false`). */
  NO_SHADOW: 1,
  /** 2 — keep shadows but force a single cascade. */
  ONE_CASCADE: 2,
} as const;

/** `?csmdbg=<n>` — see `CSM_DEBUG`. */
export function csmDebugMode(from = search()): number {
  return numericFlag("csmdbg", from);
}

/**
 * `?weather=<0|1|2>` — pin the starting weather preset instead of taking it from live conditions.
 *
 * `ConditionsSnapshot.weatherDefault` is derived from the live NWS forecast and the latest snow
 * report (`lib/game/conditions.ts`), so which sky, fog density and exposure a session starts with
 * depends on the real weather at a real resort on the day. That is right for players and wrong for
 * any pixel-reading test: the e2e luminance guard exists to catch *rendering* washouts, and it
 * cannot do that if its frame changes when it starts snowing in Chile. Returns `null` when absent
 * or unparseable, which leaves live conditions in charge.
 */
export function weatherOverride(from = search()): 0 | 1 | 2 | null {
  const raw = new URLSearchParams(from).get("weather");
  if (raw === null) return null;
  const value = Number.parseInt(raw, 10);
  return value === 0 || value === 1 || value === 2 ? value : null;
}

/**
 * `?cam=<name>` — which chase-camera framing to fly, see `CAMERA_PRESETS`. Absent or unrecognised
 * is `classic`, the shipped geometry, so this can only ever be opted into by hand.
 */
export function cameraPresetName(from = search()): CameraPresetName {
  return resolveCameraPresetName(new URLSearchParams(from).get("cam"));
}
