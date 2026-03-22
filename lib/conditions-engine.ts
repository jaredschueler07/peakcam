// ─────────────────────────────────────────────────────────────
// PeakCam — Conditions Engine
// Pure functions that compute condition rating, trend, outlook
// from SNOTEL data, 30-year normals, and NWS forecast.
// ─────────────────────────────────────────────────────────────

import type { ConditionRating } from "./types";

// ── Inputs ───────────────────────────────────────────────────

export interface ConditionsInput {
  current: {
    snowDepthIn: number | null;
    sweIn: number | null;
    newSnow24h: number;
    newSnow48h: number;
  };
  normals: {
    medianSweIn: number | null;
    pctile10SweIn: number | null;
    pctile90SweIn: number | null;
  };
  history7d: {
    /** Last 7 days of SWE values, oldest first. May contain nulls. */
    sweValues: (number | null)[];
  };
  forecast: {
    /** Sum of estimated snow (inches) over the next 48 hours. */
    snowInchesNext48h: number;
    /** Highest forecast high temperature (°F) in the next 48 hours. */
    maxHighTemp48h: number;
  };
}

// ── Outputs ──────────────────────────────────────────────────

export type SnowTrend = "rising" | "falling" | "stable";
export type SnowOutlook = "more_snow" | "stable" | "warming" | "melt_risk";

export interface ConditionsOutput {
  condRating: ConditionRating;
  pctOfNormal: number | null;
  trend7d: SnowTrend;
  outlook: SnowOutlook;
  outlookLabel: string;
}

// ── Thresholds (tunable) ─────────────────────────────────────

export const RATING_THRESHOLDS = {
  great: { newSnow24h: 6, newSnow48h: 12 },
  good:  { newSnow24h: 2, pctOfNormal: 100, minDepth: 24 },
  fair:  { pctOfNormal: 70, minDepth: 20 },
} as const;

const TREND_THRESHOLD_IN = 0.5;  // SWE change in inches
const SNOW_FORECAST_THRESHOLD = 3; // inches for "more_snow"
const WARM_TEMP_THRESHOLD = 40;    // °F for warming/melt

// ── Percent of Normal ────────────────────────────────────────

export function computePctOfNormal(
  currentSweIn: number | null,
  medianSweIn: number | null,
): number | null {
  if (currentSweIn == null || medianSweIn == null || medianSweIn <= 0) {
    return null;
  }
  return Math.round((currentSweIn / medianSweIn) * 100);
}

// ── Trend ────────────────────────────────────────────────────

export function computeTrend(sweValues: (number | null)[]): SnowTrend {
  // Need at least 3 days of data to determine a trend
  const valid = sweValues.filter((v): v is number => v != null);
  if (valid.length < 3) return "stable";

  const oldest = valid[0];
  const newest = valid[valid.length - 1];
  const delta = newest - oldest;

  if (delta > TREND_THRESHOLD_IN) return "rising";
  if (delta < -TREND_THRESHOLD_IN) return "falling";
  return "stable";
}

// ── Outlook ──────────────────────────────────────────────────

export function computeOutlook(
  trend: SnowTrend,
  snowInchesNext48h: number,
  maxHighTemp48h: number,
): { outlook: SnowOutlook; outlookLabel: string } {
  // Evaluated top-to-bottom, first match wins
  if (snowInchesNext48h >= SNOW_FORECAST_THRESHOLD) {
    return {
      outlook: "more_snow",
      outlookLabel: `More snow expected — ${snowInchesNext48h}" in the forecast`,
    };
  }

  if (trend === "falling" && maxHighTemp48h >= WARM_TEMP_THRESHOLD) {
    return {
      outlook: "melt_risk",
      outlookLabel: `Warming trend — highs near ${maxHighTemp48h}°F, base may soften`,
    };
  }

  if (maxHighTemp48h >= WARM_TEMP_THRESHOLD) {
    return {
      outlook: "warming",
      outlookLabel: `Mild temps ahead — highs near ${maxHighTemp48h}°F`,
    };
  }

  return {
    outlook: "stable",
    outlookLabel: "Steady conditions expected",
  };
}

// ── Condition Rating ─────────────────────────────────────────

export function computeConditionRating(
  newSnow24h: number,
  newSnow48h: number,
  snowDepthIn: number | null,
  pctOfNormal: number | null,
): ConditionRating {
  const t = RATING_THRESHOLDS;

  // Great: big dump
  if (newSnow24h >= t.great.newSnow24h || newSnow48h >= t.great.newSnow48h) {
    return "great";
  }

  // Good: moderate new snow OR healthy snowpack
  if (newSnow24h >= t.good.newSnow24h) return "good";
  if (
    pctOfNormal != null &&
    pctOfNormal >= t.good.pctOfNormal &&
    snowDepthIn != null &&
    snowDepthIn >= t.good.minDepth
  ) {
    return "good";
  }

  // Fair: adequate base, reasonable snowpack
  if (
    snowDepthIn != null &&
    snowDepthIn >= t.fair.minDepth &&
    (pctOfNormal == null || pctOfNormal >= t.fair.pctOfNormal)
  ) {
    return "fair";
  }

  // Poor: everything else
  return "poor";
}

// ── Main Entry Point ─────────────────────────────────────────

/**
 * Compute all conditions from inputs. Pure function — no side effects.
 */
export function computeConditions(input: ConditionsInput): ConditionsOutput {
  const pctOfNormal = computePctOfNormal(
    input.current.sweIn,
    input.normals.medianSweIn,
  );

  const trend7d = computeTrend(input.history7d.sweValues);

  const { outlook, outlookLabel } = computeOutlook(
    trend7d,
    input.forecast.snowInchesNext48h,
    input.forecast.maxHighTemp48h,
  );

  const condRating = computeConditionRating(
    input.current.newSnow24h,
    input.current.newSnow48h,
    input.current.snowDepthIn,
    pctOfNormal,
  );

  return { condRating, pctOfNormal, trend7d, outlook, outlookLabel };
}
