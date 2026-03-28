// ─────────────────────────────────────────────────────────────
// PeakCam — Multi-Source Blender
// Merges SourceReadings from all fetchers into a single
// BlendedResult per resort, then feeds into the conditions
// engine for rating, trend, outlook, tags, and narrative.
// ─────────────────────────────────────────────────────────────

import type { SourceReading, BlendedResult, SourceName, ResortContext } from "./types";
import { SOURCE_WEIGHTS } from "./types";
import {
  computeDimensionConfidence,
  computeOverallConfidence,
} from "./confidence";
import {
  computeConditionRating,
  computeTrend,
  computeOutlook,
  computePctOfNormal,
  synthesizeGridData,
} from "../conditions-engine";
import type { ConditionsInput } from "../conditions-engine";

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

// ── Main Blender ────────────────────────────────────────────

export function blendReadings(
  readings: SourceReading[],
  resort_id: string,
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

  // ── Percent of normal ─────────────────────────────────────
  // We don't have normals in the readings; compute from blended SWE
  // against whatever the conditions engine has. For now pass null
  // and let the conditions engine handle it if normals are provided.
  const pct_of_normal: number | null = null;

  // ── Conditions Engine ─────────────────────────────────────
  // Build a ConditionsInput from blended values
  const condInput: ConditionsInput = {
    current: {
      snowDepthIn: snow_depth_in,
      sweIn: swe_in,
      newSnow24h: new_snow_24h_in ?? 0,
      newSnow48h: new_snow_48h_in ?? 0,
    },
    normals: {
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
  };

  // Add NWS grid data if available
  const nwsReading = readings.find((r) => r.source === "nws");
  if (nwsReading) {
    condInput.nwsGrid = {
      skyCoverAvg: nwsReading.sky_cover_pct ?? 50,
      windGustMax: nwsReading.wind_gust_mph ?? 0,
      windChillAvg: nwsReading.temp_f ?? 32,
      snowLevelAvg: nwsReading.snow_level_ft ?? 5000,
      resortElevBase: 5000, // Will be overridden by orchestrator with actual metadata
      iceAccumulationMax: 0,
      probOfPrecipMax: 0,
    };
  }

  const condRating = computeConditionRating(
    condInput.current.newSnow24h,
    condInput.current.newSnow48h,
    condInput.current.snowDepthIn,
    pct_of_normal,
  );

  const trend_7d = computeTrend(condInput.history7d.sweValues);

  const { outlook, outlookLabel } = computeOutlook(
    trend_7d,
    condInput.forecast.snowInchesNext48h,
    condInput.forecast.maxHighTemp48h,
  );

  const { tags, narrative } = synthesizeGridData(condInput);

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
): BlendedResult {
  return blendReadings(readings, resort.id);
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
