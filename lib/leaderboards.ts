// ─────────────────────────────────────────────────────────────
// Season leaderboards (/snow-report/{kind}, /api/v1/leaderboards/{kind},
// MCP get_leaderboard).
//
// Four rankings over the catalogue plus the per-resort season aggregates
// the season_stats(powder_in, …) SQL function (migration 030) returns:
//
//   best-powder-this-week  measured new snow in the last 7 days
//   season-powder-days     days with ≥ POWDER_DAY_IN since the season start
//   deepest-base           latest station / model depth
//   season-snowfall        measured new snow since the season start
//
// Pure: the page, the route and the tool pass the catalogue, the aggregate
// rows and the clock in, and get rows, a dated sentence and copy back, so
// lib/leaderboards.test.ts covers the ranking rules without a database.
// Season-to-date boards cover the Northern-hemisphere season (Oct 1): the
// Andes resorts are listed on the two boards that are not season-bound and
// left off the other two on purpose, and the copy says so.
// ─────────────────────────────────────────────────────────────

import type { ResortWithData, SnowReportSource } from "./types";
import { formatMountainTime, inches, latestUpdatedAt, sourceLabel, type Quotable, type QuotableSegment } from "./quotable";
import { hemisphereOf, seasonOf, type SeasonRef } from "./snow-history";
import { POWDER_DAY_IN } from "./season-stats";

export const LEADERBOARD_KINDS = ["best-powder-this-week", "season-powder-days", "deepest-base", "season-snowfall"] as const;
export type LeaderboardKind = (typeof LEADERBOARD_KINDS)[number];

export function isLeaderboardKind(value: string): value is LeaderboardKind {
  return (LEADERBOARD_KINDS as readonly string[]).includes(value);
}

/** One row of `season_stats(powder_in, season_start, week_start)`, camelCased. */
export interface SeasonAggregateRow {
  resortId: string;
  stationId: string | null;
  seasonTotalIn: number;
  snowDays: number;
  powderDays: number;
  daysMeasured: number;
  deepestBaseIn: number | null;
  deepestBaseDate: string | null;
  weekTotalIn: number;
  /** YYYY-MM-DD of the newest daily row. */
  lastDate: string | null;
  latestDepthIn: number | null;
}

export interface LeaderboardEntry {
  rank: number;
  slug: string;
  name: string;
  state: string;
  country: string;
  /** The ranked number. */
  value: number;
  unit: "in" | "days";
  source: SnowReportSource;
  /** NRCS triplet for station-fed rows. */
  stationId: string | null;
  /** ISO instant (report time) or YYYY-MM-DD (daily rows) the value is dated to. */
  measuredAt: string | null;
  /** A second number the table shows: season total for powder days, base for the week, etc. */
  detail: { label: string; value: string } | null;
}

export interface LeaderboardCopy {
  title: string;
  /** Eyebrow above the H1. */
  eyebrow: string;
  description: string;
  /** Column header for the ranked number. */
  valueLabel: string;
  /** The rule, in words, shown under the table and in the API. */
  rule: string;
  /** Season-bound boards only list the Northern hemisphere. */
  seasonBound: boolean;
}

export const LEADERBOARD_COPY: Record<LeaderboardKind, LeaderboardCopy> = {
  "best-powder-this-week": {
    title: "Most snow in the last 7 days by resort",
    eyebrow: "Best powder this week",
    description: "Ski resorts ranked by measured new snow over the last seven days, from NRCS SNOTEL station readings (weather-model estimates where no station exists), dated to the reading.",
    valueLabel: "7-day snow",
    rule:
      "The 7-day total is the sum of each day's new snow, where a day's new snow is the positive change in snow depth at the resort's station (or model point) from the day before. Settling and melt make it a floor on what fell, not a ceiling. A resort is listed when it has at least one daily row in the window.",
    seasonBound: false,
  },
  "season-powder-days": {
    title: "Powder days this season by resort",
    eyebrow: "Season powder days",
    description: `Ski resorts ranked by the number of days with at least ${POWDER_DAY_IN} inches of measured new snow since October 1, from NRCS SNOTEL station readings and weather-model estimates.`,
    valueLabel: "Powder days",
    rule: `A powder day is a calendar day on which the station (or model point) recorded at least ${POWDER_DAY_IN} in. of new snow, the same threshold as PeakCam's powder alerts. Counted from October 1 for Northern-hemisphere resorts; the Andes, whose season runs June to October, are not on this board.`,
    seasonBound: true,
  },
  "deepest-base": {
    title: "Deepest base by resort",
    eyebrow: "Deepest base",
    description: "Ski resorts ranked by current snow depth at their station or model point, from NRCS SNOTEL readings and weather-model estimates, dated to the latest report.",
    valueLabel: "Base",
    rule: "Base depth is the snow depth at the resort's SNOTEL station in its latest report, or the weather-model estimate for resorts without a station. A station sits at one elevation, usually mid-mountain, so it can differ from the resort's own upper-mountain figure. Zero is a measurement; resorts with no report are left out.",
    seasonBound: false,
  },
  "season-snowfall": {
    title: "Season snowfall to date by resort",
    eyebrow: "Season snowfall",
    description: "Ski resorts ranked by measured snowfall since October 1, summed from daily NRCS SNOTEL depth changes (weather-model estimates where no station exists).",
    valueLabel: "Since Oct 1",
    rule: "Season snowfall is the sum of daily new snow since October 1, where each day's new snow is the positive change in station (or model) depth from the day before. It is a measured floor, not a resort marketing total. Northern-hemisphere resorts only; the Andes season runs June to October.",
    seasonBound: true,
  },
};

export interface LeaderboardFilters {
  state?: string | null;
  /** `snotel` keeps station-measured rows only. */
  source?: SnowReportSource | null;
  limit?: number;
}

export interface Leaderboard {
  kind: LeaderboardKind;
  copy: LeaderboardCopy;
  season: SeasonRef;
  /** YYYY-MM-DD the 7-day window starts (best-powder-this-week). */
  weekStart: string;
  ranked: LeaderboardEntry[];
  /** Before `limit`. */
  totalMatching: number;
  /** Resorts considered (after the state/source filter, before the "has data" rule). */
  pool: number;
  sentence: Quotable;
  /** ISO instant the data is good as of (the sentence's); null with no rows. */
  asOf: string | null;
  /** True when the season_stats function was not available and the board is empty for that reason. */
  unavailable: boolean;
}

/** The season start (Northern water year) and 7-day window start for a clock read, shared by the data layer and the boards. */
export function leaderboardWindow(now: Date): { seasonStart: string; weekStart: string; season: SeasonRef } {
  const today = now.toISOString().slice(0, 10);
  const season = seasonOf(today, "north");
  return { seasonStart: season.startDate, weekStart: new Date(now.getTime() - 6 * 86_400_000).toISOString().slice(0, 10), season };
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function reportSource(r: ResortWithData): SnowReportSource {
  return r.snow_report?.source ?? (r.snotel_station_id ? "snotel" : "open_meteo");
}

function sourceOfRow(r: ResortWithData, agg: SeasonAggregateRow | undefined): SnowReportSource {
  if (agg?.stationId) return agg.stationId === "open-meteo" ? "open_meteo" : "snotel";
  return reportSource(r);
}

/** A YYYY-MM-DD as a noon-UTC instant so Mountain-time copy shows the right calendar day. */
function dayInstant(ymd: string): string {
  return `${ymd}T18:00:00.000Z`;
}

function sortDesc(a: LeaderboardEntry, b: LeaderboardEntry): number {
  return b.value - a.value || a.name.localeCompare(b.name, "en");
}

/**
 * Build one leaderboard. `aggregates` is null when the season_stats function
 * was unavailable: the two boards that need it come back empty with
 * `unavailable: true`; deepest-base needs only the catalogue.
 */
export function buildLeaderboard(
  kind: LeaderboardKind,
  resorts: readonly ResortWithData[],
  aggregates: readonly SeasonAggregateRow[] | null,
  now: Date,
  filters: LeaderboardFilters = {},
): Leaderboard {
  const copy = LEADERBOARD_COPY[kind];
  const { season, weekStart } = leaderboardWindow(now);
  const byResort = new Map((aggregates ?? []).map((a) => [a.resortId, a]));
  const limit = filters.limit ?? 25;

  const pool = resorts.filter((r) => {
    if (filters.state && normalize(r.state) !== normalize(filters.state)) return false;
    if (copy.seasonBound && hemisphereOf(r.lat) === "south") return false;
    const source = sourceOfRow(r, byResort.get(r.id));
    if (filters.source && source !== filters.source) return false;
    return true;
  });

  const entries: LeaderboardEntry[] = [];
  for (const r of pool) {
    const agg = byResort.get(r.id);
    const base = { slug: r.slug, name: r.name, state: r.state, country: r.country, stationId: null as string | null };
    if (kind === "deepest-base") {
      const snow = r.snow_report;
      if (!snow || snow.base_depth == null) continue;
      const value = Number(snow.base_depth);
      if (!Number.isFinite(value)) continue;
      entries.push({
        rank: 0,
        ...base,
        value,
        unit: "in",
        source: snow.source,
        stationId: snow.source === "snotel" ? r.snotel_station_id : null,
        measuredAt: snow.updated_at ? new Date(snow.updated_at).toISOString() : null,
        detail: snow.new_snow_24h != null ? { label: "24 h", value: inches(Number(snow.new_snow_24h)) } : null,
      });
      continue;
    }
    if (!agg || !agg.lastDate) continue;
    const source = sourceOfRow(r, agg);
    const stationId = source === "snotel" ? (agg.stationId ?? r.snotel_station_id) : null;
    if (kind === "best-powder-this-week") {
      if (agg.lastDate < weekStart) continue;
      entries.push({ rank: 0, ...base, value: Number(agg.weekTotalIn), unit: "in", source, stationId, measuredAt: dayInstant(agg.lastDate), detail: agg.latestDepthIn != null ? { label: "base", value: inches(Number(agg.latestDepthIn)) } : null });
    } else if (kind === "season-powder-days") {
      entries.push({ rank: 0, ...base, value: agg.powderDays, unit: "days", source, stationId, measuredAt: dayInstant(agg.lastDate), detail: { label: "season", value: inches(Number(agg.seasonTotalIn)) } });
    } else {
      entries.push({ rank: 0, ...base, value: Number(agg.seasonTotalIn), unit: "in", source, stationId, measuredAt: dayInstant(agg.lastDate), detail: { label: "powder days", value: String(agg.powderDays) } });
    }
  }

  entries.sort(sortDesc);
  entries.forEach((e, i) => (e.rank = i + 1));
  const ranked = entries.slice(0, limit);
  const unavailable = aggregates === null && kind !== "deepest-base";
  const sentence = leaderboardSentence(kind, entries, season, pool.length, unavailable);
  return { kind, copy, season, weekStart, ranked, totalMatching: entries.length, pool: pool.length, sentence, asOf: sentence.asOf, unavailable };
}

function entryAsOf(entries: readonly LeaderboardEntry[]): string | null {
  return latestUpdatedAt(entries.map((e) => (e.measuredAt ? { updated_at: e.measuredAt } : null)));
}

function entryClause(e: LeaderboardEntry, unit: "in" | "days"): QuotableSegment[] {
  const value = unit === "days" ? `${e.value} ${e.value === 1 ? "day" : "days"}` : inches(e.value);
  return [{ text: `${value} at ` }, { text: e.name, href: `/resorts/${e.slug}` }, { text: ` (${sourceLabel(e.source)})` }];
}

/**
 * The dated sentence at the top of a board: "As of 6:00 a.m. MT Jan 12, the
 * most new snow in the last 7 days is 31 in. at Alta (SNOTEL), then 28 in.
 * at Snowbird (SNOTEL)." With nothing to rank it says why.
 */
export function leaderboardSentence(
  kind: LeaderboardKind,
  entries: readonly LeaderboardEntry[],
  season: SeasonRef,
  pool: number,
  unavailable = false,
): Quotable {
  const asOf = entryAsOf(entries);
  const stamp = asOf ? `As of ${formatMountainTime(asOf)}, ` : "";
  const finish = (segments: QuotableSegment[]): Quotable => {
    const text = segments.map((s) => s.text).join("");
    const href = segments.find((s) => s.href)?.href;
    return href ? { asOf, text, href, segments } : { asOf, text, segments };
  };
  if (unavailable) {
    return finish([{ text: "Season totals are not available right now; the live snow report still has today's numbers." }]);
  }
  const lead = entries.filter((e) => e.value > 0);
  const start = season.startDate.slice(5) === "10-01" ? "Oct 1" : season.startDate;
  if (!lead.length) {
    const why: Record<LeaderboardKind, string> = {
      "best-powder-this-week": `none of the ${pool} resorts recorded new snow in the last 7 days.`,
      "season-powder-days": `none of the ${pool} Northern-hemisphere resorts has had a ${POWDER_DAY_IN} in. day since ${start}.`,
      "deepest-base": `none of the ${pool} resorts reports snow on the ground.`,
      "season-snowfall": `none of the ${pool} Northern-hemisphere resorts has recorded snow since ${start}.`,
    };
    return finish([{ text: `${stamp}${why[kind]}` }]);
  }
  const intro: Record<LeaderboardKind, string> = {
    "best-powder-this-week": "the most new snow in the last 7 days is ",
    "season-powder-days": `the most powder days (${POWDER_DAY_IN} in. or more in a day) since ${start} is `,
    "deepest-base": "the deepest base is ",
    "season-snowfall": `the most snow since ${start} is `,
  };
  const unit = kind === "season-powder-days" ? "days" : "in";
  const segments: QuotableSegment[] = [{ text: `${stamp}${intro[kind]}` }, ...entryClause(lead[0], unit)];
  if (lead[1]) segments.push({ text: ", then " }, ...entryClause(lead[1], unit));
  segments.push({ text: "." });
  return finish(segments);
}

/** Boards in the order the snow-report pages link them. */
export const LEADERBOARD_ORDER: readonly LeaderboardKind[] = LEADERBOARD_KINDS;

export function leaderboardPath(kind: LeaderboardKind): string {
  return `/snow-report/${kind}`;
}

export function leaderboardApiPath(kind: LeaderboardKind): string {
  return `/api/v1/leaderboards/${kind}`;
}
