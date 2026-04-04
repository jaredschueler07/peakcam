// ─────────────────────────────────────────────────────────────
// PeakCam — Database Types
// Mirror of the Supabase schema. Keep in sync with migrations.
// ─────────────────────────────────────────────────────────────

export type ConditionRating = "great" | "good" | "fair" | "poor";
export type EmbedType = "youtube" | "iframe" | "image" | "link";
export type SnowReportSource = "snotel" | "manual" | "resort";

// ── Resorts ──────────────────────────────────────────────────
export interface Resort {
  id: string;
  name: string;
  slug: string;
  state: string;
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
}

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
  last_checked_at: string | null;
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
  snowing_now: boolean;
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
  submitted_at: string;
}

// ── NWS Weather ──────────────────────────────────────────────
export interface WeatherPeriod {
  dow: string;                    // "Today", "Mon", "Tue" …
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
