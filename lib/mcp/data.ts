// ─────────────────────────────────────────────────────────────
// MCP server — production data source.
//
// The one place the MCP tools touch the network: the same cached catalogue
// read as /api/v1 (lib/public-api/data.ts), the NWS forecast helper the
// resort page uses, a 15-minute-cached read of `snowpack_daily`
// (public-read, migration 005), the `cam_still_timeline` view (migration
// 024) and an anon insert into `agent_memory` for unmatched /ask questions
// (migration 003 grants anon insert). Importing this module imports the anon
// Supabase client, which throws without env — so only the routes import it;
// tests inject a fixture McpDataSource instead.
// ─────────────────────────────────────────────────────────────

import { unstable_cache } from "next/cache";
import { loadPublicApiCatalog } from "@/lib/public-api/data";
import { PUBLIC_API_REVALIDATE_SECONDS } from "@/lib/public-api/headers";
import { getCamStillFrames, supabase } from "@/lib/supabase";
import { getWeatherForecast } from "@/lib/weather";
import type { McpDataSource, SnowHistoryRow, UnmatchedQuestion } from "./types";

export const SNOW_HISTORY_COLUMNS = "date,station_id,snow_depth_in,swe_in,precip_accum_in,temp_max_f,temp_min_f,qc_flag";

async function fetchSnowHistory(resortId: string, days: number): Promise<SnowHistoryRow[]> {
  const { data, error } = await supabase
    .from("snowpack_daily")
    .select(SNOW_HISTORY_COLUMNS)
    .eq("resort_id", resortId)
    .order("date", { ascending: false })
    .limit(days);
  if (error) throw error;
  return (data ?? []) as unknown as SnowHistoryRow[];
}

// Keyed by (resortId, days) automatically; one cold read per distinct call
// per 15 minutes, same tag as the catalogue so a manual purge clears both.
const getSnowHistoryCached = unstable_cache(fetchSnowHistory, ["peakcam:mcp:snow-history:v1"], {
  revalidate: PUBLIC_API_REVALIDATE_SECONDS,
  tags: ["peakcam-resort-catalog"],
});

// Frames arrive every 6 h (cam-stills launchd job), so a 15-minute window
// per (filter, hours) loses nothing.
const getCamStillFramesCached = unstable_cache(
  (camId: string | null, resortId: string | null, hours: number) =>
    getCamStillFrames(camId ? { camId } : { resortId: resortId ?? undefined }, hours),
  ["peakcam:mcp:cam-stills:v1"],
  { revalidate: PUBLIC_API_REVALIDATE_SECONDS, tags: ["peakcam-resort-catalog"] },
);

/** `agent_memory.entity` for logged questions; `select … where entity = …` to review them. */
export const UNMATCHED_QUESTION_ENTITY = "ask:unmatched";
/** Logged rows expire after this many days (the table's optional TTL column). */
export const UNMATCHED_QUESTION_TTL_DAYS = 30;

async function logUnmatchedQuestion(entry: UnmatchedQuestion): Promise<void> {
  const expires = new Date(Date.now() + UNMATCHED_QUESTION_TTL_DAYS * 86_400_000).toISOString();
  const { error } = await supabase.from("agent_memory").insert({
    entity: UNMATCHED_QUESTION_ENTITY,
    fact: entry.question,
    source_agent: `ask-${entry.via}`,
    source_thread: entry.ipHash,
    confidence: 0.5,
    expires_at: expires,
  });
  if (error) console.warn("[ask] could not log unmatched question:", error.message);
}

export const productionDataSource: McpDataSource = {
  catalog: loadPublicApiCatalog,
  // getWeatherForecast() fetches with `next: { revalidate: 3600 }`, so the
  // Data Cache holds each grid point's forecast for an hour.
  forecast: (resort) => getWeatherForecast(resort.lat, resort.lng),
  snowHistory: (resortId, days) => getSnowHistoryCached(resortId, days),
  camStills: (filter, hours) => getCamStillFramesCached(filter.camId ?? null, filter.resortId ?? null, hours),
  logUnmatchedQuestion,
};
