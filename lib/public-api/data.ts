// ─────────────────────────────────────────────────────────────
// Public API v1 — the one place the routes touch Supabase.
//
// Everything comes through the cached catalogue read (`getAllResorts`, one
// hour, shared with the pages) plus two small lookups the catalogue does not
// carry: opening rows (migration 020) and resort_metadata elevations. Routes
// are ISR'd at 15 minutes on top, so a cold read happens at most four times
// an hour per route across the whole deployment.
// ─────────────────────────────────────────────────────────────

import { unstable_cache } from "next/cache";
import { getAllResorts, getResortElevationIndex, getResortOpenings, getResortStationsIndex } from "@/lib/supabase";
import type { ResortStationJoined, ResortWithData } from "@/lib/types";
import type { ResortOpening } from "@/lib/openings";
import type { ResortElevation, SerializeOptions } from "./serialize";
import { getSeasonAggregates, getSnowpackDailySince, getStationCumulativeNormals, getStationMonthlyNormals } from "@/lib/supabase";
import { deriveNewSnow, normalizeRows, type CumulativeNormalRow, type DailyRow, type MonthlyNormalRow } from "@/lib/snow-history";
import type { SeasonAggregateRow } from "@/lib/leaderboards";
import { PAST_SEASONS, POWDER_DAY_IN } from "@/lib/season-stats";

export interface PublicApiCatalog {
  resorts: ResortWithData[];
  openings: Map<string, ResortOpening>;
  elevations: Record<string, { base_ft: number | null; summit_ft: number | null }>;
  /** Station layer (migration 026) by resort id; `null` when the tables are not there yet. */
  stations: Record<string, ResortStationJoined[]> | null;
  now: Date;
}

// getResortOpenings() is a plain query (the /opening-dates page sits behind
// its own hourly ISR). The API routes are dynamic (see the route files), so
// the rows are cached here for the API's own 15-minute window.
const getOpeningsCached = unstable_cache(getResortOpenings, ["peakcam:public-api:openings:v1"], {
  revalidate: 900,
  tags: ["peakcam-resort-catalog"],
});

export async function loadPublicApiCatalog(): Promise<PublicApiCatalog> {
  const [resorts, openingRows, elevations, stations] = await Promise.all([
    getAllResorts(),
    getOpeningsCached(),
    getResortElevationIndex(),
    getResortStationsIndex(),
  ]);
  return {
    resorts,
    openings: new Map(openingRows.map((row) => [row.resort_id, row])),
    elevations,
    stations,
    now: new Date(),
  };
}

export function optionsFor(catalog: PublicApiCatalog, resort: ResortWithData): SerializeOptions {
  const elevationRow = catalog.elevations[resort.id];
  const elevation: ResortElevation | null = elevationRow
    ? { baseFt: elevationRow.base_ft, summitFt: elevationRow.summit_ft }
    : null;
  return {
    now: catalog.now,
    opening: catalog.openings.get(resort.id) ?? null,
    elevation,
    // An index that exists but has no row for this resort means "no station within 25 km": an empty list, not an absent block.
    observationStations: catalog.stations ? (catalog.stations[resort.id] ?? []) : null,
  };
}

/** Slugs are lowercase kebab-case; anything else is a 404 without a lookup. */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,99}$/.test(slug);
}

export function findResort(catalog: PublicApiCatalog, slug: string): ResortWithData | null {
  if (!isValidSlug(slug)) return null;
  return catalog.resorts.find((r) => r.slug === slug) ?? null;
}

// ── P5: season history ───────────────────────────────────────


/** Everything the history documents are computed from, for one resort. */
export interface ResortHistoryData {
  rows: DailyRow[];
  normals: CumulativeNormalRow[];
  monthly: MonthlyNormalRow[];
}

/** Ten past seasons plus the current one: eleven Octobers back, from `now`. */
export function historySince(now: Date): string {
  const year = now.getUTCFullYear() - (now.getUTCMonth() >= 9 ? 0 : 1) - PAST_SEASONS;
  return `${year}-10-01`;
}

async function fetchResortHistory(resortId: string, stationId: string | null, since: string): Promise<ResortHistoryData> {
  const [rows, normals, monthly] = await Promise.all([
    getSnowpackDailySince(resortId, since),
    stationId ? getStationCumulativeNormals(stationId) : Promise.resolve([]),
    stationId ? getStationMonthlyNormals(stationId) : Promise.resolve([]),
  ]);
  // Rows written before migration 030 (and model-sync rows, which never carry
  // new_snow_in) get their daily new snow derived from the depth deltas on
  // read, the same rule the backfill stores; stored values are kept as is.
  return { rows: deriveNewSnow(normalizeRows(rows)), normals, monthly };
}

// Keyed by (resortId, stationId, since); the daily rows grow by one a day, so
// 15 minutes loses nothing. Same tag as the catalogue for a manual purge.
const getResortHistoryCached = unstable_cache(fetchResortHistory, ["peakcam:public-api:history:v1"], {
  revalidate: 900,
  tags: ["peakcam-resort-catalog"],
});

/** The daily rows and normals behind /history, /season-stats and /monthly for one resort. */
export function loadResortHistory(resort: Pick<ResortWithData, "id" | "snotel_station_id">, now: Date = new Date()): Promise<ResortHistoryData> {
  return getResortHistoryCached(resort.id, resort.snotel_station_id ?? null, historySince(now));
}

const getSeasonAggregatesCached = unstable_cache(
  (seasonStart: string, weekStart: string) => getSeasonAggregates(POWDER_DAY_IN, seasonStart, weekStart),
  ["peakcam:public-api:season-aggregates:v1"],
  { revalidate: 900, tags: ["peakcam-resort-catalog"] },
);

/** Per-resort season aggregates for the leaderboards; null when the SQL function is not applied yet. */
export function loadSeasonAggregates(seasonStart: string, weekStart: string): Promise<SeasonAggregateRow[] | null> {
  return getSeasonAggregatesCached(seasonStart, weekStart);
}
