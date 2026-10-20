// ─────────────────────────────────────────────────────────────
// The PeakCam blend: per-day median across whatever models reach that day,
// with the 25th/75th percentile as the spread. Pure; the sync job, the API
// serializer, the MCP tools and the resort page all call this on the same
// stored runs, so the number on the page is the number in the API.
//
// Why a median and not a skill weight: with 90 days of verification the
// skill ranking is per resort and noisy; the median already discounts the
// one outlier model, and the lo/hi band says how much the models disagree.
// Weighting by score is a later change behind the same function.
//
// Units stay the provider's (cm, °C, km/h, %); conversion happens at the edge.
// ─────────────────────────────────────────────────────────────

import type { ModelDay } from "./open-meteo-models";

/** What the blend needs from a run: a model id and its days. Fresh `ModelRun`s and stored runs both fit. */
export interface BlendInput {
  model: string;
  daily: readonly ModelDay[];
}

export interface BlendDay {
  date: string;
  /** Median snowfall across the models that reach this day, cm. */
  snowfallCm: number;
  /** 25th percentile, cm. Equals the median when one model reaches the day. */
  snowfallLoCm: number;
  /** 75th percentile, cm. */
  snowfallHiCm: number;
  tempMaxC: number | null;
  tempMinC: number | null;
  precipProb: number | null;
  windGustKmh: number | null;
  /** Most frequent WMO code; ties go to the higher (more severe) code. */
  weatherCode: number | null;
  /** Models contributing to this day. */
  modelCount: number;
  models: string[];
}

export interface BlendPeak {
  date: string;
  cm: number;
  /** Consecutive days around the peak with at least 1 cm, the peak day included. */
  windowDays: number;
}

export interface Blend {
  days: BlendDay[];
  /** Distinct models that contributed to any day. */
  models: string[];
  /** Models contributing to the first day (the headline "N models agree"). */
  modelCount: number;
  next48hCm: number;
  total7dCm: number;
  total14dCm: number;
  peak: BlendPeak | null;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

/** Linear-interpolated percentile (p in 0..100) of a non-empty list. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const pos = (Math.min(100, Math.max(0, p)) / 100) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function median(values: readonly number[]): number {
  return percentile(values, 50);
}

function medianOrNull(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return nums.length ? round1(median(nums)) : null;
}

function modeCode(values: Array<number | null | undefined>): number | null {
  const counts = new Map<number, number>();
  for (const v of values) if (typeof v === "number" && Number.isFinite(v)) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | null = null;
  let bestCount = 0;
  for (const [code, count] of counts) {
    if (count > bestCount || (count === bestCount && best != null && code > best)) {
      best = code;
      bestCount = count;
    }
  }
  return best;
}

const PEAK_WINDOW_MIN_CM = 1;

/** Sum of the first `n` days' median snowfall, cm. */
function sumDays(days: readonly BlendDay[], n: number): number {
  return round1(days.slice(0, n).reduce((s, d) => s + d.snowfallCm, 0));
}

function findPeak(days: readonly BlendDay[]): BlendPeak | null {
  let idx = -1;
  for (let i = 0; i < days.length; i++) if (idx < 0 || days[i].snowfallCm > days[idx].snowfallCm) idx = i;
  if (idx < 0 || days[idx].snowfallCm <= 0) return null;
  let start = idx;
  let end = idx;
  while (start > 0 && days[start - 1].snowfallCm >= PEAK_WINDOW_MIN_CM) start--;
  while (end < days.length - 1 && days[end + 1].snowfallCm >= PEAK_WINDOW_MIN_CM) end++;
  return { date: days[idx].date, cm: days[idx].snowfallCm, windowDays: end - start + 1 };
}

/**
 * Blend one point's latest run per model. Days are the union of the runs'
 * dates in order; a day a model does not reach simply has one fewer
 * contributor. Up to `maxDays` days are returned.
 */
export function blendRuns(runs: readonly BlendInput[], maxDays = 14): Blend {
  const byDate = new Map<string, Array<{ model: string; day: ModelDay }>>();
  for (const run of runs) {
    for (const day of run.daily) {
      if (day.snowfallCm == null) continue;
      if (!byDate.has(day.date)) byDate.set(day.date, []);
      byDate.get(day.date)!.push({ model: run.model, day });
    }
  }
  const dates = [...byDate.keys()].sort().slice(0, maxDays);
  const days: BlendDay[] = dates.map((date) => {
    const entries = byDate.get(date)!;
    const snow = entries.map((e) => e.day.snowfallCm as number);
    return {
      date,
      snowfallCm: round1(median(snow)),
      snowfallLoCm: round1(percentile(snow, 25)),
      snowfallHiCm: round1(percentile(snow, 75)),
      tempMaxC: medianOrNull(entries.map((e) => e.day.tempMaxC)),
      tempMinC: medianOrNull(entries.map((e) => e.day.tempMinC)),
      precipProb: medianOrNull(entries.map((e) => e.day.precipProb)),
      windGustKmh: medianOrNull(entries.map((e) => e.day.windGustKmh)),
      weatherCode: modeCode(entries.map((e) => e.day.weatherCode)),
      modelCount: entries.length,
      models: entries.map((e) => e.model).sort(),
    };
  });
  const models = [...new Set(runs.map((r) => r.model))].sort();
  return {
    days,
    models,
    modelCount: days[0]?.modelCount ?? 0,
    next48hCm: sumDays(days, 2),
    total7dCm: sumDays(days, 7),
    total14dCm: sumDays(days, 14),
    peak: findPeak(days),
  };
}

/** Snowfall per date for the first `n` days, cm — the shape lib/weather.ts applies to NWS periods. */
export function blendSnowByDate(blend: Blend, n = 14): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of blend.days.slice(0, n)) out[d.date] = d.snowfallCm;
  return out;
}
