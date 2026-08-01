/**
 * lib/game/terrain/bicubic.ts
 * ───────────────────────────
 * Catmull-Rom bicubic sampling of a decoded {@link Heightfield}, with analytic
 * first derivatives.
 *
 * Why Catmull-Rom rather than bilinear: bilinear normals are piecewise constant
 * per cell, so a skier crossing a 4 m DEM cell boundary gets a normal
 * discontinuity every ~40 ms at speed — visible chatter and a spike in the
 * physics contact response. Catmull-Rom is C1 across cell boundaries (the
 * tangent at a knot is (p[i+1] − p[i−1])/2 regardless of which side you
 * approach from), so both the surface and its normal are continuous.
 *
 * Index clamping: samples outside the grid clamp to the edge value, and the
 * corresponding derivative is reported as zero (the surface really is flat out
 * there, so a nonzero slope would disagree with the heights).
 *
 * Pure: no IO, no DOM, no allocation per call beyond the caller's `out`.
 */

import type { Heightfield } from "./formats";

/** A sampled height plus its derivatives in *grid index* space. */
export interface GridSample {
  value: number;
  /** ∂height/∂column, metres per column step. */
  dCol: number;
  /** ∂height/∂row, metres per row step. */
  dRow: number;
}

export function createGridSample(): GridSample {
  return { value: 0, dCol: 0, dRow: 0 };
}

/** Uniform Catmull-Rom basis, `t` in [0, 1] between `p1` and `p2`. */
export function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const c0 = 2 * p1;
  const c1 = -p0 + p2;
  const c2 = 2 * p0 - 5 * p1 + 4 * p2 - p3;
  const c3 = -p0 + 3 * p1 - 3 * p2 + p3;
  return 0.5 * (c0 + c1 * t + c2 * t * t + c3 * t * t * t);
}

/** d/dt of {@link catmullRom}. */
export function catmullRomDerivative(
  p0: number, p1: number, p2: number, p3: number, t: number,
): number {
  const c1 = -p0 + p2;
  const c2 = 2 * p0 - 5 * p1 + 4 * p2 - p3;
  const c3 = -p0 + 3 * p1 - 3 * p2 + p3;
  return 0.5 * (c1 + 2 * c2 * t + 3 * c3 * t * t);
}

function clampIndex(i: number, max: number): number {
  return i < 0 ? 0 : i > max ? max : i;
}

const rowValues = [0, 0, 0, 0];
const rowSlopes = [0, 0, 0, 0];

/**
 * Sample `field` at fractional grid coordinates.
 *
 * `col`/`row` are *unclamped* — pass the raw fractional index; this function
 * clamps internally and zeroes the derivative on any axis that was clamped.
 */
export function sampleGridBicubic(
  field: Heightfield, col: number, row: number, out: GridSample,
): GridSample {
  const { width, height, heights } = field;
  const maxCol = width - 1;
  const maxRow = height - 1;

  const outsideCol = col < 0 || col > maxCol;
  const outsideRow = row < 0 || row > maxRow;
  const fc = outsideCol ? (col < 0 ? 0 : maxCol) : col;
  const fr = outsideRow ? (row < 0 ? 0 : maxRow) : row;

  // Anchor cell: [c1, c1+1] × [r1, r1+1], with t in [0, 1] inside it.
  const c1 = clampIndex(Math.floor(fc), Math.max(0, maxCol - 1));
  const r1 = clampIndex(Math.floor(fr), Math.max(0, maxRow - 1));
  const tc = fc - c1;
  const tr = fr - r1;

  for (let j = 0; j < 4; j += 1) {
    const rowIndex = clampIndex(r1 - 1 + j, maxRow) * width;
    const p0 = heights[rowIndex + clampIndex(c1 - 1, maxCol)];
    const p1 = heights[rowIndex + clampIndex(c1, maxCol)];
    const p2 = heights[rowIndex + clampIndex(c1 + 1, maxCol)];
    const p3 = heights[rowIndex + clampIndex(c1 + 2, maxCol)];
    rowValues[j] = catmullRom(p0, p1, p2, p3, tc);
    rowSlopes[j] = catmullRomDerivative(p0, p1, p2, p3, tc);
  }

  out.value = catmullRom(rowValues[0], rowValues[1], rowValues[2], rowValues[3], tr);
  out.dCol = outsideCol
    ? 0
    : catmullRom(rowSlopes[0], rowSlopes[1], rowSlopes[2], rowSlopes[3], tr);
  out.dRow = outsideRow
    ? 0
    : catmullRomDerivative(rowValues[0], rowValues[1], rowValues[2], rowValues[3], tr);
  return out;
}
