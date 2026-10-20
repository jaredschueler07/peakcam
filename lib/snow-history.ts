// ─────────────────────────────────────────────────────────────
// Snow history — pure functions over daily station rows.
//
// Everything the season curve, the normal band, the monthly climatology,
// the past-seasons table and the season-stats document need is derived
// here from `snowpack_daily`-shaped rows and the two normals tables
// (migration 030). No Supabase, no Next.js, no clock reads: callers pass
// rows and dates in, so the whole module is unit-tested on fixtures
// (lib/snow-history.test.ts) and the backfill, the normals seed, the API,
// the MCP tools and the page all compute the same numbers.
//
// Conventions:
// - A day is a `YYYY-MM-DD` string and all date math is done in UTC on
//   that string, so a row means the same calendar day on every machine.
// - A Northern-hemisphere season is the water year: Oct 1 (day 1) to Sep 30,
//   labelled "2026-27". A Southern-hemisphere season starts Apr 1 and is
//   labelled by its calendar year ("2026"). Normals exist only for SNOTEL
//   stations, all Northern.
// - Daily new snow is the positive day-over-day change in QC'd depth, the
//   same rule scripts/snotel-sync.ts uses for new_snow_24h. Settling and
//   melt make it a floor on what fell, never a ceiling; copy says "measured".
// ─────────────────────────────────────────────────────────────

import { validateReading, type RawSnotelReading } from "./snow-quality";
import type { QCFlag } from "./types";
import oni from "./enso-oni.json";

// ── Types ────────────────────────────────────────────────────

/** One `snowpack_daily` row, the columns history reads (camelCase). */
export interface DailyRow {
  /** YYYY-MM-DD. */
  date: string;
  snowDepthIn: number | null;
  sweIn: number | null;
  /** Daily new snow (migration 030); null for rows written before the backfill. */
  newSnowIn: number | null;
  qcFlag: QCFlag | string;
}

/** One `snotel_normals` row, the cumulative-snow columns (migration 030). */
export interface CumulativeNormalRow {
  dayOfWaterYear: number;
  meanIn: number | null;
  p25In: number | null;
  p75In: number | null;
  years: number | null;
  recentMeanIn: number | null;
  recentYears: number | null;
}

export type NormalWindow = "30yr" | "10yr";

/** One `snotel_monthly_normals` row. */
export interface MonthlyNormalRow {
  month: number;
  window: NormalWindow;
  avgSnowfallIn: number | null;
  avgSnowDays: number | null;
  avgDepthIn: number | null;
  maxStormIn: number | null;
  maxStormStart: string | null;
  maxStormEnd: string | null;
  yearsTracked: number;
}

export type Hemisphere = "north" | "south";

export interface SeasonRef {
  /** Water year for the North (Oct 2026 → 2027); calendar year for the South. */
  key: number;
  /** "2026-27" (North) or "2026" (South). */
  label: string;
  /** YYYY-MM-DD the season starts (Oct 1 or Apr 1). */
  startDate: string;
}

export interface SeasonRows extends SeasonRef {
  rows: DailyRow[];
}

/** A run of consecutive days with at least SNOW_DAY_MIN_IN of new snow. */
export interface Storm {
  start: string;
  end: string;
  days: number;
  totalIn: number;
}

/** A day counts as a snow day at this much new snow (the NRCS trace threshold is lower; 1 in is what skiers notice). */
export const SNOW_DAY_MIN_IN = 1;

/** The normal band and the curves run from day 1 (Oct 1) to day 273 (Jun 30). */
export const SEASON_CURVE_DAYS = 273;

/** How many winters each normal window prefers; the seed uses what the record has. */
export const NORMAL_WINDOW_YEARS: Record<NormalWindow, number> = { "30yr": 30, "10yr": 10 };

/** A winter contributes to a normal only with this many depth readings between Oct 1 and Jun 30. */
export const MIN_DAYS_PER_WINTER = 200;

/** A month contributes to a monthly normal only with this many depth readings in it. */
export const MIN_DAYS_PER_MONTH = 20;

// ── Dates (UTC on YYYY-MM-DD strings) ────────────────────────

export function parseDay(ymd: string): number {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function formatDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(ymd: string, days: number): string {
  return formatDay(parseDay(ymd) + days * 86_400_000);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDay(b) - parseDay(a)) / 86_400_000);
}

export function hemisphereOf(lat: number): Hemisphere {
  return lat < 0 ? "south" : "north";
}

/** The season a day belongs to. */
export function seasonOf(ymd: string, hemisphere: Hemisphere = "north"): SeasonRef {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  if (hemisphere === "south") {
    const key = month >= 4 ? year : year - 1;
    return { key, label: String(key), startDate: `${key}-04-01` };
  }
  const key = month >= 10 ? year + 1 : year;
  return { key, label: `${key - 1}-${String(key).slice(2)}`, startDate: `${key - 1}-10-01` };
}

/** The season `offset` seasons before `season` (1 = last season). */
export function previousSeason(season: SeasonRef, offset = 1, hemisphere: Hemisphere = "north"): SeasonRef {
  return seasonOf(addDays(season.startDate, -365 * offset + 10), hemisphere);
}

/** 1-based day of season (day of water year for the North). */
export function dayOfSeason(ymd: string, season: SeasonRef): number {
  return daysBetween(season.startDate, ymd) + 1;
}

/** The calendar day for a 1-based day of season. */
export function dateForDayOfSeason(day: number, season: SeasonRef): string {
  return addDays(season.startDate, day - 1);
}

/** Short month name for a 1..12 month number. */
export const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Months in season order for a hemisphere (Oct→Sep or Apr→Mar). */
export function seasonMonths(hemisphere: Hemisphere = "north"): number[] {
  const first = hemisphere === "south" ? 4 : 10;
  return Array.from({ length: 12 }, (_, i) => ((first - 1 + i) % 12) + 1);
}

// ── Stats helpers ────────────────────────────────────────────

export function mean(values: readonly number[]): number | null {
  if (!values.length) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Linear-interpolated percentile, 0–100. */
export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (1 - (idx - lo)) + sorted[hi] * (idx - lo);
}

export function round1(value: number | null): number | null {
  return value == null ? null : Math.round(value * 10) / 10;
}

// ── Series derivation ────────────────────────────────────────

/** Sort rows by date and drop duplicate days (the last one wins). */
export function normalizeRows(rows: readonly DailyRow[]): DailyRow[] {
  const byDate = new Map<string, DailyRow>();
  for (const r of rows) byDate.set(r.date.slice(0, 10), { ...r, date: r.date.slice(0, 10) });
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Daily new snow for each row: max(0, depth − previous day's depth) when the
 * previous calendar day is on file with a depth, otherwise null. Rows that
 * already carry `newSnowIn` keep it. Input must be sorted (normalizeRows).
 */
export function deriveNewSnow(rows: readonly DailyRow[]): DailyRow[] {
  const out: DailyRow[] = [];
  let prev: DailyRow | null = null;
  for (const r of rows) {
    let newSnowIn = r.newSnowIn;
    if (newSnowIn == null) {
      if (prev && r.snowDepthIn != null && prev.snowDepthIn != null && daysBetween(prev.date, r.date) === 1) {
        newSnowIn = Math.max(0, Math.round((r.snowDepthIn - prev.snowDepthIn) * 10) / 10);
      }
    }
    out.push({ ...r, newSnowIn });
    prev = r;
  }
  return out;
}

/** A raw AWDB day as the backfill parses it. */
export interface RawDay extends RawSnotelReading {
  date: string;
}

/** A QC'd day ready for `snowpack_daily`. */
export interface QcDay extends DailyRow {
  precipAccumIn: number | null;
  tempObsF: number | null;
  tempMaxF: number | null;
  tempMinF: number | null;
  qcFlag: QCFlag;
  notes: string | null;
}

/**
 * Run lib/snow-quality.ts validateReading over a whole daily series the
 * way snotel-sync runs it over one day: each day is checked against the
 * previous QC'd day (range, spike, SWE > depth, carry-forward on a silent
 * day), then daily new snow is derived from the QC'd depths. A gap of more
 * than one day resets the previous-day context so a station that was off
 * all summer is not spike-checked against June.
 */
export function qcSeries(raw: readonly RawDay[]): QcDay[] {
  const days = [...raw].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const out: QcDay[] = [];
  let prev: QcDay | null = null;
  for (const d of days) {
    const contiguous = prev != null && daysBetween(prev.date, d.date) === 1;
    const previous = contiguous && prev ? { snowDepthIn: prev.snowDepthIn, sweIn: prev.sweIn, precipAccumIn: prev.precipAccumIn } : null;
    const v = validateReading(d, previous);
    const newSnowIn =
      contiguous && prev && v.snowDepthIn != null && prev.snowDepthIn != null && v.qcFlag !== "missing"
        ? Math.max(0, Math.round((v.snowDepthIn - prev.snowDepthIn) * 10) / 10)
        : null;
    const row: QcDay = {
      date: d.date,
      snowDepthIn: v.snowDepthIn,
      sweIn: v.sweIn,
      precipAccumIn: v.precipAccumIn,
      tempObsF: v.tempObsF,
      tempMaxF: v.tempMaxF,
      tempMinF: v.tempMinF,
      qcFlag: v.qcFlag,
      notes: v.notes,
      newSnowIn,
    };
    out.push(row);
    prev = row;
  }
  return out;
}

// ── Grouping ─────────────────────────────────────────────────

/** Rows grouped by season, oldest season first; rows inside each are sorted. */
export function groupBySeason(rows: readonly DailyRow[], hemisphere: Hemisphere = "north"): SeasonRows[] {
  const groups = new Map<number, SeasonRows>();
  for (const r of normalizeRows(rows)) {
    const season = seasonOf(r.date, hemisphere);
    const g = groups.get(season.key) ?? { ...season, rows: [] };
    g.rows.push(r);
    groups.set(season.key, g);
  }
  return [...groups.values()].sort((a, b) => a.key - b.key);
}

/** Depth readings in the season's first SEASON_CURVE_DAYS days. */
export function measuredDays(season: SeasonRows, throughDay: number = SEASON_CURVE_DAYS): number {
  return season.rows.filter((r) => r.snowDepthIn != null && dayOfSeason(r.date, season) <= throughDay).length;
}

/**
 * Cumulative new snow by day of season, 1..`days`. A day without a value
 * adds nothing (the curve is a floor, never a guess). Index 0 is day 1.
 */
export function cumulativeByDay(season: SeasonRows, days: number = SEASON_CURVE_DAYS): number[] {
  const perDay = new Array<number>(days).fill(0);
  for (const r of season.rows) {
    const d = dayOfSeason(r.date, season);
    if (d >= 1 && d <= days && r.newSnowIn != null) perDay[d - 1] += r.newSnowIn;
  }
  let running = 0;
  return perDay.map((v) => {
    running = Math.round((running + v) * 10) / 10;
    return running;
  });
}

/** Cumulative new snow at the end of each 7-day week: index 0 = through day 7. 52 entries. */
export function weeklyCumulative(season: SeasonRows, weeks = 52): number[] {
  const daily = cumulativeByDay(season, weeks * 7);
  return Array.from({ length: weeks }, (_, w) => daily[w * 7 + 6]);
}

/** Consecutive snow days (≥ SNOW_DAY_MIN_IN) merged into storms, largest first. */
export function storms(rows: readonly DailyRow[]): Storm[] {
  const sorted = normalizeRows(rows);
  const out: Storm[] = [];
  let current: Storm | null = null;
  for (const r of sorted) {
    const snowy = r.newSnowIn != null && r.newSnowIn >= SNOW_DAY_MIN_IN;
    if (snowy && current && daysBetween(current.end, r.date) === 1) {
      current.end = r.date;
      current.days += 1;
      current.totalIn = Math.round((current.totalIn + (r.newSnowIn ?? 0)) * 10) / 10;
    } else if (snowy) {
      current = { start: r.date, end: r.date, days: 1, totalIn: r.newSnowIn ?? 0 };
      out.push(current);
    } else {
      current = null;
    }
  }
  return out.sort((a, b) => b.totalIn - a.totalIn || (a.start < b.start ? -1 : 1));
}

/** Deepest depth in a set of rows and the first day it was reached. */
export function deepestBase(rows: readonly DailyRow[]): { depthIn: number; date: string } | null {
  let best: { depthIn: number; date: string } | null = null;
  for (const r of normalizeRows(rows)) {
    if (r.snowDepthIn == null) continue;
    if (!best || r.snowDepthIn > best.depthIn) best = { depthIn: r.snowDepthIn, date: r.date };
  }
  return best;
}

// ── Normals ──────────────────────────────────────────────────

export interface CumulativeNormalPoint {
  dayOfWaterYear: number;
  meanIn: number;
  p25In: number;
  p75In: number;
}

export interface CumulativeNormal {
  window: NormalWindow;
  /** Winters that qualified (MIN_DAYS_PER_WINTER depth readings). */
  years: number;
  /** Water years used, oldest first. */
  waterYears: number[];
  /** One point per day 1..SEASON_CURVE_DAYS; empty when no winter qualified. */
  points: CumulativeNormalPoint[];
}

/**
 * The winters that may feed a normal: complete (ending before `before`,
 * exclusive by water year), with enough depth readings, the most recent
 * `count` of them. `before` is the water year to exclude from (the current
 * one while it is in progress).
 */
export function qualifyingWinters(seasons: readonly SeasonRows[], count: number, before: number): SeasonRows[] {
  return seasons
    .filter((s) => s.key < before && measuredDays(s) >= MIN_DAYS_PER_WINTER)
    .sort((a, b) => a.key - b.key)
    .slice(-count);
}

/** Mean/p25/p75 cumulative new snow by day of water year over the qualifying winters. */
export function cumulativeNormal(seasons: readonly SeasonRows[], window: NormalWindow, before: number): CumulativeNormal {
  const winters = qualifyingWinters(seasons, NORMAL_WINDOW_YEARS[window], before);
  const curves = winters.map((w) => cumulativeByDay(w));
  const points: CumulativeNormalPoint[] = [];
  if (winters.length) {
    for (let d = 1; d <= SEASON_CURVE_DAYS; d++) {
      const values = curves.map((c) => c[d - 1]);
      points.push({
        dayOfWaterYear: d,
        meanIn: round1(mean(values)) ?? 0,
        p25In: round1(percentile(values, 25)) ?? 0,
        p75In: round1(percentile(values, 75)) ?? 0,
      });
    }
  }
  return { window, years: winters.length, waterYears: winters.map((w) => w.key), points };
}

export interface MonthClimatology {
  month: number;
  window: NormalWindow;
  avgSnowfallIn: number | null;
  avgSnowDays: number | null;
  avgDepthIn: number | null;
  maxStormIn: number | null;
  maxStormStart: string | null;
  maxStormEnd: string | null;
  yearsTracked: number;
}

/**
 * Monthly climatology over the qualifying winters: a month counts for a
 * winter when it has MIN_DAYS_PER_MONTH depth readings. Storms are assigned
 * to the month they start in.
 */
export function monthlyClimatology(seasons: readonly SeasonRows[], window: NormalWindow, before: number): MonthClimatology[] {
  const winters = qualifyingWinters(seasons, NORMAL_WINDOW_YEARS[window], before);
  const out: MonthClimatology[] = [];
  for (let month = 1; month <= 12; month++) {
    const totals: number[] = [];
    const snowDays: number[] = [];
    const depths: number[] = [];
    let maxStorm: Storm | null = null;
    for (const w of winters) {
      const inMonth = w.rows.filter((r) => Number(r.date.slice(5, 7)) === month);
      const measured = inMonth.filter((r) => r.snowDepthIn != null);
      if (measured.length < MIN_DAYS_PER_MONTH) continue;
      totals.push(inMonth.reduce((s, r) => s + (r.newSnowIn ?? 0), 0));
      snowDays.push(inMonth.filter((r) => (r.newSnowIn ?? 0) >= SNOW_DAY_MIN_IN).length);
      depths.push(mean(measured.map((r) => r.snowDepthIn as number)) ?? 0);
      const top = storms(w.rows).find((s) => Number(s.start.slice(5, 7)) === month) ?? null;
      if (top && (!maxStorm || top.totalIn > maxStorm.totalIn)) maxStorm = top;
    }
    out.push({
      month,
      window,
      avgSnowfallIn: round1(mean(totals)),
      avgSnowDays: round1(mean(snowDays)),
      avgDepthIn: round1(mean(depths)),
      maxStormIn: maxStorm?.totalIn ?? null,
      maxStormStart: maxStorm?.start ?? null,
      maxStormEnd: maxStorm?.end ?? null,
      yearsTracked: totals.length,
    });
  }
  return out;
}

/** Above 10 % either way the two baselines disagree enough to say so. */
export const BASELINE_DIFF_PCT = 10;

/** Recent decade as a percent of the 30-winter figure, or null when either is missing or zero. */
export function recentVsThirtyPct(thirtyYear: number | null, recent: number | null): number | null {
  if (thirtyYear == null || recent == null || thirtyYear <= 0) return null;
  return Math.round((recent / thirtyYear) * 100);
}

/**
 * The baseline note shown when the recent decade differs from the 30-winter
 * normal by more than BASELINE_DIFF_PCT: null otherwise. `what` names the
 * quantity ("by this date", "in January").
 */
export function baselineNote(thirtyYear: number | null, recent: number | null, what: string, unit = "in."): string | null {
  const pct = recentVsThirtyPct(thirtyYear, recent);
  if (pct == null || Math.abs(pct - 100) <= BASELINE_DIFF_PCT) return null;
  const direction = pct > 100 ? "above" : "below";
  return `The last ten winters averaged ${fmt(recent)} ${unit} ${what}, ${Math.abs(pct - 100)}% ${direction} the 30-winter normal of ${fmt(thirtyYear)} ${unit}; both are shown.`;
}

function fmt(v: number | null): string {
  if (v == null) return "–";
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

// ── ENSO (NOAA ONI, lib/enso-oni.json) ───────────────────────

export type EnsoPhase = "el-nino" | "la-nina" | "neutral";

export interface EnsoSeason {
  phase: EnsoPhase;
  /** DJF Oceanic Niño Index anomaly, °C. */
  oni: number;
  label: string;
}

const ONI_BY_WATER_YEAR = (oni as { byWaterYear: Record<string, number> }).byWaterYear;

/** The ENSO phase of a Northern-hemisphere winter by its water year, or null outside the table. */
export function ensoForWaterYear(waterYear: number): EnsoSeason | null {
  const value = ONI_BY_WATER_YEAR[String(waterYear)];
  if (value == null) return null;
  const phase: EnsoPhase = value >= 0.5 ? "el-nino" : value <= -0.5 ? "la-nina" : "neutral";
  const label = phase === "el-nino" ? "El Niño" : phase === "la-nina" ? "La Niña" : "Neutral";
  return { phase, oni: value, label };
}
