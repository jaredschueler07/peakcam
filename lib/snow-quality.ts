// ─────────────────────────────────────────────────────────────
// PeakCam — Snow Data Quality Validation
// Pure functions for SNOTEL data validation and water-year math.
// ─────────────────────────────────────────────────────────────

import type { QCFlag } from "./types";

// ── Water Year Helper ────────────────────────────────────────

/**
 * Convert a calendar date to day-of-water-year.
 * Water year runs Oct 1 (day 1) through Sep 30 (day 365/366).
 */
export function dayOfWaterYear(date: Date): number {
  const year = date.getFullYear();
  const month = date.getMonth();
  const wyStart = month >= 9
    ? new Date(year, 9, 1)
    : new Date(year - 1, 9, 1);

  const diffMs = date.getTime() - wyStart.getTime();
  return Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1;
}

/**
 * Get the water year for a given date.
 * Oct-Dec → current calendar year + 1. Jan-Sep → current calendar year.
 */
export function waterYear(date: Date): number {
  return date.getMonth() >= 9 ? date.getFullYear() + 1 : date.getFullYear();
}

// ── Raw Reading (input from SNOTEL API) ──────────────────────

export interface RawSnotelReading {
  snowDepthIn: number | null;
  sweIn: number | null;
  precipAccumIn: number | null;
  tempObsF: number | null;
  tempMaxF: number | null;
  tempMinF: number | null;
}

// ── Previous Day (for delta checks) ──────────────────────────

export interface PreviousDay {
  snowDepthIn: number | null;
  sweIn: number | null;
  precipAccumIn: number | null;
}

// ── Quality Result ───────────────────────────────────────────

export interface QualityResult {
  snowDepthIn: number | null;
  sweIn: number | null;
  precipAccumIn: number | null;
  tempObsF: number | null;
  tempMaxF: number | null;
  tempMinF: number | null;
  qcFlag: QCFlag;
  notes: string | null;
}

// ── Validation ───────────────────────────────────────────────

/**
 * Validate a single SNOTEL reading against physical limits and
 * the previous day's values. Returns cleaned values + QC flag.
 */
export function validateReading(
  current: RawSnotelReading,
  previous: PreviousDay | null,
): QualityResult {
  let qcFlag: QCFlag = "valid";
  let notes: string | null = null;
  let { snowDepthIn, sweIn, precipAccumIn } = current;

  // ── Missing data
  if (snowDepthIn == null && sweIn == null) {
    return {
      snowDepthIn: previous?.snowDepthIn ?? null,
      sweIn: previous?.sweIn ?? null,
      precipAccumIn: previous?.precipAccumIn ?? null,
      tempObsF: current.tempObsF,
      tempMaxF: current.tempMaxF,
      tempMinF: current.tempMinF,
      qcFlag: "missing",
      notes: "No snow depth or SWE reported; carried forward previous day",
    };
  }

  // ── Range checks
  if (snowDepthIn != null && (snowDepthIn < 0 || snowDepthIn > 300)) {
    notes = `Snow depth out of range (${snowDepthIn}in); using previous day`;
    snowDepthIn = previous?.snowDepthIn ?? null;
    qcFlag = "suspect";
  }

  if (sweIn != null && (sweIn < 0 || sweIn > 100)) {
    notes = `SWE out of range (${sweIn}in); using previous day`;
    sweIn = previous?.sweIn ?? null;
    qcFlag = "suspect";
  }

  // ── Spike detection (±36" in 24h)
  if (
    snowDepthIn != null &&
    previous?.snowDepthIn != null &&
    Math.abs(snowDepthIn - previous.snowDepthIn) > 36
  ) {
    const prevNotes = notes ? notes + "; " : "";
    notes = `${prevNotes}Spike detected (${previous.snowDepthIn}→${snowDepthIn}in); using previous day`;
    snowDepthIn = previous.snowDepthIn;
    qcFlag = "suspect";
  }

  // ── SWE > depth (physically impossible)
  if (sweIn != null && snowDepthIn != null && sweIn > snowDepthIn) {
    const prevNotes = notes ? notes + "; " : "";
    notes = `${prevNotes}SWE (${sweIn}) > depth (${snowDepthIn}); flagged suspect`;
    qcFlag = "suspect";
  }

  return {
    snowDepthIn,
    sweIn,
    precipAccumIn,
    tempObsF: current.tempObsF,
    tempMaxF: current.tempMaxF,
    tempMinF: current.tempMinF,
    qcFlag,
    notes,
  };
}
