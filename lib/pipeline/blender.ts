// ─────────────────────────────────────────────────────────────
// PeakCam — Multi-Source Blender
// Merges SourceReadings from all fetchers into a single
// BlendedResult per resort, then feeds into the conditions
// engine for rating, trend, outlook, tags, and narrative.
// ─────────────────────────────────────────────────────────────

import type { SourceReading, BlendedResult, SourceName, ResortContext } from "./types";
import { SOURCE_WEIGHTS } from "./types";
import { PRECIP_PROB_KEY } from "./fetchers/nws";
import {
  computeDimensionConfidence,
  computeOverallConfidence,
} from "./confidence";
import { computeConditions } from "../conditions-engine";
import type {
  ConditionsInput,
  UserConditionReport,
} from "../conditions-engine";

/**
 * Elevation sentinel used when a resort's base elevation is unknown.
 * Matches scripts/snotel-sync.ts and scripts/model-sync.ts: a value this high
 * means the forecast snow level can never sit below the base, so the
 * "Rain at Base" tag never fires on a guessed elevation.
 */
export const UNKNOWN_ELEV_FT = 99999;

export interface BlendOptions {
  /** Resort base elevation in feet. Null/undefined → UNKNOWN_ELEV_FT sentinel. */
  resortElevBaseFt?: number | null;
  /**
   * Recent unflagged user condition reports for this resort. Feeds the
   * conditions engine's 70/30 SNOTEL/user blend (needs ≥2 reports).
   * When omitted, the blender falls back to the sample the user_reports
   * fetcher stashes in its reading's raw_json.
   */
  userReports?: UserConditionReport[];
}

const USER_REPORT_QUALITIES = new Set(["powder", "packed", "crud", "ice", "spring"]);

/**
 * Recover individual user reports from the user_reports SourceReading.
 * The fetcher stores a capped sample (5 reports) in raw_json alongside the
 * aggregate quality_score, which is the only per-report signal that survives
 * into the pipeline's reading format.
 */
function extractUserReports(readings: SourceReading[]): UserConditionReport[] {
  const reading = readings.find((r) => r.source === "user_reports");
  const raw = reading?.raw_json?.reports;
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is UserConditionReport => {
    if (typeof r !== "object" || r === null) return false;
    const rec = r as Record<string, unknown>;
    return (
      typeof rec.snow_quality === "string" &&
      USER_REPORT_QUALITIES.has(rec.snow_quality) &&
      typeof rec.visibility === "string" &&
      typeof rec.wind === "string" &&
      typeof rec.trail_conditions === "string"
    );
  });
}

// ── Helpers ─────────────────────────────────────────────────

/** Extract non-null values and their corresponding source weights. */
function collectField(
  readings: SourceReading[],
  field: keyof SourceReading,
): { values: number[]; weights: number[] } {
  const values: number[] = [];
  const weights: number[] = [];
  for (const r of readings) {
    const v = r[field];
    if (typeof v === "number" && v != null) {
      values.push(v);
      weights.push(SOURCE_WEIGHTS[r.source]);
    }
  }
  return { values, weights };
}

/** Weighted average of values using corresponding weights. */
function weightedAvg(values: number[], weights: number[]): number | null {
  if (values.length === 0) return null;
  let totalWeight = 0;
  let totalValue = 0;
  for (let i = 0; i < values.length; i++) {
    totalValue += values[i] * weights[i];
    totalWeight += weights[i];
  }
  return totalWeight > 0 ? totalValue / totalWeight : null;
}

/** Return the maximum value, or null if empty. */
function maxVal(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.max(...values);
}

// ── Conditions Engine Input ─────────────────────────────────

/** The blended scalar values the conditions engine consumes. */
export interface BlendedFields {
  snow_depth_in: number | null;
  swe_in: number | null;
  new_snow_24h_in: number | null;
  new_snow_48h_in: number | null;
  forecast_snow_48h_in: number | null;
  forecast_high_48h_f: number | null;
}

/**
 * Build the ConditionsInput the conditions engine consumes, the same shape
 * scripts/snotel-sync.ts and scripts/model-sync.ts build. Exported so the real
 * base elevation and user-report wiring are directly testable.
 */
export function buildConditionsInput(
  readings: SourceReading[],
  blended: BlendedFields,
  options: BlendOptions = {},
): ConditionsInput {
  const {
    snow_depth_in,
    swe_in,
    new_snow_24h_in,
    new_snow_48h_in,
    forecast_snow_48h_in,
    forecast_high_48h_f,
  } = blended;

  const userReports = options.userReports ?? extractUserReports(readings);

  const condInput: ConditionsInput = {
    current: {
      snowDepthIn: snow_depth_in,
      sweIn: swe_in,
      newSnow24h: new_snow_24h_in ?? 0,
      newSnow48h: new_snow_48h_in ?? 0,
    },
    normals: {
      // No fetcher supplies 30-year normals: SourceReading has no median/
      // percentile SWE fields, so pct_of_normal necessarily comes out null
      // here. computeConditions() derives it from these, so it stays the one
      // place that math lives.
      medianSweIn: null,
      pctile10SweIn: null,
      pctile90SweIn: null,
    },
    history7d: {
      sweValues: [], // Not available from single-day readings
    },
    forecast: {
      snowInchesNext48h: forecast_snow_48h_in ?? 0,
      maxHighTemp48h: forecast_high_48h_f ?? 32,
    },
    userReports: userReports.length > 0 ? userReports : undefined,
  };

  // Add NWS grid data if available
  const nwsReading = readings.find((r) => r.source === "nws");
  if (nwsReading) {
    condInput.nwsGrid = {
      skyCoverAvg: nwsReading.sky_cover_pct ?? 50,
      windGustMax: nwsReading.wind_gust_mph ?? 0,
      windChillAvg: nwsReading.temp_f ?? 32,
      snowLevelAvg: nwsReading.snow_level_ft ?? 5000,
      resortElevBase: options.resortElevBaseFt ?? UNKNOWN_ELEV_FT,
      iceAccumulationMax: 0,
      probOfPrecipMax: readPrecipProbability(nwsReading),
    };
  }

  return condInput;
}

/**
 * The NWS fetcher has no typed column for precipitation probability, so it
 * stashes the 48h max under raw_json. Missing/invalid → 0 (tag stays off).
 */
function readPrecipProbability(reading: SourceReading): number {
  const v = reading.raw_json?.[PRECIP_PROB_KEY];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

// ── Main Blender ────────────────────────────────────────────

export function blendReadings(
  readings: SourceReading[],
  resort_id: string,
  options: BlendOptions = {},
): BlendedResult {
  const now = new Date().toISOString();

  // Edge case: no readings at all
  if (readings.length === 0) {
    return emptyBlendedResult(resort_id, now);
  }

  // Collect unique sources
  const sourcesUsed = Array.from(new Set(readings.map((r) => r.source))) as SourceName[];

  // ── Snow depth / SWE: weighted average ──────────────────
  const depthData = collectField(readings, "snow_depth_in");
  const sweData = collectField(readings, "swe_in");
  const snow_depth_in = weightedAvg(depthData.values, depthData.weights);
  const swe_in = weightedAvg(sweData.values, sweData.weights);

  // ── New snow: take maximum (conservative — report more snow) ──
  const new24 = collectField(readings, "new_snow_24h_in");
  const new48 = collectField(readings, "new_snow_48h_in");
  const new_snow_24h_in = maxVal(new24.values);
  const new_snow_48h_in = maxVal(new48.values);

  // ── Forecast: weighted avg, but take higher snow forecast ──
  const fcstSnow = collectField(readings, "forecast_snow_48h_in");
  const fcstTemp = collectField(readings, "forecast_high_48h_f");
  const forecast_snow_48h_in = maxVal(fcstSnow.values);
  const forecast_high_48h_f = weightedAvg(fcstTemp.values, fcstTemp.weights);

  // ── Operations: use liftie data directly (single source) ──
  const liftieReading = readings.find((r) => r.source === "liftie");
  const lifts_open = liftieReading?.lifts_open ?? null;
  const lifts_total = liftieReading?.lifts_total ?? null;
  const trails_open = liftieReading?.trails_open ?? null;
  const trails_total = liftieReading?.trails_total ?? null;

  // ── Qualitative: average user report scores ───────────────
  const qualData = collectField(readings, "quality_score");

  // ── User reports ──────────────────────────────────────────
  // Prefer reports handed in by the caller; otherwise recover the sample the
  // user_reports fetcher stashes in raw_json. Either way they must reach the
  // conditions engine, which applies the 70/30 SNOTEL/user blend.
  const userReports = options.userReports ?? extractUserReports(readings);

  // ── Conditions Engine ─────────────────────────────────────
  const condInput = buildConditionsInput(
    readings,
    {
      snow_depth_in,
      swe_in,
      new_snow_24h_in,
      new_snow_48h_in,
      forecast_snow_48h_in,
      forecast_high_48h_f,
    },
    { ...options, userReports },
  );

  const conditions = computeConditions(condInput);
  const {
    condRating,
    pctOfNormal: pct_of_normal,
    trend7d: trend_7d,
    outlook,
    outlookLabel,
    tags,
    narrative,
  } = conditions;

  // ── Confidence Scores ─────────────────────────────────────
  const snowConfidence = computeDimensionConfidence(
    [...depthData.values, ...sweData.values],
    [...depthData.weights, ...sweData.weights],
  );

  const forecastConfidence = computeDimensionConfidence(
    [...fcstSnow.values, ...fcstTemp.values],
    [...fcstSnow.weights, ...fcstTemp.weights],
  );

  const opsValues: number[] = [];
  const opsWeights: number[] = [];
  if (liftieReading) {
    if (liftieReading.lifts_open != null) {
      opsValues.push(liftieReading.lifts_open);
      opsWeights.push(SOURCE_WEIGHTS.liftie);
    }
    if (liftieReading.trails_open != null) {
      opsValues.push(liftieReading.trails_open);
      opsWeights.push(SOURCE_WEIGHTS.liftie);
    }
  }
  const opsConfidence = computeDimensionConfidence(opsValues, opsWeights);

  const qualConfidence = computeDimensionConfidence(
    qualData.values,
    qualData.weights,
  );

  const confidence_score = computeOverallConfidence({
    snow: snowConfidence,
    forecast: forecastConfidence,
    ops: opsConfidence,
    qualitative: qualConfidence,
  });

  return {
    resort_id,
    updated_at: now,
    snow_depth_in,
    swe_in,
    new_snow_24h_in,
    new_snow_48h_in,
    pct_of_normal,
    forecast_snow_48h_in,
    forecast_high_48h_f,
    lifts_open,
    lifts_total,
    trails_open,
    trails_total,
    cond_rating: condRating,
    trend_7d,
    outlook,
    outlook_label: outlookLabel,
    tags,
    narrative,
    confidence_score,
    source_count: sourcesUsed.length,
    sources_used: sourcesUsed,
    snow_depth_confidence: snowConfidence,
    forecast_confidence: forecastConfidence,
    ops_confidence: opsConfidence,
  };
}

/**
 * Convenience wrapper matching the orchestrator's call signature:
 * blend(resort, readings) → BlendedResult
 */
export function blend(
  resort: ResortContext,
  readings: SourceReading[],
  options: BlendOptions = {},
): BlendedResult {
  return blendReadings(readings, resort.id, {
    resortElevBaseFt: resort.metadata?.elevation_base_ft ?? null,
    ...options,
  });
}

// ── Empty Result ────────────────────────────────────────────

function emptyBlendedResult(
  resort_id: string,
  updated_at: string,
): BlendedResult {
  return {
    resort_id,
    updated_at,
    snow_depth_in: null,
    swe_in: null,
    new_snow_24h_in: null,
    new_snow_48h_in: null,
    pct_of_normal: null,
    forecast_snow_48h_in: null,
    forecast_high_48h_f: null,
    lifts_open: null,
    lifts_total: null,
    trails_open: null,
    trails_total: null,
    cond_rating: null,
    trend_7d: null,
    outlook: null,
    outlook_label: null,
    tags: [],
    narrative: null,
    confidence_score: 0,
    source_count: 0,
    sources_used: [],
    snow_depth_confidence: 0,
    forecast_confidence: 0,
    ops_confidence: 0,
  };
}
