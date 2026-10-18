// ─────────────────────────────────────────────────────────────
// MCP server — production data source.
//
// The one place the MCP tools touch the network: the same cached catalogue
// read as /api/v1 (lib/public-api/data.ts), the NWS forecast helper the
// resort page uses, and a 15-minute-cached read of `snowpack_daily`
// (public-read, migration 005). Importing this module imports the anon
// Supabase client, which throws without env — so only the route imports it;
// tests inject a fixture McpDataSource instead.
// ─────────────────────────────────────────────────────────────

import { unstable_cache } from "next/cache";
import { loadPublicApiCatalog } from "@/lib/public-api/data";
import { PUBLIC_API_REVALIDATE_SECONDS } from "@/lib/public-api/headers";
import { supabase } from "@/lib/supabase";
import { getWeatherForecast } from "@/lib/weather";
import type { McpDataSource, SnowHistoryRow } from "./types";

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

export const productionDataSource: McpDataSource = {
  catalog: loadPublicApiCatalog,
  // getWeatherForecast() fetches with `next: { revalidate: 3600 }`, so the
  // Data Cache holds each grid point's forecast for an hour.
  forecast: (resort) => getWeatherForecast(resort.lat, resort.lng),
  snowHistory: (resortId, days) => getSnowHistoryCached(resortId, days),
};
