// ─────────────────────────────────────────────────────────────
// MCP server — the data layer the tools talk to.
//
// Type-only module (nothing imported at runtime) so lib/mcp/tools.ts and the
// tests can depend on it without pulling in next/cache or the Supabase
// client. lib/mcp/data.ts is the production implementation; the tests build
// one from fixtures.
// ─────────────────────────────────────────────────────────────

import type { ResortWithData, WeatherPeriod } from "@/lib/types";
import type { PublicApiCatalog } from "@/lib/public-api/data";
import type { CamTimelineFrame } from "@/lib/cam-timeline";

/** One `snowpack_daily` row (migration 005), the columns the history tool reads. */
export interface SnowHistoryRow {
  /** YYYY-MM-DD. */
  date: string;
  /** NRCS triplet, or `open-meteo` for the model-sync rows. */
  station_id: string;
  snow_depth_in: number | null;
  swe_in: number | null;
  precip_accum_in: number | null;
  temp_max_f: number | null;
  temp_min_f: number | null;
  qc_flag: string;
}

/** Which cams' archived frames `camStills` should read. Exactly one key is set. */
export interface CamStillFilter {
  camId?: string;
  resortId?: string;
}

/** An unmatched /ask question, logged for review. No raw IP, no account data. */
export interface UnmatchedQuestion {
  /** The question, trimmed and truncated by the caller. */
  question: string;
  /** Salted hash of the caller's IP, or null when the caller had none (MCP). */
  ipHash: string | null;
  /** `api` for /api/v1/ask and /ask, `mcp` for the ask tool. */
  via: "api" | "mcp";
}

export interface McpDataSource {
  /** The cached catalogue read shared with /api/v1 (resorts, openings, elevations, now). */
  catalog(): Promise<PublicApiCatalog>;
  /** NWS 5-day forecast for a resort; null when NWS does not answer or does not cover the point. */
  forecast(resort: Pick<ResortWithData, "lat" | "lng" | "country">): Promise<WeatherPeriod[] | null>;
  /** The most recent `days` rows of `snowpack_daily` for a resort, newest first. */
  snowHistory(resortId: string, days: number): Promise<SnowHistoryRow[]>;
  /**
   * Archived frames from the public `cam_still_timeline` view (migration 024)
   * for one cam or every archive-allowed cam of a resort: everything inside
   * the last `hours` plus the newest storm keeper per cam, any order. Null
   * when the view is unavailable (the tool then answers "no archive").
   */
  camStills(filter: CamStillFilter, hours: number): Promise<CamTimelineFrame[] | null>;
  /**
   * Record a question the ask router could not answer. Optional and
   * fire-and-forget: a failure must never surface to the caller.
   */
  logUnmatchedQuestion?(entry: UnmatchedQuestion): Promise<void>;
}
