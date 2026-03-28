// ─────────────────────────────────────────────────────────────
// PeakCam — Conditions Engine
// Pure functions that compute condition rating, trend, outlook
// from SNOTEL data, 30-year normals, and NWS forecast.
// ─────────────────────────────────────────────────────────────

import type { ConditionRating, UserSnowQuality, UserVisibility, UserWind, UserTrailConditions } from "./types";

// ── User Conditions Summary ─────────────────────────────────

export interface UserConditionReport {
  snow_quality: UserSnowQuality;
  visibility: UserVisibility;
  wind: UserWind;
  trail_conditions: UserTrailConditions;
}

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
  nwsGrid?: {
    skyCoverAvg: number;        // %
    windGustMax: number;        // mph
    windChillAvg: number;       // °F
    snowLevelAvg: number;       // ft
    resortElevBase: number;     // ft
    iceAccumulationMax: number; // inches
    probOfPrecipMax: number;    // %
  } | null;
  /** Recent user-submitted conditions reports (last 24h, unflagged). */
  userReports?: UserConditionReport[];
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
  tags: string[];
  narrative: string;
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

// ── User Conditions Score ────────────────────────────────────

const SNOW_QUALITY_SCORES: Record<UserSnowQuality, number> = {
  powder: 4, packed: 3, icy: 1, slush: 1,
};
const VISIBILITY_SCORES: Record<UserVisibility, number> = {
  clear: 3, foggy: 2, whiteout: 1,
};
const WIND_SCORES: Record<UserWind, number> = {
  calm: 3, breezy: 2, gusty: 1, high: 0,
};
const TRAIL_SCORES: Record<UserTrailConditions, number> = {
  groomed: 3, ungroomed: 2, moguls: 2, variable: 1,
};

/**
 * Aggregate user reports into a normalized 0–1 quality score.
 * Snow quality is weighted most heavily (40%), with visibility (20%),
 * wind (20%), and trail conditions (20%) splitting the remainder.
 * Returns null if no reports are available.
 */
export function computeUserScore(reports: UserConditionReport[]): number | null {
  if (reports.length === 0) return null;

  let totalScore = 0;
  for (const r of reports) {
    const snowNorm = SNOW_QUALITY_SCORES[r.snow_quality] / 4;   // 0–1
    const visNorm = VISIBILITY_SCORES[r.visibility] / 3;         // 0–1
    const windNorm = WIND_SCORES[r.wind] / 3;                    // 0–1
    const trailNorm = TRAIL_SCORES[r.trail_conditions] / 3;      // 0–1
    totalScore += snowNorm * 0.4 + visNorm * 0.2 + windNorm * 0.2 + trailNorm * 0.2;
  }
  return totalScore / reports.length;
}

// ── Condition Rating ─────────────────────────────────────────

// Rating order for numeric blending
const RATING_ORDER: ConditionRating[] = ["poor", "fair", "good", "great"];

function ratingToIndex(r: ConditionRating): number {
  return RATING_ORDER.indexOf(r);
}

function indexToRating(i: number): ConditionRating {
  return RATING_ORDER[Math.max(0, Math.min(3, Math.round(i)))];
}

/** SNOTEL-only rating based on snow depth, new snow, and % of normal. */
export function computeSnotelRating(
  newSnow24h: number,
  newSnow48h: number,
  snowDepthIn: number | null,
  pctOfNormal: number | null,
): ConditionRating {
  const t = RATING_THRESHOLDS;

  if (newSnow24h >= t.great.newSnow24h || newSnow48h >= t.great.newSnow48h) return "great";
  if (newSnow24h >= t.good.newSnow24h) return "good";
  if (pctOfNormal != null && pctOfNormal >= t.good.pctOfNormal && snowDepthIn != null && snowDepthIn >= t.good.minDepth) return "good";
  if (snowDepthIn != null && snowDepthIn >= t.fair.minDepth && (pctOfNormal == null || pctOfNormal >= t.fair.pctOfNormal)) return "fair";

  return "poor";
}

/**
 * Compute the final condition rating by blending SNOTEL data with user reports.
 * SNOTEL provides the base rating (always present). If user reports exist
 * (minimum 2 for signal quality), they can shift the rating by up to ±1 tier.
 *
 * Weights: SNOTEL 70%, user reports 30% (when available).
 */
export function computeConditionRating(
  newSnow24h: number,
  newSnow48h: number,
  snowDepthIn: number | null,
  pctOfNormal: number | null,
  userReports?: UserConditionReport[],
): ConditionRating {
  const snotelRating = computeSnotelRating(newSnow24h, newSnow48h, snowDepthIn, pctOfNormal);

  // Need at least 2 user reports to incorporate user signal
  const userScore = (userReports && userReports.length >= 2)
    ? computeUserScore(userReports)
    : null;

  if (userScore == null) return snotelRating;

  // Convert user score (0–1) to rating index (0–3)
  const userRatingIdx = userScore * 3;
  const snotelIdx = ratingToIndex(snotelRating);

  // Blend: 70% SNOTEL + 30% user, clamped to ±1 tier from SNOTEL
  const blended = snotelIdx * 0.7 + userRatingIdx * 0.3;
  const clamped = Math.max(snotelIdx - 1, Math.min(snotelIdx + 1, blended));

  return indexToRating(clamped);
}

// ── Tags & Narrative Synthesis ───────────────────────────────

export function synthesizeGridData(input: ConditionsInput): { tags: string[], narrative: string } {
  const tags: string[] = [];
  const narrativeParts: string[] = [];

  const { current, nwsGrid } = input;

  if (current.newSnow24h >= 4) {
    tags.push("Powder Day");
    narrativeParts.push(`Fresh powder (${current.newSnow24h}")`);
  }

  if (nwsGrid) {
    if (nwsGrid.skyCoverAvg < 30 && nwsGrid.probOfPrecipMax < 20) {
      tags.push("Bluebird");
      narrativeParts.push("clear bluebird skies");
    } else if (nwsGrid.skyCoverAvg > 80) {
      tags.push("Flat Light");
      narrativeParts.push("heavy overcast and flat light");
    }

    if (nwsGrid.windGustMax > 35) {
      tags.push("Wind Hold Risk");
      narrativeParts.push(`high winds up to ${Math.round(nwsGrid.windGustMax)}mph posing a lift hold risk`);
    } else if (nwsGrid.windGustMax > 20) {
      narrativeParts.push("breezy conditions");
    }

    if (nwsGrid.windChillAvg < 5) {
      tags.push("Bundle Up");
      narrativeParts.push("bitterly cold wind chills");
    } else if (nwsGrid.windChillAvg > 45 && (current.snowDepthIn ?? 0) > 10) {
      tags.push("Spring Skiing");
      narrativeParts.push("warm spring-like temperatures");
    }

    if (nwsGrid.iceAccumulationMax > 0.05) {
      tags.push("Icy");
      narrativeParts.push("potential for icy surface conditions");
    }

    // Rain vs Snow check based on elevation
    if (nwsGrid.probOfPrecipMax > 40 && nwsGrid.snowLevelAvg > (nwsGrid.resortElevBase + 500)) {
      tags.push("Rain at Base");
      narrativeParts.push(`rain mixed in at the base (snow level around ${Math.round(nwsGrid.snowLevelAvg)}ft)`);
    }
  }

  if (tags.length === 0) tags.push("Standard Conditions");

  let narrative = "";
  if (narrativeParts.length > 0) {
    // Join the first two or three parts into a flowing sentence
    if (narrativeParts.length === 1) {
      narrative = `Expect ${narrativeParts[0]} today.`;
    } else if (narrativeParts.length === 2) {
      narrative = `Expect ${narrativeParts[0]} alongside ${narrativeParts[1]}.`;
    } else {
      narrative = `Expect ${narrativeParts[0]}, ${narrativeParts[1]}, and ${narrativeParts[2]}.`;
    }
    // Capitalize first letter
    narrative = narrative.charAt(0).toUpperCase() + narrative.slice(1);
  } else {
    narrative = "Standard mountain conditions expected today.";
  }

  return { tags, narrative };
}

// ── Main Entry Point ─────────────────────────────────────────

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
    input.userReports,
  );

  const { tags, narrative } = synthesizeGridData(input);

  return { condRating, pctOfNormal, trend7d, outlook, outlookLabel, tags, narrative };
}
