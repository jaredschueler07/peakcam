// ─────────────────────────────────────────────────────────────
// Public API v1 — forecast serializers.
//
// Pure functions from stored runs (lib/forecast/store.ts) and score rows to
// the wire shapes in schema.ts: the blended 14-day document, the per-resort
// summary block, and the accuracy document. The routes, the MCP tools and
// the resort page call these on the same rows, so every surface shows the
// same blend. Inches on the wire like the rest of the API, with the cm the
// models were stored in alongside.
// ─────────────────────────────────────────────────────────────

import type { ResortWithData } from "@/lib/types";
import { cmToInches, celsiusToFahrenheit, kmhToMph, weatherCodeToCondition } from "@/lib/open-meteo";
import { blendRuns, type Blend } from "@/lib/forecast/blend";
import {
  OPEN_METEO_ATTRIBUTION,
  OPEN_METEO_LICENSE,
  OPEN_METEO_URL,
  type ForecastPoint,
} from "@/lib/forecast/open-meteo-models";
import { newestIssuedAt, runsForPoint, type ForecastScoreRow, type StoredForecast, type StoredRun } from "@/lib/forecast/store";
import { SCORE_PERIOD_DAYS } from "@/lib/forecast/score";
import { PUBLIC_API_ATTRIBUTION, PUBLIC_API_LICENSE_URL } from "./headers";
import { resortCanonicalUrl, type SerializeOptions } from "./serialize";
import type {
  ForecastAccuracyPublic,
  ForecastBlendDayPublic,
  ForecastCreditPublic,
  ForecastPublic,
  ForecastRunPublic,
  ForecastScorePublic,
  ForecastSummaryPublic,
  ForecastTruthBasis,
  Station,
} from "./schema";

export const FORECAST_CREDITS: ForecastCreditPublic[] = [
  { name: "Open-Meteo", text: OPEN_METEO_ATTRIBUTION, license: OPEN_METEO_LICENSE, url: OPEN_METEO_URL },
];

export const FORECAST_METHOD =
  "Per day, the median snowfall across the models that reach that day (ECMWF IFS, GFS, GEM, ICON, JMA, Météo-France, UKMO, plus NBM and HRRR for US points), fetched every 6 hours from Open-Meteo at the resort's summit and base elevations; the low/high band is the 25th/75th percentile across models, so a wide band means the models disagree.";

export const ACCURACY_METHOD =
  "For every day in the window with a measured value, the forecast for that day from each model's newest run issued 1, 3 and 7 days earlier is compared with the measured 24 h new snow (SNOTEL depth change clipped at zero, so settlement makes the measured value a floor). MAE is in cm; bias ratio is total forecast over total measured; the blend is graded by the same rule.";

const round1 = (v: number): number => Math.round(v * 10) / 10;
const inches = (cm: number): number => round1(cmToInches(cm));
const toF = (c: number | null): number | null => (c == null ? null : Math.round(celsiusToFahrenheit(c)));
const toMph = (kmh: number | null): number | null => (kmh == null ? null : Math.round(kmhToMph(kmh)));

export function serializeBlendDays(blend: Blend): ForecastBlendDayPublic[] {
  return blend.days.map((d) => ({
    date: d.date,
    snowfallIn: inches(d.snowfallCm),
    snowfallLoIn: inches(d.snowfallLoCm),
    snowfallHiIn: inches(d.snowfallHiCm),
    snowfallCm: d.snowfallCm,
    snowfallLoCm: d.snowfallLoCm,
    snowfallHiCm: d.snowfallHiCm,
    tempMaxF: toF(d.tempMaxC),
    tempMinF: toF(d.tempMinC),
    precipProb: d.precipProb == null ? null : Math.round(d.precipProb),
    windGustMph: toMph(d.windGustKmh),
    weatherCode: d.weatherCode,
    condition: d.weatherCode == null ? "partly-cloudy" : weatherCodeToCondition(d.weatherCode),
    modelCount: d.modelCount,
    models: d.models,
  }));
}

export function serializeSummary(blend: Blend, point: ForecastPoint, issuedAt: string): ForecastSummaryPublic {
  return {
    point,
    issuedAt,
    modelCount: blend.modelCount,
    models: blend.models,
    next48hIn: inches(blend.next48hCm),
    next48hCm: blend.next48hCm,
    total7dIn: inches(blend.total7dCm),
    total7dCm: blend.total7dCm,
    total14dIn: inches(blend.total14dCm),
    total14dCm: blend.total14dCm,
    peak: blend.peak ? { date: blend.peak.date, in: inches(blend.peak.cm), cm: blend.peak.cm, windowDays: blend.peak.windowDays } : null,
  };
}

export function serializeRun(run: StoredRun): ForecastRunPublic {
  return {
    id: run.id,
    point: run.point,
    model: run.model,
    issuedAt: run.issuedAt,
    horizonDays: run.horizonDays,
    days: run.daily.map((d) => ({
      date: d.date,
      snowfallCm: d.snowfallCm,
      snowfallLo: null,
      snowfallHi: null,
      tempMax: d.tempMaxC,
      tempMin: d.tempMinC,
      precipProb: d.precipProb,
      windGust: d.windGustKmh,
      weatherCode: d.weatherCode,
    })),
  };
}

/** The blend for one point of a stored forecast, or null when no run is current. */
export function blendForPoint(stored: StoredForecast | null | undefined, point: ForecastPoint = "summit"): { point: ForecastPoint; blend: Blend; issuedAt: string; runs: StoredRun[] } | null {
  const picked = runsForPoint(stored, point);
  if (!picked.runs.length) return null;
  const blend = blendRuns(picked.runs);
  if (!blend.days.length) return null;
  return { point: picked.point, blend, issuedAt: newestIssuedAt(picked.runs) ?? new Date(0).toISOString(), runs: picked.runs };
}

/** The `forecast` block on `/resorts/{slug}` (summit when there is one). */
export function serializeForecastSummary(stored: StoredForecast | null | undefined, point: ForecastPoint = "summit"): ForecastSummaryPublic | null {
  const hit = blendForPoint(stored, point);
  return hit ? serializeSummary(hit.blend, hit.point, hit.issuedAt) : null;
}

export interface ForecastSerializeOptions extends SerializeOptions {
  point?: ForecastPoint;
}

export function serializeForecast(resort: Pick<ResortWithData, "slug" | "name">, stored: StoredForecast | null | undefined, options: ForecastSerializeOptions = {}): ForecastPublic {
  const now = options.now ?? new Date();
  const asked = options.point ?? "summit";
  const points = [...new Set((stored?.runs ?? []).map((r) => r.point))].sort() as ForecastPoint[];
  const base = {
    slug: resort.slug,
    name: resort.name,
    canonicalUrl: resortCanonicalUrl(resort.slug, options.baseUrl),
    method: FORECAST_METHOD,
    credits: FORECAST_CREDITS,
    attribution: PUBLIC_API_ATTRIBUTION,
    license: PUBLIC_API_LICENSE_URL,
    generatedAt: now.toISOString(),
  };
  const hit = blendForPoint(stored, asked);
  if (!hit) {
    return { ...base, available: false, note: "No current model run is stored for this resort; the forecast job writes one every 6 hours.", point: asked, points, summary: null, daily: [], byModel: [] };
  }
  return {
    ...base,
    available: true,
    note: hit.point === asked ? null : `No ${asked} point for this resort; showing ${hit.point}.`,
    point: hit.point,
    points,
    summary: serializeSummary(hit.blend, hit.point, hit.issuedAt),
    daily: serializeBlendDays(hit.blend),
    byModel: hit.runs.map(serializeRun),
  };
}

// ── Accuracy ─────────────────────────────────────────────────

export function serializeScoreRow(row: ForecastScoreRow, rank: number | null): ForecastScorePublic {
  const n = (v: number | string | null | undefined): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    model: row.model,
    periodDays: row.period_days,
    day1Mae: n(row.day1_mae),
    day3Mae: n(row.day3_mae),
    day7Mae: n(row.day7_mae),
    samples: row.samples == null ? null : Math.round(Number(row.samples)),
    biasRatio: n(row.bias_ratio),
    computedAt: new Date(row.computed_at).toISOString(),
    rank,
  };
}

const cmp = (a: number | null, b: number | null): number => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : a - b);

/** Score rows for one window, ranked by day-1 MAE (then day-3, day-7), the blend included. */
export function rankScores(rows: readonly ForecastScoreRow[], periodDays = SCORE_PERIOD_DAYS): ForecastScorePublic[] {
  const picked = rows.filter((r) => r.period_days === periodDays).map((r) => serializeScoreRow(r, null));
  picked.sort((a, b) => cmp(a.day1Mae, b.day1Mae) || cmp(a.day3Mae, b.day3Mae) || cmp(a.day7Mae, b.day7Mae) || a.model.localeCompare(b.model));
  return picked.map((s, i) => ({ ...s, rank: i + 1 }));
}

export interface AccuracyInput {
  scores: readonly ForecastScoreRow[];
  /** Days in the window with a usable measured value (0 when no series). */
  measuredDays: number;
  truthBasis: ForecastTruthBasis;
  station?: Station | null;
  scoredPoint?: ForecastPoint | null;
  periodDays?: number;
}

export function serializeForecastAccuracy(resort: Pick<ResortWithData, "slug" | "name">, input: AccuracyInput, options: SerializeOptions = {}): ForecastAccuracyPublic {
  const periodDays = input.periodDays ?? SCORE_PERIOD_DAYS;
  const models = rankScores(input.scores, periodDays);
  const computedAt = models.length ? models.map((m) => m.computedAt).sort().at(-1)! : null;
  return {
    slug: resort.slug,
    name: resort.name,
    canonicalUrl: resortCanonicalUrl(resort.slug, options.baseUrl),
    periodDays,
    truthBasis: input.truthBasis,
    station: input.station ?? null,
    measuredDays: input.measuredDays,
    scoredPoint: input.scoredPoint ?? null,
    models,
    bestModel: models[0]?.model ?? null,
    computedAt,
    method: ACCURACY_METHOD,
    credits: FORECAST_CREDITS,
    attribution: PUBLIC_API_ATTRIBUTION,
    license: PUBLIC_API_LICENSE_URL,
    generatedAt: (options.now ?? new Date()).toISOString(),
  };
}

/** The measured-series basis for a resort: SNOTEL when it has an NRCS station, else none (GHCN arrives with the P3 station layer). */
export function truthBasisFor(resort: Pick<ResortWithData, "snotel_station_id">, measuredDays: number): ForecastTruthBasis {
  if (resort.snotel_station_id && measuredDays > 0) return "snotel";
  return "none";
}
