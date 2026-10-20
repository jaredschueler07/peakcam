// ─────────────────────────────────────────────────────────────
// Public API v1 — the season history documents (P5).
//
// Pure builders from a resort, its daily rows and normals
// (lib/public-api/data.ts ResortHistoryData) and the clock to the three
// per-resort shapes in schema.ts (ResortHistory, SeasonStats,
// MonthlyClimatology) and the Leaderboard shape. The routes, the MCP tools,
// the history page and its markdown alternate all call these, so one
// number is computed one way. No Supabase, no Next.js.
// ─────────────────────────────────────────────────────────────

import type { ResortWithData } from "@/lib/types";
import { SITE_URL } from "@/lib/site";
import { stationMeta } from "@/lib/stations";
import { QUOTABLE_TIME_ZONE } from "@/lib/quotable";
import {
  MONTH_LABELS,
  baselineNote,
  hemisphereOf,
  recentVsThirtyPct,
  seasonMonths,
  type MonthlyNormalRow,
  type NormalWindow,
} from "@/lib/snow-history";
import { POWDER_DAY_IN, pastSeasons, seasonCurve, seasonSentence, seasonToDate } from "@/lib/season-stats";
import { buildLeaderboard, leaderboardApiPath, leaderboardPath, type Leaderboard, type LeaderboardFilters, type LeaderboardKind, type SeasonAggregateRow } from "@/lib/leaderboards";
import type { ResortHistoryData } from "./data";
import { PUBLIC_API_ATTRIBUTION, PUBLIC_API_LICENSE_URL } from "./headers";
import type {
  LeaderboardPublic,
  MonthClimatologyPublic,
  MonthlyClimatologyPublic,
  ResortHistoryPublic,
  SeasonStatsPublic,
  Station,
} from "./schema";
import { resortApiUrl, resortCanonicalUrl } from "./serialize";

export interface HistoryOptions {
  /** The render instant; the season day is its Mountain-time calendar day. */
  now: Date;
  baseUrl?: string;
}

const DAY_FORMAT = new Intl.DateTimeFormat("en-CA", { timeZone: QUOTABLE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** The YYYY-MM-DD calendar day in Mountain time, where the stations' days are counted. */
export function mountainDay(now: Date): string {
  return DAY_FORMAT.format(now);
}

export function historyPageUrl(slug: string, baseUrl: string = SITE_URL): string {
  return `${resortCanonicalUrl(slug, baseUrl)}/history`;
}

function stationOf(resort: ResortWithData, data: ResortHistoryData): { source: "snotel" | "open_meteo" | null; station: Station | null } {
  const newest = data.rows.length ? data.rows[data.rows.length - 1] : null;
  const measured = resort.snotel_station_id != null && (newest == null || resort.snow_report?.source !== "open_meteo");
  if (!newest && !resort.snotel_station_id) return { source: null, station: null };
  if (!measured) return { source: "open_meteo", station: null };
  const meta = stationMeta(resort.snotel_station_id);
  return { source: "snotel", station: { id: resort.snotel_station_id as string, name: meta?.name ?? null, elevationFt: meta?.elevationFt ?? null } };
}

function common(resort: ResortWithData, opts: HistoryOptions) {
  const baseUrl = opts.baseUrl ?? SITE_URL;
  return {
    slug: resort.slug,
    name: resort.name,
    canonicalUrl: resortCanonicalUrl(resort.slug, baseUrl),
    pageUrl: historyPageUrl(resort.slug, baseUrl),
    attribution: PUBLIC_API_ATTRIBUTION,
    license: PUBLIC_API_LICENSE_URL,
    generatedAt: opts.now.toISOString(),
  };
}

// ── /history ─────────────────────────────────────────────────

export function buildResortHistory(resort: ResortWithData, data: ResortHistoryData, opts: HistoryOptions): ResortHistoryPublic {
  const baseUrl = opts.baseUrl ?? SITE_URL;
  const hemisphere = hemisphereOf(resort.lat);
  const today = mountainDay(opts.now);
  const curve = seasonCurve(data.rows, data.normals, today, hemisphere);
  const stats = seasonToDate(data.rows, data.normals, today, hemisphere);
  const past = pastSeasons(data.rows, data.normals, curve.season, hemisphere);
  const { source, station } = stationOf(resort, data);
  return {
    ...common(resort, opts),
    apiUrl: `${resortApiUrl(resort.slug, baseUrl)}/history`,
    source,
    station,
    hemisphere,
    season: curve.season,
    asOf: stats.lastMeasuredDate,
    powderDayThresholdIn: POWDER_DAY_IN,
    curve: { points: curve.points, band: curve.band, normalYears: curve.normalYears, recentYears: curve.recentYears },
    pastSeasons: past,
  };
}

// ── /season-stats ────────────────────────────────────────────

export function buildSeasonStats(resort: ResortWithData, data: ResortHistoryData, opts: HistoryOptions): SeasonStatsPublic {
  const baseUrl = opts.baseUrl ?? SITE_URL;
  const hemisphere = hemisphereOf(resort.lat);
  const stats = seasonToDate(data.rows, data.normals, mountainDay(opts.now), hemisphere);
  const { source, station } = stationOf(resort, data);
  const sentence = seasonSentence(stats, resort, { kind: source === "snotel" ? "snotel" : "model", stationName: station?.name ?? null });
  return {
    ...common(resort, opts),
    apiUrl: `${resortApiUrl(resort.slug, baseUrl)}/season-stats`,
    source,
    station,
    hemisphere,
    season: stats.season,
    dayOfSeason: stats.dayOfSeason,
    asOf: stats.lastMeasuredDate,
    seasonToDateIn: stats.seasonToDateIn,
    daysMeasured: stats.daysMeasured,
    snowDays: stats.snowDays,
    powderDays: stats.powderDays,
    powderDayThresholdIn: stats.powderDayThresholdIn,
    currentBaseIn: stats.currentBaseIn,
    deepestBase: stats.deepestBase,
    percentOfNormal: stats.percentOfNormal,
    lastYear: stats.lastYear,
    trend: stats.trend,
    sentence: sentence.text,
  };
}

// ── /monthly ─────────────────────────────────────────────────

const EMPTY_WINDOW = { avgSnowfallIn: null, avgSnowDays: null, avgDepthIn: null, maxStormIn: null, maxStormStart: null, maxStormEnd: null, yearsTracked: 0 };

function windowOf(rows: readonly MonthlyNormalRow[], month: number, window: NormalWindow) {
  const r = rows.find((x) => x.month === month && x.window === window);
  if (!r) return { ...EMPTY_WINDOW };
  return {
    avgSnowfallIn: r.avgSnowfallIn,
    avgSnowDays: r.avgSnowDays,
    avgDepthIn: r.avgDepthIn,
    maxStormIn: r.maxStormIn,
    maxStormStart: r.maxStormStart,
    maxStormEnd: r.maxStormEnd,
    yearsTracked: r.yearsTracked,
  };
}

export function buildMonthlyClimatology(resort: ResortWithData, data: ResortHistoryData, opts: HistoryOptions): MonthlyClimatologyPublic {
  const baseUrl = opts.baseUrl ?? SITE_URL;
  const hemisphere = hemisphereOf(resort.lat);
  const { source, station } = stationOf(resort, data);
  const available = source === "snotel" && data.monthly.some((m) => m.yearsTracked > 0);
  const months: MonthClimatologyPublic[] = available
    ? seasonMonths(hemisphere).map((month) => {
        const thirtyYear = windowOf(data.monthly, month, "30yr");
        const recentDecade = windowOf(data.monthly, month, "10yr");
        return {
          month,
          label: MONTH_LABELS[month - 1],
          thirtyYear,
          recentDecade,
          recentVsThirtyPct: recentVsThirtyPct(thirtyYear.avgSnowfallIn, recentDecade.avgSnowfallIn),
          baselineNote: baselineNote(thirtyYear.avgSnowfallIn, recentDecade.avgSnowfallIn, `in ${MONTH_LABELS[month - 1]}`),
        };
      })
    : [];
  const note = available
    ? `Averages per calendar month at ${station?.name ? `the ${station.name} SNOTEL station` : "the resort's SNOTEL station"} over the 30 most recent complete winters and, separately, the 10 most recent. Snowfall is the sum of daily depth increases, a measured floor; a snow day has at least 1 in; the storm is the biggest run of consecutive snow days starting in that month.`
    : source === "open_meteo"
      ? "Monthly climatology needs a station record; this resort's daily values are weather-model estimates, so none is published."
      : "No station normal has been seeded for this resort yet.";
  return {
    ...common(resort, opts),
    apiUrl: `${resortApiUrl(resort.slug, baseUrl)}/monthly`,
    station,
    available,
    note,
    months,
  };
}

// ── /leaderboards/{kind} ─────────────────────────────────────

export function serializeLeaderboard(board: Leaderboard, filters: LeaderboardFilters, baseUrl: string = SITE_URL, now: Date = new Date()): LeaderboardPublic {
  return {
    kind: board.kind,
    title: board.copy.title,
    description: board.copy.description,
    rule: board.copy.rule,
    season: board.season,
    weekStart: board.weekStart,
    filters: { state: filters.state ?? null, source: filters.source ?? null },
    count: board.ranked.length,
    totalMatching: board.totalMatching,
    pool: board.pool,
    asOf: board.asOf,
    sentence: board.sentence.text,
    unavailable: board.unavailable,
    results: board.ranked.map((e) => {
      const meta = e.stationId ? stationMeta(e.stationId) : null;
      return {
        rank: e.rank,
        slug: e.slug,
        name: e.name,
        canonicalUrl: resortCanonicalUrl(e.slug, baseUrl),
        state: e.state,
        country: e.country,
        value: e.value,
        unit: e.unit,
        source: e.source,
        station: e.stationId ? { id: e.stationId, name: meta?.name ?? null, elevationFt: meta?.elevationFt ?? null } : null,
        measuredAt: e.measuredAt,
        detail: e.detail,
      };
    }),
    pageUrl: `${baseUrl}${leaderboardPath(board.kind)}`,
    attribution: PUBLIC_API_ATTRIBUTION,
    license: PUBLIC_API_LICENSE_URL,
    generatedAt: now.toISOString(),
  };
}

/** Build and serialise one board in a single call (routes, tools, pages). */
export function buildLeaderboardDocument(
  kind: LeaderboardKind,
  resorts: readonly ResortWithData[],
  aggregates: readonly SeasonAggregateRow[] | null,
  now: Date,
  filters: LeaderboardFilters = {},
  baseUrl: string = SITE_URL,
): { board: Leaderboard; doc: LeaderboardPublic } {
  const board = buildLeaderboard(kind, resorts, aggregates, now, filters);
  return { board, doc: serializeLeaderboard(board, filters, baseUrl, now) };
}

export { leaderboardApiPath, leaderboardPath };
