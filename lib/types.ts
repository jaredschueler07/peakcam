// ─────────────────────────────────────────────────────────────
// PeakCam — Database Types
// Mirror of the Supabase schema. Keep in sync with migrations.
// ─────────────────────────────────────────────────────────────

export type ConditionRating = "great" | "good" | "fair" | "poor";
export type EmbedType = "youtube" | "iframe" | "image" | "link";
export type SnowReportSource = "snotel" | "manual" | "resort" | "pipeline" | "open_meteo";

// ── Resorts ──────────────────────────────────────────────────
export interface Resort {
  id: string;
  name: string;
  slug: string;
  state: string;
  country: string;         // "US" | "CA" | "CL" | "AR"
  region: string;
  lat: number;
  lng: number;
  website_url: string | null;
  cam_page_url: string | null;
  cond_rating: ConditionRating;
  snotel_station_id: string | null;
  x_url: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  is_active: boolean;
  created_at: string;
  // Migration 025 — resort profile. Optional so older fixtures still type-check;
  // null in prod until the P2 enrichment / importer fills them.
  runs_total?: number | null;
  lifts_total?: number | null;
  skiable_acres?: number | null;
  vertical_ft?: number | null;
  annual_snowfall_in?: number | null;
  longest_run_mi?: number | null;
  description?: string | null;
  description_source?: DescriptionSource | null;
  trail_map_url?: string | null;
  wikidata_id?: string | null;
  aliases?: string[];
  passes?: ResortPass[];
  elevation_base_ft?: number | null;    // canonical home from 025 (resort_metadata is the legacy copy)
  elevation_summit_ft?: number | null;
}

export type DescriptionSource = "operator" | "generated" | "editor";
export type ResortPass = "ikon" | "epic" | "mountain-collective" | "indy" | "power";

// ── Cams ─────────────────────────────────────────────────────
export interface Cam {
  id: string;
  resort_id: string;
  name: string;
  elevation: string | null;
  embed_type: EmbedType;
  embed_url: string | null;      // iframe src URL or link-out URL
  youtube_id: string | null;     // YouTube video/stream ID
  is_active: boolean;
  consecutive_failures: number;
  auto_disabled: boolean;
  last_checked_at: string | null;
  created_at: string;
  // Migration 022 — optional so older fixtures and rows still type-check.
  preview_rank?: number | null;      // card-preview order within the resort; lower first, null last
  card_preview?: boolean;            // false: never front the resort card (dead/placeholder/wrong view)
  still_url?: string | null;         // frame captured by scripts/cam-capture-stills.ts
  still_captured_at?: string | null;
  still_source?: string | null;
  // Migration 024 — rights switch for the still archive (docs/cams/still-archive-policy.md).
  archive_allowed?: boolean;
  // Migration 025 — what the cam looks at, credit line, operator terms.
  kind?: CamKind | null;
  credit?: string | null;
  source_terms_url?: string | null;
}

export type CamKind = "summit" | "mid" | "base" | "snow-stake" | "village" | "approach";

/** Migration 025 — rendered clip per cam (P8 writes these). */
export interface CamTimelapse {
  id: string;
  cam_id: string;
  window: string;               // "24h" | "storm" | a label the render job defines
  url: string;
  frames: number | null;
  rendered_at: string;
  storm_date: string | null;    // YYYY-MM-DD for storm clips
}

// ── Station layer (migration 026, P3 writes these) ───────────
export type StationKind = "snotel" | "scan" | "nws_obs" | "metar" | "ghcn" | "bc_asws" | "eccc" | "road_cam";
export type StationRole = "summit" | "mid" | "base" | "approach";

export interface StationRow {
  id: string;
  source: string;
  source_id: string;
  name: string | null;
  lat: number | null;
  lng: number | null;
  elevation_ft: number | null;
  kind: StationKind;
}

export interface ResortStation {
  resort_id: string;
  station_id: string;
  role: StationRole;
  distance_km: number | null;
  rank: number;
}

export interface StationObservation {
  station_id: string;
  observed_at: string;
  snow_depth_in: number | null;
  swe_in: number | null;
  new_snow_in: number | null;
  temp_f: number | null;
  wind_mph: number | null;
  source_payload: Record<string, unknown> | null;
}

// ── Forecasts (migration 027, P4 writes these) ───────────────
export type ForecastPoint = "summit" | "base";

export interface ForecastRunRow {
  id: string;
  resort_id: string;
  point: ForecastPoint;
  model: string;
  issued_at: string;
  horizon_days: number;
}

export interface ForecastDailyRow {
  run_id: string;
  date: string;                 // YYYY-MM-DD
  snowfall_cm: number | null;
  snowfall_lo: number | null;
  snowfall_hi: number | null;
  temp_max: number | null;
  temp_min: number | null;
  precip_prob: number | null;
  wind_gust: number | null;
  weather_code: number | null;
}

export interface ForecastScoreRow {
  resort_id: string;
  model: string;
  period_days: number;
  day1_mae: number | null;
  day3_mae: number | null;
  day7_mae: number | null;
  samples: number | null;
  bias_ratio: number | null;
  computed_at: string;
}

// ── Scores (migration 028, P7 writes these) ──────────────────
export interface ResortScoreRow {
  resort_id: string;
  date: string;                 // YYYY-MM-DD
  score: number;                // 0–100
  rating: ConditionRating | null;
  components: Record<string, number | null>;
  scored_by: string | null;
}

// ── Cam reports ──────────────────────────────────────────────
export type CamReportReason = "broken" | "wrong_view" | "other";

export interface CamReport {
  id: string;
  cam_id: string;
  session_id: string;
  reason: CamReportReason;
  resort_link_dead: boolean;
  suggested_url: string | null;
  user_agent: string | null;
  ip_hash: string | null;
  resolved: boolean;
  resolved_at: string | null;
  admin_note: string | null;
  created_at: string;
}

// ── Snow Reports ─────────────────────────────────────────────
export interface SnowReport {
  id: string;
  resort_id: string;
  base_depth: number | null;       // inches
  new_snow_24h: number | null;     // inches
  new_snow_48h: number | null;     // inches
  trails_open: number | null;
  trails_total: number | null;
  lifts_open: number | null;
  lifts_total: number | null;
  conditions: string | null;       // human-readable e.g. "Powder Day"
  source: SnowReportSource;
  updated_at: string;
  swe_in: number | null;
  pct_of_normal: number | null;
  trend_7d: SnowTrend | null;
  outlook: SnowOutlook | null;
  auto_cond_rating: ConditionRating | null;
  snowing_now: boolean;          // legacy name: current-hour snow forecast, not an observation
}

// ── Snowpack & Conditions Engine Types ───────────────────────
export type QCFlag = "valid" | "suspect" | "missing" | "corrected";
export type SnowTrend = "rising" | "falling" | "stable";
export type SnowOutlook = "more_snow" | "stable" | "warming" | "melt_risk";

export interface SnowpackDaily {
  resort_id: string;
  station_id: string;
  date: string;
  snow_depth_in: number | null;
  swe_in: number | null;
  precip_accum_in: number | null;
  temp_obs_f: number | null;
  temp_max_f: number | null;
  temp_min_f: number | null;
  qc_flag: QCFlag;
}

export interface SnotelNormal {
  station_id: string;
  day_of_water_year: number;
  median_swe_in: number | null;
  median_depth_in: number | null;
  pctile_10_swe_in: number | null;
  pctile_90_swe_in: number | null;
}

// ── User-Verified Conditions ─────────────────────────────────
export type SnowQuality = "powder" | "packed" | "crud" | "ice" | "spring";
export type ComfortLevel = "warm" | "perfect" | "cold" | "freezing";

export interface ConditionVote {
  id: string;
  resort_id: string;
  session_id: string;
  snow_quality: SnowQuality | null;
  comfort: ComfortLevel | null;
  comment: string | null;
  created_at: string;
}

export interface LiveConditions {
  resort_id: string;
  top_snow_quality: SnowQuality | null;
  snow_quality_votes: number;
  snow_quality_score: number;
  top_comfort: ComfortLevel | null;
  comfort_votes: number;
  comfort_score: number;
  total_votes_12h: number;
}

// ── Joined / view types ──────────────────────────────────────
export interface ResortWithData extends Resort {
  snow_report: SnowReport | null;
  cams: Cam[];
}

// ── User Conditions Reports ───────────────────────────────────
export type UserSnowQuality = "powder" | "packed" | "crud" | "ice" | "spring";
export type UserVisibility = "clear" | "foggy" | "whiteout";
export type UserWind = "calm" | "breezy" | "gusty" | "high";
export type UserTrailConditions = "groomed" | "ungroomed" | "moguls" | "variable";

export interface UserCondition {
  id: string;
  resort_id: string;
  user_id: string;
  snow_quality: UserSnowQuality;
  visibility: UserVisibility;
  wind: UserWind;
  trail_conditions: UserTrailConditions;
  notes: string | null;
  is_flagged: boolean;
  /** Prod column is `created_at` (migration 004 said `submitted_at`; see 019). */
  created_at: string;
}

// ── NWS Weather ──────────────────────────────────────────────
export interface WeatherPeriod {
  date?: string;                  // ISO calendar date when available
  dow: string;                    // "Today", "Mon", "Tue" … (up to 7 days)
  condition: string;              // "clear" | "partly-cloudy" | "heavy-snow" etc.
  high: number;                   // °F
  low: number | null;             // °F — null on overnight periods
  snowInches: number;             // estimated snow inches (0 if none)
  shortForecast: string;          // "Heavy Snow", "Sunny" etc.
  windSpeed: number | null;       // mph
  windDirection: string | null;   // "N", "NW", "SSE" etc.
  windGust: number | null;        // mph
  precipProbability: number | null; // 0-100
  feelsLike: number | null;       // °F (wind chill adjusted)
  /** Where `snowInches` came from: the stored multi-model blend (lib/forecast), or the NWS wording heuristic when no blend was available. */
  snowSource?: "blend" | "nws_keyword" | "open_meteo";
}

/** Raw hourly data from NWS */
export interface HourlyWeather {
  time: string;            // ISO timestamp
  temperature: number;     // °F
  windSpeed: number;       // mph
  windDirection: string;   // compass direction
  shortForecast: string;
  condition: string;       // icon key
  snowInches: number;
  precipProbability: number;
  feelsLike: number;
}

/** Bucketed period (morning/afternoon/evening) */
export interface ForecastPeriod {
  day: string;             // "Mon", "Tue" etc.
  period: "morning" | "afternoon" | "evening";
  condition: string;       // dominant condition
  highTemp: number;
  lowTemp: number;
  feelsLike: number;
  windSpeed: number;       // average
  windGust: number;        // max
  windDirection: string;   // dominant
  snowInches: number;      // total
  precipProbability: number; // max
  shortForecast: string;   // most representative
  /** YYYY-MM-DD on the resort's wall clock, so a daily blend can be applied to the day's periods. */
  date?: string;
}

// ── Dashboard & Favorites ────────────────────────────────────
export type FavoriteType = "resort" | "cam" | "region";

export interface UserFavorite {
  id: string;
  user_id: string;
  item_type: FavoriteType;
  item_id: string;
  created_at: string;
}

export interface WidgetConfig {
  id: string;          // corresponds to item_id
  type: FavoriteType;  // determines which component to render
  x: number;
  y: number;
  w: number;
  h: number;
  data?: unknown;          // cache for static info if needed
}

export interface DashboardLayout {
  id: string;
  user_id: string;
  config: {
    widgets: WidgetConfig[];
  };
  updated_at: string;
}

/** A dashboard widget with its referenced resort/cam resolved from the DB.
 *  `missing` marks a favorite whose resort/cam has since been deleted or deactivated. */
export type ResolvedWidget =
  | { kind: "resort"; resort: Resort; snow: SnowReport | null; cams: Cam[] }
  | { kind: "cam"; cam: Cam; resort: Resort | null }
  | { kind: "missing"; type: FavoriteType };

// ── Powder Probabilities (WeatherNext 3, migration 021) ──────
// Derived P(new snow >= 6/8/12 in) per resort and window, from
// per-member ensemble accumulations — never summed per-hour
// percentiles. NOT part of ResortWithData on purpose: browse/map
// must not pay for this until calibration + terms gates pass and a
// surface is approved. See docs/weathernext-powder-probability.md.
export type PowderWindowKind = "next_72h" | "best_7d";
export type PowderProbabilityKind = "raw_frequency" | "calibrated";

/** One `powder_probabilities` row (also the `latest_powder_probabilities` view shape). */
export interface PowderProbability {
  resort_id: string;
  /** WeatherNext run initialization time (ISO). */
  model_init_at: string;
  /** t0: first issuable hour (>= init + ~7h45m dissemination latency). */
  horizon_start_at: string;
  window_kind: PowderWindowKind;
  valid_start: string;
  valid_end: string;
  /** Raw member frequencies until a calibrated variant exists. */
  probability_kind: PowderProbabilityKind;
  calibration_version: string | null;
  p_ge_6in: number;   // 0..1
  p_ge_8in: number;   // 0..1
  p_ge_12in: number;  // 0..1
  members_total: number;
  members_valid: number;
  /** True when fewer than half the members were valid for the window. */
  degraded: boolean;
  members_ge_6in: number;
  members_ge_8in: number;
  members_ge_12in: number;
  /** Distribution of per-member window totals, inches of snow. */
  p10_snow_in: number;
  p25_snow_in: number;
  p50_snow_in: number;
  p75_snow_in: number;
  p90_snow_in: number;
  mean_snow_in: number;
  horizon_truncated: boolean;
  source: string;
  model_version: string | null;
  method_version: string;
  computed_at: string;
  created_at: string;
}

/** The window fields a consumer of a grouped forecast needs. */
export interface PowderProbabilityWindow {
  window_kind: PowderWindowKind;
  valid_start: string;
  valid_end: string;
  p_ge_6in: number;
  p_ge_8in: number;
  p_ge_12in: number;
  p10_snow_in: number;
  p50_snow_in: number;
  p90_snow_in: number;
  degraded: boolean;
}

/**
 * The latest run for one resort, grouped by window. `model_init_at`
 * is the run time (surface it as such — windows are anchored at
 * `horizon_start_at`, not at "now"). `best7d` is null when the
 * latest run has no matching best-window row.
 */
export interface PowderProbabilityForecast {
  resort_id: string;
  model_init_at: string;
  horizon_start_at: string;
  computed_at: string;
  probability_kind: PowderProbabilityKind;
  method_version: string;
  next72h: PowderProbabilityWindow;
  best7d: PowderProbabilityWindow | null;
}
