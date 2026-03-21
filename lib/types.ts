// ─────────────────────────────────────────────────────────────
// PeakCam — Database Types
// Mirror of the Supabase schema. Keep in sync with migrations.
// ─────────────────────────────────────────────────────────────

export type ConditionRating = "great" | "good" | "fair" | "poor";
export type EmbedType = "youtube" | "iframe" | "link";
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
export type UserSnowQuality = "powder" | "packed" | "icy" | "slush";
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
  dow: string;             // "Today", "Mon", "Tue" …
  icon: string;            // emoji
  high: number;            // °F
  low: number | null;      // °F — null on overnight periods
  snowInches: number;      // estimated snow inches (0 if none)
  shortForecast: string;   // "Heavy Snow", "Sunny" etc.
}
