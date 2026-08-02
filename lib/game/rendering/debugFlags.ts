/**
 * Query-string switches for bisecting a rendering defect against a real GPU.
 *
 * Deliberately NOT gated on `NODE_ENV`, for the same reason `?e2ecanvas` is not: the browser matrix
 * is shot against a production build, where a dev-only flag can never fire. Nothing links to these,
 * they only ever subtract work, and each one is inert unless typed by hand.
 */

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
