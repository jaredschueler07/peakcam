// ─────────────────────────────────────────────────────────────
// lib/pipeline/writes.ts
// The three writes every snow sync performs, in one place.
//
// `insertSnowReport`, `updateResortRating` and `upsertSnowpackDaily` used to
// exist three times over with the same body (scripts/snotel-sync.ts,
// scripts/model-sync.ts, lib/pipeline/orchestrator.ts), including three
// copies of the `"tag1,tag2||narrative"` encoding that
// `snow_reports.conditions` overloads. `fetchUserReports` was byte-identical
// in the two sync scripts.
//
// Anything that appends to `snow_reports` or patches `resorts.cond_rating`
// should go through this module so the encoding and the rounding rules stay
// in one place.
// ─────────────────────────────────────────────────────────────

import type { UserConditionReport } from "../conditions-engine";
import {
  sbInsert,
  sbPatch,
  sbSelectOrEmpty,
  sbUpsert,
  type SupabaseRestConfig,
} from "../supabase-rest";

/**
 * `snow_reports.conditions` is an overloaded string: comma-joined tags, then
 * `||`, then the narrative. Consumers split on `||` (ConditionsStrip,
 * ComparePage, lib/map-utils.ts).
 */
export function encodeConditions(tags: string[], narrative: string): string {
  return `${tags.join(",")}||${narrative}`;
}

function roundOrNull(n: number | null | undefined): number | null {
  return n == null ? null : Math.round(n);
}

/** One append to the `snow_reports` table (the table is append-only). */
export interface SnowReportWrite {
  resortId: string;
  /** Rounded to a whole inch on write. */
  baseDepthIn: number | null;
  newSnow24h: number | null;
  newSnow48h: number | null;
  sweIn: number | null;
  pctOfNormal: number | null;
  trend7d: string | null;
  outlook: string | null;
  /** Nullable: the blender can produce a result with no rating. */
  condRating: string | null;
  tags: string[];
  narrative: string;
  /** Omitted from the row entirely when undefined (the pipeline never sets it). */
  snowingNow?: boolean;
  /** `snotel` | `open_meteo` | `pipeline` — identifies the writer. */
  source: string;
}

export async function insertSnowReport(
  cfg: SupabaseRestConfig,
  write: SnowReportWrite,
): Promise<void> {
  const body: Record<string, unknown> = {
    resort_id: write.resortId,
    base_depth: roundOrNull(write.baseDepthIn),
    new_snow_24h: roundOrNull(write.newSnow24h),
    new_snow_48h: roundOrNull(write.newSnow48h),
    swe_in: write.sweIn,
    pct_of_normal: write.pctOfNormal,
    trend_7d: write.trend7d,
    outlook: write.outlook,
    auto_cond_rating: write.condRating,
    conditions: encodeConditions(write.tags, write.narrative),
    source: write.source,
    updated_at: new Date().toISOString(),
  };
  if (write.snowingNow !== undefined) body.snowing_now = write.snowingNow;

  await sbInsert(cfg, "snow_reports", body, {
    errorLabel: "snow_reports insert failed",
  });
}

export async function updateResortRating(
  cfg: SupabaseRestConfig,
  resortId: string,
  condRating: string,
): Promise<void> {
  await sbPatch(
    cfg,
    "resorts",
    `id=eq.${resortId}`,
    { cond_rating: condRating },
    { errorLabel: "resorts.cond_rating update failed" },
  );
}

/**
 * One row of `snowpack_daily`. Only `resort_id`, `station_id` and `date` are
 * required; everything else is written as supplied (model-sync sends only a
 * depth, snotel-sync sends the full QC'd reading).
 */
export interface SnowpackDailyWrite {
  resort_id: string;
  station_id: string;
  date: string;
  snow_depth_in?: number | null;
  swe_in?: number | null;
  precip_accum_in?: number | null;
  temp_obs_f?: number | null;
  temp_max_f?: number | null;
  temp_min_f?: number | null;
  qc_flag?: string | null;
}

export async function upsertSnowpackDaily(
  cfg: SupabaseRestConfig,
  row: SnowpackDailyWrite,
): Promise<void> {
  await sbUpsert(cfg, "snowpack_daily", row, {
    errorLabel: "snowpack_daily upsert failed",
  });
}

/**
 * Unflagged user condition reports for one resort from the last 24 hours.
 * Feeds the 70/30 SNOTEL/user blend in lib/conditions-engine.ts.
 * Best-effort: returns `[]` rather than throwing, so a resort still syncs
 * when this query fails.
 */
export async function fetchUserReports(
  cfg: SupabaseRestConfig,
  resortId: string,
): Promise<UserConditionReport[]> {
  const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
  return sbSelectOrEmpty<UserConditionReport>(
    cfg,
    `/user_conditions?resort_id=eq.${resortId}&is_flagged=eq.false` +
      `&submitted_at=gte.${cutoff}&select=snow_quality,visibility,wind,trail_conditions`,
  );
}
