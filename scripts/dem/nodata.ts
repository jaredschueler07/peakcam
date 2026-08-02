/**
 * scripts/dem/nodata.ts
 * ─────────────────────
 * Source-data validity for the warped DEM mosaic: which sampled cells carry no
 * usable elevation, what to do about them, and how to say so.
 *
 * Two distinct failures produce garbage elevations, and conflating them cost a
 * debugging cycle (a −999999 sentinel was reported as "relief exceeds uint16
 * range at 0.1 m"):
 *
 *   - *uncovered* — the warp wrote its own nodata sentinel because no source
 *     tile reached that destination cell. This is a coverage problem: the
 *     configured 3DEP projects do not span the bake box.
 *   - *implausible* — a value survived the warp but cannot be an elevation on
 *     Earth. In practice this is an undeclared source sentinel (3DEP stages
 *     −999999) that gdalwarp had no reason to translate.
 *
 * Both are "no data", so both are counted, but they are reported separately
 * because they call for different fixes (add a project vs. fix the source
 * nodata declaration).
 */

import type { UtmBounds } from "./sources";

/**
 * Destination nodata written by `gdalwarp -dstnodata`. Chosen to be exactly
 * representable in Float32 and far outside any real elevation, so an equality
 * test is safe.
 */
export const WARP_NODATA = -9999;

/** Elevations outside this band are not terrain; they are broken source data. */
export const PLAUSIBLE_ELEVATION_M = { min: -500, max: 9000 } as const;

/**
 * Largest share of the bake grid that may be interpolated rather than sourced.
 *
 * 0.1% of a 1024² grid is ~1048 cells — a gap of that size is at most a ~32×32
 * cell blob (≈190 m across at 6 m/px), which `gdal_fillnodata` reconstructs
 * from its own edges without inventing landforms. Anything larger means a
 * missing project rather than a hole in one, and silently interpolating
 * kilometres of terrain is far worse than a failed bake: the bake output is
 * committed and then skied on, so a plausible-looking invented ridge would
 * outlive any log line warning about it.
 */
export const NODATA_FILL_MAX_FRACTION = 0.001;

export type ElevationClass = "ok" | "uncovered" | "implausible";

export function classifyElevation(value: number, sentinel: number = WARP_NODATA): ElevationClass {
  if (!Number.isFinite(value) || value === sentinel) return "uncovered";
  if (value < PLAUSIBLE_ELEVATION_M.min || value > PLAUSIBLE_ELEVATION_M.max) return "implausible";
  return "ok";
}

/** Inclusive grid-cell bounding box of the offending cells. */
export type NodataExtent = { minCol: number; maxCol: number; minRow: number; maxRow: number };

export type NodataDecision = "clean" | "fill" | "fail";

export type NodataAudit = {
  total: number;
  uncovered: number;
  implausible: number;
  /** `uncovered + implausible`. */
  count: number;
  fraction: number;
  decision: NodataDecision;
  extent: NodataExtent | null;
};

export function auditNodata(
  values: ArrayLike<number>,
  width: number,
  height: number,
  sentinel: number = WARP_NODATA,
): NodataAudit {
  const total = width * height;
  if (values.length !== total) {
    throw new Error(`nodata audit: ${values.length} values do not fill a ${width}x${height} raster`);
  }

  let uncovered = 0;
  let implausible = 0;
  let minCol = Infinity;
  let maxCol = -Infinity;
  let minRow = Infinity;
  let maxRow = -Infinity;

  for (let i = 0; i < total; i++) {
    const kind = classifyElevation(values[i], sentinel);
    if (kind === "ok") continue;
    if (kind === "uncovered") uncovered++;
    else implausible++;
    const row = Math.floor(i / width);
    const col = i - row * width;
    if (col < minCol) minCol = col;
    if (col > maxCol) maxCol = col;
    if (row < minRow) minRow = row;
    if (row > maxRow) maxRow = row;
  }

  const count = uncovered + implausible;
  const fraction = count / total;
  return {
    total,
    uncovered,
    implausible,
    count,
    fraction,
    decision: count === 0 ? "clean" : fraction <= NODATA_FILL_MAX_FRACTION ? "fill" : "fail",
    extent: count === 0 ? null : { minCol, maxCol, minRow, maxRow },
  };
}

export type NodataCorner = { label: "NW" | "NE" | "SE" | "SW"; x: number; y: number };

/**
 * Projected cell-centre coordinates of the nodata bounding box, in the warp's
 * target CRS. Centres rather than pixel edges, so the numbers can be pasted
 * straight into a coverage check against a project's tile index.
 */
export function nodataExtentCorners(
  extent: NodataExtent,
  bounds: UtmBounds,
  width: number,
  height: number,
): NodataCorner[] {
  const cellW = (bounds.east - bounds.west) / width;
  const cellH = (bounds.north - bounds.south) / height;
  const x = (col: number) => bounds.west + (col + 0.5) * cellW;
  const y = (row: number) => bounds.north - (row + 0.5) * cellH;
  return [
    { label: "NW", x: x(extent.minCol), y: y(extent.minRow) },
    { label: "NE", x: x(extent.maxCol), y: y(extent.minRow) },
    { label: "SE", x: x(extent.maxCol), y: y(extent.maxRow) },
    { label: "SW", x: x(extent.minCol), y: y(extent.maxRow) },
  ];
}

/** What the warp was actually given, for the diagnostics to quote. */
export type SourceMosaic = { projects: string[]; tiles: number };

/**
 * The facts, without a diagnosis: how many cells, what was mosaicked, and
 * where the hole is. Used verbatim by the fill path, which has found a gap but
 * is not claiming the projects are wrong.
 */
export function nodataSummary(
  slug: string,
  mosaic: SourceMosaic,
  audit: NodataAudit,
  corners: NodataCorner[],
  epsg: number,
): string {
  const share = (audit.fraction * 100).toFixed(2);
  const where = corners.map((c) => `${c.label} ${c.x.toFixed(1)}, ${c.y.toFixed(1)}`).join("; ");
  return (
    `${slug}: ${audit.count} cells (${share}%) of the ${audit.total}-cell bake grid had no data ` +
    `(${audit.uncovered} uncovered by any source tile, ${audit.implausible} implausible). ` +
    `Mosaicked ${mosaic.tiles} tile(s) from ${mosaic.projects.join(", ")}. ` +
    `Nodata region corners (EPSG:${epsg}): ${where}.`
  );
}

export function nodataFailureMessage(
  slug: string,
  mosaic: SourceMosaic,
  audit: NodataAudit,
  corners: NodataCorner[],
  epsg: number,
): string {
  return (
    `${nodataSummary(slug, mosaic, audit, corners, epsg)} ` +
    `A gap this large means the configured projects do not cover the bake box. ` +
    // The trap this message exists to spring: confirming in the S3 listing that
    // a tile index exists proves nothing about coverage.
    `Those tiles were fetched and used — a staged tile existing is not coverage, because 3DEP ` +
    `acquisition boundaries end mid-tile and a tile reads as nodata outside its project's ` +
    `collection area. Check valid-data coverage (gdalinfo -stats STATISTICS_VALID_PERCENT), ` +
    `not the tile listing. Interpolating a gap this size would invent terrain, not reproduce it.`
  );
}

/**
 * Sanity-check sampled elevations before anything downstream reasons about
 * relief. A value outside the plausible band is bad source data; reporting it
 * as a quantisation-range problem sends the reader after the wrong bug.
 */
export function assertPlausibleElevations(slug: string, min: number, max: number): void {
  if (min >= PLAUSIBLE_ELEVATION_M.min && max <= PLAUSIBLE_ELEVATION_M.max) return;
  throw new Error(
    `${slug}: sampled elevations span ${min} to ${max} m, outside the plausible range ` +
      `${PLAUSIBLE_ELEVATION_M.min} to ${PLAUSIBLE_ELEVATION_M.max} m — this is bad source data ` +
      `(an undeclared nodata sentinel or the wrong band), not a terrain-relief problem.`,
  );
}
