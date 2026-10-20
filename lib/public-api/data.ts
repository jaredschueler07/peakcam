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
import { getAllResorts, getForecastRuns, getForecastScores, getLatestOperatorStatusIndex, getResortElevationIndex, getResortOpenings, getResortStationsIndex, getResortTimelapses, getSnowDepthHistory } from "@/lib/supabase";
import type { CamTimelapses } from "@/lib/cam-timelapse";
import type { OperatorStatusRow, ResortStationJoined, ResortWithData } from "@/lib/types";
import type { ResortOpening } from "@/lib/openings";
import type { ForecastScoreRow, StoredForecast } from "@/lib/forecast/store";
import { SCORE_PERIOD_DAYS, measuredFromDepth, scoredPointFor } from "@/lib/forecast/score";
import { STATION_INDEX } from "@/lib/stations";
import type { ResortElevation, SerializeOptions } from "./serialize";
import { PUBLIC_API_REVALIDATE_SECONDS } from "./headers";
import { truthBasisFor, type AccuracyInput } from "./forecast";

// ── Stored forecasts (migration 027) ─────────────────────────
// Keyed by resort id automatically; one cold read per resort per 15-minute
// window, same tag as the catalogue so a manual purge clears both. The sync
// job writes every 6 h, so the window loses nothing.

const getForecastRunsCached = unstable_cache((resortId: string) => getForecastRuns(resortId), ["peakcam:public-api:forecast-runs:v1"], {
  revalidate: PUBLIC_API_REVALIDATE_SECONDS,
  tags: ["peakcam-resort-catalog"],
});

const getForecastScoresCached = unstable_cache((resortId: string) => getForecastScores(resortId), ["peakcam:public-api:forecast-scores:v1"], {
  revalidate: PUBLIC_API_REVALIDATE_SECONDS,
  tags: ["peakcam-resort-catalog"],
});

const getSnowDepthHistoryCached = unstable_cache((resortId: string, days: number) => getSnowDepthHistory(resortId, days), ["peakcam:public-api:depth-history:v1"], {
  revalidate: PUBLIC_API_REVALIDATE_SECONDS,
  tags: ["peakcam-resort-catalog"],
});

// ── Timelapse clips (migrations 025 + 031) ───────────────────
// The renderer writes every 6 h, so a 15-minute window per resort loses
// nothing; same tag as the catalogue so a manual purge clears both.
const getResortTimelapsesCached = unstable_cache((resortId: string) => getResortTimelapses(resortId), ["peakcam:public-api:timelapses:v1"], {
  revalidate: PUBLIC_API_REVALIDATE_SECONDS,
  tags: ["peakcam-resort-catalog"],
});

/** Rendered clips per cam of a resort; null when the clip view is unavailable (migration 031 not applied). */
export function loadResortTimelapses(resortId: string): Promise<CamTimelapses[] | null> {
  return getResortTimelapsesCached(resortId);
}

/** The newest run per point and model for a resort; `{ runs: [] }` when none is current. Never throws past a missing table. */
export function loadResortForecast(resortId: string): Promise<StoredForecast> {
  return getForecastRunsCached(resortId);
}

export function loadResortForecastScores(resortId: string): Promise<ForecastScoreRow[]> {
  return getForecastScoresCached(resortId);
}

/**
 * Everything the accuracy document needs: the score rows, how many days of
 * the window had a measured value, and what the measurement was. Measured
 * days are counted from the same depth-delta rule the scorer uses, so the
 * number on the page is the number the scores were built on.
 */
export async function loadResortAccuracy(
  resort: Pick<ResortWithData, "id" | "snotel_station_id" | "elevation_summit_ft" | "elevation_base_ft">,
): Promise<AccuracyInput> {
  const [scores, depth] = await Promise.all([getForecastScoresCached(resort.id), resort.snotel_station_id ? getSnowDepthHistoryCached(resort.id, SCORE_PERIOD_DAYS) : Promise.resolve([])]);
  const measuredDays = measuredFromDepth(depth).size;
  const meta = resort.snotel_station_id ? STATION_INDEX[resort.snotel_station_id] : undefined;
  return {
    scores,
    measuredDays,
    truthBasis: truthBasisFor(resort, measuredDays),
    station: resort.snotel_station_id ? { id: resort.snotel_station_id, name: meta?.name ?? null, elevationFt: meta?.elevationFt ?? null } : null,
    scoredPoint: scores.length ? scoredPointFor(resort, meta?.elevationFt ?? null) : null,
  };
}
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
  /** Newest operator report (migration 032) by resort id; optional so fixture catalogues written before P6 still type-check. */
  operatorStatus?: Record<string, OperatorStatusRow> | null;
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
  const [resorts, openingRows, elevations, stations, operatorStatus] = await Promise.all([
    getAllResorts(),
    getOpeningsCached(),
    getResortElevationIndex(),
    getResortStationsIndex(),
    getLatestOperatorStatusIndex(),
  ]);
  return {
    resorts,
    openings: new Map(openingRows.map((row) => [row.resort_id, row])),
    elevations,
    stations,
    operatorStatus,
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
    operator: catalog.operatorStatus?.[resort.id] ?? null,
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
