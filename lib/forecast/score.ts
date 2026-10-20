// ─────────────────────────────────────────────────────────────
// Forecast verification — pure scoring of stored runs against a measured
// 24 h new-snow series.
//
// For every measured date D and lead L in {1, 3, 7}: the forecast for D in
// the newest run each model issued on day D − L. Per model: mean absolute
// error at each lead, a bias ratio (Σ forecast / Σ measured over every pair,
// > 1 = over-forecasts), the count of measured dates graded, and a rank by
// day-1 MAE. A `blend` row is scored the same way from the per-(date, lead)
// median across the models that had a forecast, so the blend is graded by
// the rule that produced it, not by a separate shortcut.
//
// Truth: SNOTEL depth deltas from `snowpack_daily` (clipped at zero — a
// pillow settles, so a positive delta is a floor on new snow, and the models
// are graded against that floor), or a station's own new-snow series when a
// resort has one (GHCN, via the P3 station layer). Units are cm throughout
// to match forecast_daily.snowfall_cm.
// ─────────────────────────────────────────────────────────────

import { median } from "./blend";
import { BLEND_MODEL_ID } from "./open-meteo-models";
import type { StoredRun } from "./store";

export const SCORE_LEADS = [1, 3, 7] as const;
export type ScoreLead = (typeof SCORE_LEADS)[number];
export const SCORE_PERIOD_DAYS = 90;

/**
 * Which stored point a station's series is graded against: the one whose
 * elevation is nearest the station's (a SNOTEL pillow usually sits between
 * base and summit), base when the station elevation is unknown. The scorer
 * and the accuracy document both call this, so they agree without a column.
 */
export function scoredPointFor(
  resort: { elevation_summit_ft?: number | null; elevation_base_ft?: number | null },
  stationElevationFt: number | null | undefined,
  available: readonly ("summit" | "base")[] = ["summit", "base"],
): "summit" | "base" {
  const summit = resort.elevation_summit_ft ?? null;
  const base = resort.elevation_base_ft ?? null;
  const want: "summit" | "base" =
    stationElevationFt != null && summit != null && base != null && Math.abs(summit - stationElevationFt) < Math.abs(base - stationElevationFt) ? "summit" : "base";
  if (available.includes(want)) return want;
  return available[0] ?? want;
}

export interface ScorePair {
  model: string;
  lead: ScoreLead;
  /** The measured date. */
  date: string;
  forecastCm: number;
  measuredCm: number;
}

export interface ModelScore {
  model: string;
  day1Mae: number | null;
  day3Mae: number | null;
  day7Mae: number | null;
  /** Distinct measured dates with at least one lead pair. */
  samples: number;
  biasRatio: number | null;
  /** 1 = lowest day-1 MAE (then day-3, then day-7); models with no day-1 pairs rank last. */
  rank: number;
}

/** A measured 24 h new-snow series, cm, keyed by YYYY-MM-DD. */
export type MeasuredSeries = Map<string, number>;

const IN_TO_CM = 2.54;
const round2 = (v: number): number => Math.round(v * 100) / 100;

export interface DepthRow {
  date: string;
  snow_depth_in: number | null;
  qc_flag?: string | null;
}

/**
 * 24 h new snow from consecutive-day depth readings: max(0, today − yesterday),
 * only when both days are `valid` or `corrected` (a `missing` day is a
 * carry-forward and would read as 0 cm of snow). Settlement makes this a
 * floor, which is stated on the accuracy surface.
 */
export function measuredFromDepth(rows: readonly DepthRow[]): MeasuredSeries {
  const good = rows
    .filter((r) => r.snow_depth_in != null && Number.isFinite(r.snow_depth_in) && (r.qc_flag == null || r.qc_flag === "valid" || r.qc_flag === "corrected"))
    .sort((a, b) => a.date.localeCompare(b.date));
  const out: MeasuredSeries = new Map();
  for (let i = 1; i < good.length; i++) {
    const prev = good[i - 1];
    const cur = good[i];
    if (daysBetween(prev.date, cur.date) !== 1) continue;
    out.set(cur.date, round2(Math.max(0, (cur.snow_depth_in as number) - (prev.snow_depth_in as number)) * IN_TO_CM));
  }
  return out;
}

export interface NewSnowRow {
  /** YYYY-MM-DD the observation is for (observed_at's UTC day). */
  date: string;
  new_snow_in: number | null;
}

/** A station that reports new snow directly (GHCN SNOW), inches to cm, one value per date (the largest if several). */
export function measuredFromNewSnow(rows: readonly NewSnowRow[]): MeasuredSeries {
  const out: MeasuredSeries = new Map();
  for (const r of rows) {
    if (r.new_snow_in == null || !Number.isFinite(r.new_snow_in)) continue;
    const cm = round2(Math.max(0, r.new_snow_in) * IN_TO_CM);
    out.set(r.date, Math.max(out.get(r.date) ?? 0, cm));
  }
  return out;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

function utcDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/**
 * Pair every measured date with the day-1/3/7 forecasts for it. For each
 * (model, issue day) the newest run of that day is used; dates with no run
 * for a lead are simply absent from that lead.
 */
export function pairForecasts(measured: MeasuredSeries, runs: readonly StoredRun[], leads: readonly ScoreLead[] = SCORE_LEADS): ScorePair[] {
  // Newest run per (model, issue UTC day).
  const newest = new Map<string, StoredRun>();
  for (const run of runs) {
    const key = `${run.model}|${utcDay(run.issuedAt)}`;
    const cur = newest.get(key);
    if (!cur || Date.parse(run.issuedAt) > Date.parse(cur.issuedAt)) newest.set(key, run);
  }
  const models = [...new Set(runs.map((r) => r.model))];
  const pairs: ScorePair[] = [];
  for (const [date, measuredCm] of measured) {
    for (const lead of leads) {
      const issueDay = addDays(date, -lead);
      for (const model of models) {
        const run = newest.get(`${model}|${issueDay}`);
        if (!run) continue;
        const day = run.daily.find((d) => d.date === date);
        if (!day || day.snowfallCm == null) continue;
        pairs.push({ model, lead, date, forecastCm: day.snowfallCm, measuredCm });
      }
    }
  }
  return pairs;
}

/** Add a `blend` pair per (date, lead) where at least two models had a forecast: their median. */
export function withBlendPairs(pairs: readonly ScorePair[], minModels = 2): ScorePair[] {
  const groups = new Map<string, ScorePair[]>();
  for (const p of pairs) {
    if (p.model === BLEND_MODEL_ID) continue;
    const key = `${p.date}|${p.lead}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  const blend: ScorePair[] = [];
  for (const group of groups.values()) {
    if (group.length < minModels) continue;
    blend.push({ model: BLEND_MODEL_ID, lead: group[0].lead, date: group[0].date, forecastCm: round2(median(group.map((p) => p.forecastCm))), measuredCm: group[0].measuredCm });
  }
  return [...pairs.filter((p) => p.model !== BLEND_MODEL_ID), ...blend];
}

function mae(pairs: readonly ScorePair[]): number | null {
  if (!pairs.length) return null;
  return round2(pairs.reduce((s, p) => s + Math.abs(p.forecastCm - p.measuredCm), 0) / pairs.length);
}

const cmp = (a: number | null, b: number | null): number => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : a - b);

/** Per-model scores, ranked. Pass the output of `withBlendPairs` to get the blend row too. */
export function scoreModels(pairs: readonly ScorePair[]): ModelScore[] {
  const byModel = new Map<string, ScorePair[]>();
  for (const p of pairs) {
    if (!byModel.has(p.model)) byModel.set(p.model, []);
    byModel.get(p.model)!.push(p);
  }
  const scores: Omit<ModelScore, "rank">[] = [];
  for (const [model, ps] of byModel) {
    const sumF = ps.reduce((s, p) => s + p.forecastCm, 0);
    const sumM = ps.reduce((s, p) => s + p.measuredCm, 0);
    scores.push({
      model,
      day1Mae: mae(ps.filter((p) => p.lead === 1)),
      day3Mae: mae(ps.filter((p) => p.lead === 3)),
      day7Mae: mae(ps.filter((p) => p.lead === 7)),
      samples: new Set(ps.map((p) => p.date)).size,
      biasRatio: sumM > 0 ? round2(sumF / sumM) : null,
    });
  }
  scores.sort((a, b) => cmp(a.day1Mae, b.day1Mae) || cmp(a.day3Mae, b.day3Mae) || cmp(a.day7Mae, b.day7Mae) || a.model.localeCompare(b.model));
  return scores.map((s, i) => ({ ...s, rank: i + 1 }));
}
