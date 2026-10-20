// ─────────────────────────────────────────────────────────────
// Multi-model forecast fetch and parse (Open-Meteo `models=`).
//
// One Open-Meteo call per point asks for every model at once; the response
// suffixes each daily series with the model id (`snowfall_sum_gfs_seamless`).
// `parseModelRuns()` turns that into one `ModelRun` per model with the
// model's real horizon (the count of leading days it actually answered for —
// Open-Meteo pads the rest with nulls, so a 14-day request to a 4-day model
// comes back with 4 values and 10 nulls). The parser is pure and tested
// against a recorded response (fixtures/); only `fetchModelRuns()` touches
// the network, and only the P4 sync job and lib/weather.ts call it.
//
// Units are the provider's: snowfall cm, temperature °C, gusts km/h,
// precipitation probability %, WMO weather code. The public API converts.
//
// Attribution: Open-Meteo data is CC BY 4.0. Anything that serves these
// numbers must carry OPEN_METEO_ATTRIBUTION.
// ─────────────────────────────────────────────────────────────

import { feetToMeters } from "@/lib/open-meteo";

export const OPEN_METEO_ATTRIBUTION = "Weather data by Open-Meteo.com";
export const OPEN_METEO_LICENSE = "CC BY 4.0";
export const OPEN_METEO_LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";
export const OPEN_METEO_URL = "https://open-meteo.com";

/** Models requested everywhere (global or North-American coverage). */
export const GLOBAL_MODELS = [
  "ecmwf_ifs025",
  "gfs_seamless",
  "gem_seamless",
  "icon_seamless",
  "jma_seamless",
  "meteofrance_seamless",
  "ukmo_seamless",
] as const;

/** Added for US points only: both are CONUS / North-America regional models. */
export const US_MODELS = ["ncep_nbm_conus", "gfs_hrrr"] as const;

export const ALL_MODELS = [...GLOBAL_MODELS, ...US_MODELS] as const;
export type ForecastModelId = (typeof ALL_MODELS)[number];

/** The id the blend is stored and served under. */
export const BLEND_MODEL_ID = "blend";

export interface ModelInfo {
  label: string;
  provider: string;
  /** Days the provider publishes (open-meteo.com/en/docs "Forecast Length", 2026-10-18); the parser measures the real one. */
  nominalHorizonDays: number;
}

export const MODEL_INFO: Record<ForecastModelId, ModelInfo> = {
  ecmwf_ifs025: { label: "ECMWF IFS 0.25°", provider: "ECMWF", nominalHorizonDays: 15 },
  gfs_seamless: { label: "GFS", provider: "NOAA NCEP", nominalHorizonDays: 16 },
  gem_seamless: { label: "GEM", provider: "Environment Canada", nominalHorizonDays: 10 },
  icon_seamless: { label: "ICON", provider: "DWD", nominalHorizonDays: 7 },
  jma_seamless: { label: "JMA", provider: "Japan Meteorological Agency", nominalHorizonDays: 11 },
  meteofrance_seamless: { label: "ARPEGE/AROME", provider: "Météo-France", nominalHorizonDays: 4 },
  ukmo_seamless: { label: "UKMO", provider: "UK Met Office", nominalHorizonDays: 7 },
  ncep_nbm_conus: { label: "NBM (CONUS)", provider: "NOAA NCEP", nominalHorizonDays: 11 },
  gfs_hrrr: { label: "HRRR", provider: "NOAA NCEP", nominalHorizonDays: 2 },
};

export function modelLabel(model: string): string {
  return model === BLEND_MODEL_ID ? "PeakCam blend" : (MODEL_INFO[model as ForecastModelId]?.label ?? model);
}

/** Which models to request for a point. */
export function modelsForCountry(country: string | null | undefined): ForecastModelId[] {
  return country === "US" ? [...GLOBAL_MODELS, ...US_MODELS] : [...GLOBAL_MODELS];
}

export const FORECAST_DAYS = 14;

/** Daily variables requested, in this order. `weather_code` is the current name of `weathercode`; both are parsed. */
export const DAILY_VARIABLES = [
  "snowfall_sum",
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_probability_max",
  "wind_gusts_10m_max",
  "weather_code",
] as const;

export type ForecastPoint = "summit" | "base";

export interface ModelDay {
  /** YYYY-MM-DD in the resort's local zone (Open-Meteo `timezone=auto`). */
  date: string;
  snowfallCm: number | null;
  tempMaxC: number | null;
  tempMinC: number | null;
  /** 0–100; null for models without an ensemble probability (JMA, Météo-France). */
  precipProb: number | null;
  windGustKmh: number | null;
  weatherCode: number | null;
}

export interface ModelRun {
  model: ForecastModelId;
  /** Days the model actually answered for, counted from the first day. */
  horizonDays: number;
  daily: ModelDay[];
}

/** Subset of the Open-Meteo JSON the parser reads. */
export interface OpenMeteoMultiModelResponse {
  latitude?: number;
  longitude?: number;
  elevation?: number;
  utc_offset_seconds?: number;
  timezone?: string;
  daily: { time: string[] } & Record<string, Array<number | null> | string[]>;
  daily_units?: Record<string, string>;
}

function series(daily: OpenMeteoMultiModelResponse["daily"], variable: string, model: string, single: boolean): Array<number | null> | null {
  const suffixed = daily[`${variable}_${model}`];
  if (Array.isArray(suffixed)) return suffixed as Array<number | null>;
  // Legacy spelling of the weather code.
  if (variable === "weather_code") {
    const legacy = daily[`weathercode_${model}`];
    if (Array.isArray(legacy)) return legacy as Array<number | null>;
  }
  // A single-model request comes back unsuffixed.
  if (single) {
    const plain = daily[variable] ?? (variable === "weather_code" ? daily.weathercode : undefined);
    if (Array.isArray(plain)) return plain as Array<number | null>;
  }
  return null;
}

const num = (arr: Array<number | null> | null, i: number): number | null => {
  const v = arr?.[i];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

/**
 * One ModelRun per requested model that answered for at least one day.
 * The horizon is the number of leading days with a snowfall value; days
 * past it are dropped so a run never carries null padding. Models the
 * response does not know (outside their coverage) are left out.
 */
export function parseModelRuns(data: OpenMeteoMultiModelResponse, models: readonly ForecastModelId[]): ModelRun[] {
  const daily = data?.daily;
  if (!daily || !Array.isArray(daily.time)) return [];
  const single = models.length === 1;
  const runs: ModelRun[] = [];
  for (const model of models) {
    const snow = series(daily, "snowfall_sum", model, single);
    if (!snow) continue;
    const tmax = series(daily, "temperature_2m_max", model, single);
    const tmin = series(daily, "temperature_2m_min", model, single);
    const pop = series(daily, "precipitation_probability_max", model, single);
    const gust = series(daily, "wind_gusts_10m_max", model, single);
    const code = series(daily, "weather_code", model, single);
    const days: ModelDay[] = [];
    for (let i = 0; i < daily.time.length; i++) {
      const snowfallCm = num(snow, i);
      if (snowfallCm == null) break; // past this model's horizon
      days.push({
        date: daily.time[i],
        snowfallCm,
        tempMaxC: num(tmax, i),
        tempMinC: num(tmin, i),
        precipProb: num(pop, i),
        windGustKmh: num(gust, i),
        weatherCode: num(code, i),
      });
    }
    if (days.length === 0) continue;
    runs.push({ model, horizonDays: days.length, daily: days });
  }
  return runs;
}

// ── Fetch ────────────────────────────────────────────────────

const OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_TIMEOUT_MS = 10_000;

export interface PointRequest {
  lat: number;
  lng: number;
  /** Elevation to downscale to; omitted = Open-Meteo's own 90 m DEM at the coordinates. */
  elevationFt?: number | null;
  models: readonly ForecastModelId[];
}

export function buildModelsUrl(req: PointRequest): string {
  const params = new URLSearchParams({
    latitude: req.lat.toFixed(4),
    longitude: req.lng.toFixed(4),
    daily: DAILY_VARIABLES.join(","),
    forecast_days: String(FORECAST_DAYS),
    timezone: "auto",
    models: req.models.join(","),
  });
  if (req.elevationFt != null && Number.isFinite(req.elevationFt)) {
    params.set("elevation", String(Math.round(feetToMeters(req.elevationFt))));
  }
  return `${OPEN_METEO_BASE}?${params}`;
}

/**
 * Fetch and parse one point. Returns null on any failure; callers treat that
 * as "no runs this time" and keep the last stored ones. `init` lets Next
 * callers pass `next: { revalidate }`.
 */
export async function fetchModelRuns(req: PointRequest, init: RequestInit & { next?: { revalidate?: number } } = {}): Promise<ModelRun[] | null> {
  try {
    const res = await fetch(buildModelsUrl(req), { signal: AbortSignal.timeout(OPEN_METEO_TIMEOUT_MS), ...init });
    if (!res.ok) return null;
    const data = (await res.json()) as OpenMeteoMultiModelResponse;
    return parseModelRuns(data, req.models);
  } catch {
    return null;
  }
}

// ── Points per resort ────────────────────────────────────────

export interface ResortPointSource {
  lat: number;
  lng: number;
  country?: string | null;
  elevation_summit_ft?: number | null;
  elevation_base_ft?: number | null;
}

export interface ResortPoint {
  point: ForecastPoint;
  elevationFt: number | null;
}

/**
 * Summit and base when both elevations are known; a single point otherwise
 * (labelled by the elevation that exists, else `base` at Open-Meteo's own
 * elevation for the coordinates). Two identical points would double the
 * call volume for nothing.
 */
export function resortPoints(resort: ResortPointSource): ResortPoint[] {
  const summit = Number.isFinite(resort.elevation_summit_ft ?? NaN) ? (resort.elevation_summit_ft as number) : null;
  const base = Number.isFinite(resort.elevation_base_ft ?? NaN) ? (resort.elevation_base_ft as number) : null;
  if (summit != null && base != null && summit !== base) {
    return [
      { point: "summit", elevationFt: summit },
      { point: "base", elevationFt: base },
    ];
  }
  if (summit != null) return [{ point: "summit", elevationFt: summit }];
  return [{ point: "base", elevationFt: base }];
}
