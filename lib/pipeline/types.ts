// ─────────────────────────────────────────────────────────────
// PeakCam — Multi-Source Data Pipeline Types
// Common intermediate format for all data sources.
// Each fetcher writes SourceReadings; the blender combines them
// into a single BlendedResult per resort.
// ─────────────────────────────────────────────────────────────

import type { ConditionRating, SnowTrend, SnowOutlook } from "../types";

// ── Data Sources ─────────────────────────────────────────────

export type SourceName =
  | "snotel"
  | "nws"
  | "liftie"
  | "snodas"
  | "weather_unlocked"
  | "openskistats"
  | "user_reports";

// Source reliability weights (0.0–1.0) used by the blender.
// Higher = more trusted for the dimensions that source covers.
export const SOURCE_WEIGHTS: Record<SourceName, number> = {
  snotel: 1.0,            // Direct physical measurement
  snodas: 0.7,            // Modeled from multiple inputs, 1km grid
  nws: 0.8,               // Authoritative forecast
  weather_unlocked: 0.6,  // Elevation-specific forecast supplement
  liftie: 1.0,            // Direct from resort reporting systems
  user_reports: 0.3,      // Subjective, varies by report count
  openskistats: 0.9,      // Static reference data (high for metadata)
};

// ── Source Reading (common intermediate format) ──────────────

export interface SourceReading {
  resort_id: string;
  source: SourceName;
  reading_date: string;       // ISO date (YYYY-MM-DD)
  fetched_at: string;         // ISO timestamp

  // Snow measurements (inches)
  snow_depth_in: number | null;
  swe_in: number | null;
  new_snow_24h_in: number | null;
  new_snow_48h_in: number | null;

  // Temperature (Fahrenheit)
  temp_f: number | null;
  temp_high_f: number | null;
  temp_low_f: number | null;

  // Forecast / outlook
  forecast_snow_48h_in: number | null;
  forecast_high_48h_f: number | null;

  // Lift / trail operations
  lifts_open: number | null;
  lifts_total: number | null;
  trails_open: number | null;
  trails_total: number | null;

  // Qualitative signals (normalized 0.0–1.0)
  quality_score: number | null;
  visibility_score: number | null;
  wind_score: number | null;

  // Weather observations
  sky_cover_pct: number | null;
  wind_gust_mph: number | null;
  snow_level_ft: number | null;

  // Source confidence (0.0–1.0, set by the fetcher)
  source_confidence: number;

  // Raw payload for debugging (stored as JSONB)
  raw_json: Record<string, unknown> | null;
}

// ── Blended Result (output of the blending engine) ──────────

export interface BlendedResult {
  resort_id: string;
  updated_at: string;

  // Blended snow measurements
  snow_depth_in: number | null;
  swe_in: number | null;
  new_snow_24h_in: number | null;
  new_snow_48h_in: number | null;
  pct_of_normal: number | null;

  // Blended forecast
  forecast_snow_48h_in: number | null;
  forecast_high_48h_f: number | null;

  // Operations (single-source from Liftie)
  lifts_open: number | null;
  lifts_total: number | null;
  trails_open: number | null;
  trails_total: number | null;

  // Conditions engine output
  cond_rating: ConditionRating | null;
  trend_7d: SnowTrend | null;
  outlook: SnowOutlook | null;
  outlook_label: string | null;
  tags: string[];
  narrative: string | null;

  // Confidence
  confidence_score: number;         // 0.0–1.0 overall
  source_count: number;
  sources_used: SourceName[];

  // Per-dimension confidence
  snow_depth_confidence: number;
  forecast_confidence: number;
  ops_confidence: number;
}

// ── Resort Metadata (static, from OpenSkiStats + manual) ────

export interface ResortMetadata {
  resort_id: string;
  openskistats_id: string | null;
  elevation_base_ft: number | null;
  elevation_summit_ft: number | null;
  vertical_drop_ft: number | null;
  run_count: number | null;
  lift_count: number | null;
  liftie_slug: string | null;
  weather_unlocked_id: string | null;
  snodas_grid_x: number | null;
  snodas_grid_y: number | null;
}

// ── Fetcher interface ───────────────────────────────────────

export interface ResortContext {
  id: string;
  slug: string;
  name: string;
  lat: number;
  lng: number;
  snotel_station_id: string | null;
  metadata: ResortMetadata | null;
}

export type FetcherFn = (
  resort: ResortContext,
) => Promise<SourceReading | null>;

// ── Helpers ─────────────────────────────────────────────────

export function emptyReading(
  resort_id: string,
  source: SourceName,
): SourceReading {
  return {
    resort_id,
    source,
    reading_date: new Date().toISOString().slice(0, 10),
    fetched_at: new Date().toISOString(),
    snow_depth_in: null,
    swe_in: null,
    new_snow_24h_in: null,
    new_snow_48h_in: null,
    temp_f: null,
    temp_high_f: null,
    temp_low_f: null,
    forecast_snow_48h_in: null,
    forecast_high_48h_f: null,
    lifts_open: null,
    lifts_total: null,
    trails_open: null,
    trails_total: null,
    quality_score: null,
    visibility_score: null,
    wind_score: null,
    sky_cover_pct: null,
    wind_gust_mph: null,
    snow_level_ft: null,
    source_confidence: SOURCE_WEIGHTS[source],
    raw_json: null,
  };
}
