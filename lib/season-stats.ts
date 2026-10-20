// ─────────────────────────────────────────────────────────────
// Season stats — season-to-date, past seasons and the season curve.
//
// Pure functions over lib/snow-history.ts rows and normals. The powder-day
// threshold lives here, once (POWDER_DAY_IN): the SQL function
// season_stats(powder_in) in migration 030 is called with it, so the SQL
// and the TypeScript cannot disagree. 8 in matches the powder-alert
// threshold (plan §4 left 6 vs 8 as an editorial call; 8 was chosen so an
// alert and a powder day mean the same thing). Change it here only.
// ─────────────────────────────────────────────────────────────

import {
  SEASON_CURVE_DAYS,
  SNOW_DAY_MIN_IN,
  addDays,
  baselineNote,
  cumulativeByDay,
  dayOfSeason,
  dateForDayOfSeason,
  daysBetween,
  deepestBase,
  ensoForWaterYear,
  groupBySeason,
  normalizeRows,
  previousSeason,
  recentVsThirtyPct,
  seasonOf,
  storms,
  weeklyCumulative,
  type CumulativeNormalRow,
  type DailyRow,
  type EnsoSeason,
  type Hemisphere,
  type SeasonRef,
  type SeasonRows,
} from "./snow-history";

/** A powder day is a day with at least this much measured new snow. The one place the number lives. */
export const POWDER_DAY_IN = 8;

/** Past seasons shown on the history page and in the API. */
export const PAST_SEASONS = 10;

// ── Season to date ───────────────────────────────────────────

export type TrendDirection = "rising" | "falling" | "steady";

export interface PercentOfNormalToDate {
  /** Season-to-date snowfall as a percent of the 30-winter mean to this day; null without a normal. */
  thirtyYear: number | null;
  recentDecade: number | null;
  normalToDateIn: number | null;
  recentNormalToDateIn: number | null;
  normalYears: number | null;
  recentYears: number | null;
  /** Set when the two baselines differ by more than 10 %. */
  baselineNote: string | null;
}

export interface LastYearComparison {
  season: SeasonRef;
  /** Cumulative snowfall by the same day of season last year. */
  seasonToDateIn: number;
  /** Depth on the same day last year (nearest reading within 3 days), when measured. */
  baseOnSameDayIn: number | null;
  powderDays: number;
  /** This year minus last year, inches. */
  diffIn: number;
  /** This year as a percent of last year; null when last year had none. */
  pctOfLastYear: number | null;
}

export interface SeasonTrend {
  last7In: number;
  prior7In: number;
  direction: TrendDirection;
}

export interface SeasonToDate {
  season: SeasonRef;
  /** The day the stats are evaluated for (1-based day of season). */
  dayOfSeason: number;
  /** YYYY-MM-DD of the newest measured row in the season; null when none yet. */
  lastMeasuredDate: string | null;
  seasonToDateIn: number;
  daysMeasured: number;
  snowDays: number;
  powderDays: number;
  powderDayThresholdIn: number;
  currentBaseIn: number | null;
  deepestBase: { depthIn: number; date: string } | null;
  percentOfNormal: PercentOfNormalToDate;
  lastYear: LastYearComparison | null;
  trend: SeasonTrend;
}

function seasonRowsFor(rows: readonly DailyRow[], season: SeasonRef, hemisphere: Hemisphere): SeasonRows {
  const found = groupBySeason(rows, hemisphere).find((s) => s.key === season.key);
  return found ?? { ...season, rows: [] };
}

/** Cumulative new snow through `day` (1-based), 0 before the first row. */
function cumulativeThrough(season: SeasonRows, day: number): number {
  if (day < 1) return 0;
  const curve = cumulativeByDay(season, Math.max(day, 1));
  return curve[Math.min(day, curve.length) - 1] ?? 0;
}

function sumNewSnow(rows: readonly DailyRow[], from: string, to: string): number {
  let total = 0;
  for (const r of rows) if (r.date >= from && r.date <= to && r.newSnowIn != null) total += r.newSnowIn;
  return Math.round(total * 10) / 10;
}

function nearestDepth(rows: readonly DailyRow[], date: string, tolerance = 3): number | null {
  let best: { distance: number; depth: number } | null = null;
  for (const r of rows) {
    if (r.snowDepthIn == null) continue;
    const distance = Math.abs(daysBetween(date, r.date));
    if (distance <= tolerance && (!best || distance < best.distance)) best = { distance, depth: r.snowDepthIn };
  }
  return best?.depth ?? null;
}

/** Last 7 days against the 7 before: rising above 25 % more (and at least 2 in), falling below 25 % less, else steady. */
export function trendFor(rows: readonly DailyRow[], through: string): SeasonTrend {
  const last7In = sumNewSnow(rows, addDays(through, -6), through);
  const prior7In = sumNewSnow(rows, addDays(through, -13), addDays(through, -7));
  let direction: TrendDirection = "steady";
  if (last7In >= 2 && last7In > prior7In * 1.25) direction = "rising";
  else if (prior7In >= 2 && last7In < prior7In * 0.75) direction = "falling";
  return { last7In, prior7In, direction };
}

export function powderDays(rows: readonly DailyRow[], threshold: number = POWDER_DAY_IN): number {
  return rows.filter((r) => r.newSnowIn != null && r.newSnowIn >= threshold).length;
}

export function snowDays(rows: readonly DailyRow[]): number {
  return rows.filter((r) => r.newSnowIn != null && r.newSnowIn >= SNOW_DAY_MIN_IN).length;
}

function normalAt(normals: readonly CumulativeNormalRow[], day: number): CumulativeNormalRow | null {
  if (day < 1) return null;
  const clamped = Math.min(day, SEASON_CURVE_DAYS);
  return normals.find((n) => n.dayOfWaterYear === clamped) ?? null;
}

/**
 * Season-to-date stats for the season `today` falls in. Dated by the data:
 * `lastMeasuredDate` is the newest row on file in the season, and the
 * numbers run through `today` (rows after it are ignored).
 */
export function seasonToDate(
  rows: readonly DailyRow[],
  normals: readonly CumulativeNormalRow[],
  today: string,
  hemisphere: Hemisphere = "north",
): SeasonToDate {
  const season = seasonOf(today, hemisphere);
  const all = normalizeRows(rows).filter((r) => r.date <= today);
  const current = seasonRowsFor(all, season, hemisphere);
  const day = dayOfSeason(today, season);
  const measured = current.rows.filter((r) => r.snowDepthIn != null);
  const lastMeasured = measured.length ? measured[measured.length - 1] : null;
  const seasonToDateIn = cumulativeThrough(current, day);

  const normal = normalAt(normals, day);
  const thirtyYear = normal?.meanIn ?? null;
  const recent = normal?.recentMeanIn ?? null;
  const percentOfNormal: PercentOfNormalToDate = {
    thirtyYear: thirtyYear != null && thirtyYear > 0 ? Math.round((seasonToDateIn / thirtyYear) * 100) : null,
    recentDecade: recent != null && recent > 0 ? Math.round((seasonToDateIn / recent) * 100) : null,
    normalToDateIn: thirtyYear,
    recentNormalToDateIn: recent,
    normalYears: normal?.years ?? null,
    recentYears: normal?.recentYears ?? null,
    baselineNote: baselineNote(thirtyYear, recent, "by this date"),
  };

  const lastSeason = previousSeason(season, 1, hemisphere);
  const last = seasonRowsFor(all, lastSeason, hemisphere);
  const sameDayLastYear = dateForDayOfSeason(day, lastSeason);
  let lastYear: LastYearComparison | null = null;
  if (last.rows.length) {
    const lastToDate = cumulativeThrough(last, day);
    lastYear = {
      season: lastSeason,
      seasonToDateIn: lastToDate,
      baseOnSameDayIn: nearestDepth(last.rows, sameDayLastYear),
      powderDays: powderDays(last.rows.filter((r) => r.date <= sameDayLastYear)),
      diffIn: Math.round((seasonToDateIn - lastToDate) * 10) / 10,
      pctOfLastYear: lastToDate > 0 ? Math.round((seasonToDateIn / lastToDate) * 100) : null,
    };
  }

  return {
    season,
    dayOfSeason: day,
    lastMeasuredDate: lastMeasured?.date ?? null,
    seasonToDateIn,
    daysMeasured: measured.length,
    snowDays: snowDays(current.rows),
    powderDays: powderDays(current.rows),
    powderDayThresholdIn: POWDER_DAY_IN,
    currentBaseIn: lastMeasured?.snowDepthIn ?? null,
    deepestBase: deepestBase(current.rows),
    percentOfNormal,
    lastYear,
    trend: trendFor(current.rows, today),
  };
}

// ── Past seasons ─────────────────────────────────────────────

export interface PastSeason {
  season: SeasonRef;
  totalIn: number;
  snowDays: number;
  powderDays: number;
  daysMeasured: number;
  maxStorm: { totalIn: number; start: string; end: string; days: number } | null;
  deepestBase: { depthIn: number; date: string } | null;
  /** Cumulative new snow through each 7-day week of the season, 52 entries. */
  weeklyCumulativeIn: number[];
  /** Percent of the 30-winter mean at the end of the curve (day 273); null without a normal. */
  percentOfNormal: number | null;
  enso: EnsoSeason | null;
}

/**
 * The `count` seasons before `current`, newest first, each summarised from
 * its rows. A season with no rows is omitted rather than shown as zero.
 */
export function pastSeasons(
  rows: readonly DailyRow[],
  normals: readonly CumulativeNormalRow[],
  current: SeasonRef,
  hemisphere: Hemisphere = "north",
  count: number = PAST_SEASONS,
): PastSeason[] {
  const bySeason = new Map(groupBySeason(rows, hemisphere).map((s) => [s.key, s]));
  const endNormal = normalAt(normals, SEASON_CURVE_DAYS);
  const out: PastSeason[] = [];
  for (let offset = 1; offset <= count; offset++) {
    const ref = previousSeason(current, offset, hemisphere);
    const season = bySeason.get(ref.key);
    if (!season || !season.rows.length) continue;
    const curve = cumulativeByDay(season);
    const totalIn = curve[curve.length - 1];
    const top = storms(season.rows)[0] ?? null;
    out.push({
      season: ref,
      totalIn,
      snowDays: snowDays(season.rows),
      powderDays: powderDays(season.rows),
      daysMeasured: season.rows.filter((r) => r.snowDepthIn != null).length,
      maxStorm: top ? { totalIn: top.totalIn, start: top.start, end: top.end, days: top.days } : null,
      deepestBase: deepestBase(season.rows),
      weeklyCumulativeIn: weeklyCumulative(season),
      percentOfNormal: endNormal?.meanIn && endNormal.meanIn > 0 ? Math.round((totalIn / endNormal.meanIn) * 100) : null,
      enso: hemisphere === "north" ? ensoForWaterYear(ref.key) : null,
    });
  }
  return out;
}

// ── Season curve ─────────────────────────────────────────────

export interface CurvePoint {
  dayOfSeason: number;
  date: string;
  cumulativeIn: number;
  snowDepthIn: number | null;
}

export interface NormalBandPoint {
  dayOfSeason: number;
  meanIn: number;
  p25In: number;
  p75In: number;
  recentMeanIn: number | null;
}

export interface SeasonCurve {
  season: SeasonRef;
  /** One point per day from the season start through `today`, cumulative measured snow. */
  points: CurvePoint[];
  /** The normal band for every day 1..273, empty without a normal. */
  band: NormalBandPoint[];
  normalYears: number | null;
  recentYears: number | null;
}

/** The current season's daily cumulative curve against the station's normal band. */
export function seasonCurve(
  rows: readonly DailyRow[],
  normals: readonly CumulativeNormalRow[],
  today: string,
  hemisphere: Hemisphere = "north",
): SeasonCurve {
  const season = seasonOf(today, hemisphere);
  const all = normalizeRows(rows).filter((r) => r.date <= today);
  const current = seasonRowsFor(all, season, hemisphere);
  const day = Math.max(1, Math.min(dayOfSeason(today, season), 366));
  const curve = cumulativeByDay(current, day);
  const depthByDate = new Map(current.rows.map((r) => [r.date, r.snowDepthIn]));
  const points: CurvePoint[] = [];
  for (let d = 1; d <= day; d++) {
    const date = dateForDayOfSeason(d, season);
    points.push({ dayOfSeason: d, date, cumulativeIn: curve[d - 1], snowDepthIn: depthByDate.get(date) ?? null });
  }
  const band = normals
    .filter((n) => n.meanIn != null && n.dayOfWaterYear >= 1 && n.dayOfWaterYear <= SEASON_CURVE_DAYS)
    .sort((a, b) => a.dayOfWaterYear - b.dayOfWaterYear)
    .map((n) => ({
      dayOfSeason: n.dayOfWaterYear,
      meanIn: n.meanIn as number,
      p25In: n.p25In ?? (n.meanIn as number),
      p75In: n.p75In ?? (n.meanIn as number),
      recentMeanIn: n.recentMeanIn,
    }));
  const first = normals.find((n) => n.years != null);
  return { season, points, band, normalYears: first?.years ?? null, recentYears: first?.recentYears ?? null };
}

// ── Copy ─────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 18" for a YYYY-MM-DD day; with the year when it is not `inYear`. */
export function formatDayLabel(ymd: string, inYear?: number): string {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  const d = Number(ymd.slice(8, 10));
  const base = `${MONTHS[m - 1]} ${d}`;
  return inYear != null && inYear !== y ? `${base}, ${y}` : base;
}

export function inchesLabel(value: number | null | undefined): string {
  if (value == null) return "–";
  const r = Math.round(value * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1)} in.`;
}

export interface SeasonSentenceSegment {
  text: string;
  href?: string;
}

export interface SeasonSentence {
  text: string;
  segments: SeasonSentenceSegment[];
  /** YYYY-MM-DD the sentence is dated to (the newest measured day), or null. */
  asOfDay: string | null;
}

/**
 * The dated sentence at the top of the history page: "Through Oct 18, the
 * Breckenridge SNOTEL station (Hoosier Pass) has measured 12 in. of snow
 * since Oct 1, 85% of the 30-winter normal to date, with 1 powder day; a
 * year ago it had 20 in." Missing pieces drop out rather than being faked.
 */
export function seasonSentence(
  stats: SeasonToDate,
  resort: { name: string; slug: string },
  source: { kind: "snotel" | "model"; stationName?: string | null },
): SeasonSentence {
  const segments: SeasonSentenceSegment[] = [];
  const start = formatDayLabel(stats.season.startDate);
  if (!stats.lastMeasuredDate) {
    segments.push({ text: `No daily measurements yet this season for ` }, { text: resort.name, href: `/resorts/${resort.slug}` }, { text: `; the season curve starts with the first reading after ${start}.` });
    return { text: segments.map((s) => s.text).join(""), segments, asOfDay: null };
  }
  // No year: the season label and "a year ago" carry it, and "Jan 12, 2027" reads as stale.
  const through = formatDayLabel(stats.lastMeasuredDate);
  segments.push({ text: `Through ${through}, ` });
  if (source.kind === "snotel") {
    segments.push({ text: "the " });
    segments.push({ text: `${resort.name} SNOTEL station`, href: `/resorts/${resort.slug}` });
    segments.push({ text: `${source.stationName ? ` (${source.stationName})` : ""} has measured ` });
  } else {
    segments.push({ text: "a weather-model estimate for " });
    segments.push({ text: resort.name, href: `/resorts/${resort.slug}` });
    segments.push({ text: " puts " });
  }
  const clauses: string[] = [`${inchesLabel(stats.seasonToDateIn)} of snow since ${start}`];
  if (stats.percentOfNormal.thirtyYear != null) clauses.push(`${stats.percentOfNormal.thirtyYear}% of the 30-winter normal to date`);
  clauses.push(`${stats.powderDays} powder ${stats.powderDays === 1 ? "day" : "days"} (${POWDER_DAY_IN} in. or more)`);
  segments.push({ text: clauses.join(", ") });
  if (stats.lastYear) {
    segments.push({ text: `; a year ago it had ${inchesLabel(stats.lastYear.seasonToDateIn)}` });
  }
  // Exactly one period: half the clauses end in "in." already.
  const last = segments[segments.length - 1];
  if (!last.text.endsWith(".")) segments.push({ text: "." });
  return { text: segments.map((s) => s.text).join(""), segments, asOfDay: stats.lastMeasuredDate };
}

export { recentVsThirtyPct };
