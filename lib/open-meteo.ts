import type { WeatherPeriod, HourlyWeather } from "./types";
import { windChill } from "./weather";
import { hasCurrentSnowForecast } from "./snow-forecast";

// ─────────────────────────────────────────────────────────────
// Open-Meteo API helpers — free, keyless, global weather model.
// Used for resorts with no SNOTEL station (South America + any
// other non-US/CA resort). All fetches MUST be server-side.
// ─────────────────────────────────────────────────────────────

const OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast";
// See lib/weather.ts's NWS_TIMEOUT_MS for why: caps a hung upstream call so
// it can't hang the page render; the existing try/catch below turns the
// abort into the same `null` result as any other Open-Meteo failure.
const OPEN_METEO_TIMEOUT_MS = 5_000;
const PAST_DAYS = 2;
const NOW_IDX = PAST_DAYS * 24; // hourly index representing "now" (local midnight of today)

// ── Unit conversions ──────────────────────────────────────────

export function cmToInches(cm: number): number {
  return cm / 2.54;
}

export function metersToInches(m: number): number {
  return m * 39.3701;
}

export function metersToFeet(m: number): number {
  return m * 3.28084;
}

export function feetToMeters(ft: number): number {
  return ft / 3.28084;
}

export function celsiusToFahrenheit(c: number): number {
  return (c * 9) / 5 + 32;
}

export function kmhToMph(kmh: number): number {
  return kmh * 0.621371;
}

// ── Weather code mapping (WMO codes → PeakCam condition slugs) ─
// Slugs match forecastToCondition() in lib/weather.ts so the same
// WeatherIcon set renders regardless of data source.

const WEATHER_CODE_CONDITION: Record<number, string> = {
  0: "clear", 1: "partly-cloudy", 2: "partly-cloudy", 3: "cloudy",
  45: "fog", 48: "fog",
  51: "rain", 53: "rain", 55: "rain",
  56: "freezing-rain", 57: "freezing-rain",
  61: "rain", 63: "rain", 65: "rain",
  66: "freezing-rain", 67: "freezing-rain",
  71: "light-snow", 73: "light-snow", 75: "heavy-snow", 77: "light-snow",
  80: "rain", 81: "rain", 82: "rain",
  85: "light-snow", 86: "heavy-snow",
  95: "rain", 96: "rain", 99: "rain",
};

export function weatherCodeToCondition(code: number): string {
  return WEATHER_CODE_CONDITION[code] ?? "partly-cloudy";
}

const WEATHER_CODE_LABEL: Record<number, string> = {
  0: "Clear", 1: "Mostly Clear", 2: "Partly Cloudy", 3: "Overcast",
  45: "Fog", 48: "Freezing Fog",
  51: "Light Drizzle", 53: "Drizzle", 55: "Heavy Drizzle",
  56: "Freezing Drizzle", 57: "Freezing Drizzle",
  61: "Light Rain", 63: "Rain", 65: "Heavy Rain",
  66: "Freezing Rain", 67: "Freezing Rain",
  71: "Light Snow", 73: "Snow", 75: "Heavy Snow", 77: "Snow Grains",
  80: "Rain Showers", 81: "Rain Showers", 82: "Violent Rain Showers",
  85: "Snow Showers", 86: "Heavy Snow Showers",
  95: "Thunderstorm", 96: "Thunderstorm", 99: "Thunderstorm",
};

export function weatherCodeToLabel(code: number): string {
  return WEATHER_CODE_LABEL[code] ?? "Variable";
}

const COMPASS_POINTS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];

export function degreesToCompass(deg: number): string {
  const idx = Math.round((deg % 360) / 22.5) % 16;
  return COMPASS_POINTS[idx];
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ── Raw API response shape (subset we use) ────────────────────

interface OpenMeteoHourlyBlock {
  time: string[];
  snowfall: number[];
  snow_depth: number[];
  temperature_2m: number[];
  wind_gusts_10m: number[];
  wind_speed_10m: number[];
  wind_direction_10m: number[];
  cloud_cover: number[];
  freezing_level_height: number[];
  weathercode: number[];
  precipitation_probability: number[];
}

interface OpenMeteoDailyBlock {
  time: string[];
  weathercode: number[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  snowfall_sum: number[];
  precipitation_probability_max: number[];
  wind_gusts_10m_max: number[];
  wind_direction_10m_dominant: number[];
}

export interface OpenMeteoResponse {
  utc_offset_seconds?: number;
  elevation: number;
  hourly: OpenMeteoHourlyBlock;
  daily: OpenMeteoDailyBlock;
}

// ── Fetch ──────────────────────────────────────────────────────

async function fetchOpenMeteo(
  lat: number,
  lng: number,
  elevationFt?: number | null,
): Promise<OpenMeteoResponse | null> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    hourly:
      "snowfall,snow_depth,temperature_2m,wind_gusts_10m,wind_speed_10m,wind_direction_10m,cloud_cover,freezing_level_height,weathercode,precipitation_probability",
    daily:
      "weathercode,temperature_2m_max,temperature_2m_min,snowfall_sum,precipitation_probability_max,wind_gusts_10m_max,wind_direction_10m_dominant",
    past_days: String(PAST_DAYS),
    forecast_days: "5",
    timezone: "auto",
  });
  if (elevationFt != null) {
    params.set("elevation", String(Math.round(feetToMeters(elevationFt))));
  }

  try {
    const res = await fetch(`${OPEN_METEO_BASE}?${params}`, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(OPEN_METEO_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── Windowed aggregation helpers ───────────────────────────────

function sumWindow(arr: number[], start: number, count: number): number {
  let total = 0;
  for (let i = Math.max(start, 0); i < start + count && i < arr.length; i++) {
    total += arr[i] ?? 0;
  }
  return total;
}

function maxWindow(arr: number[], start: number, count: number): number {
  let max = -Infinity;
  for (let i = Math.max(start, 0); i < start + count && i < arr.length; i++) {
    if (arr[i] != null) max = Math.max(max, arr[i]);
  }
  return max === -Infinity ? 0 : max;
}

function avgWindow(arr: number[], start: number, count: number): number {
  let total = 0;
  let n = 0;
  for (let i = Math.max(start, 0); i < start + count && i < arr.length; i++) {
    if (arr[i] != null) {
      total += arr[i];
      n++;
    }
  }
  return n > 0 ? total / n : 0;
}

/** Open-Meteo returns resort-local wall times; never parse them in the server timezone. */
function hourlyTime(data: OpenMeteoResponse, time: string): string {
  const utcMs = Date.parse(`${time}Z`) - (data.utc_offset_seconds ?? 0) * 1000;
  return new Date(utcMs).toISOString();
}

/** Only the interval containing now qualifies; never pick a stale or future nearest hour. */
function findCurrentHourIndex(data: OpenMeteoResponse, nowMs: number): number {
  return data.hourly.time.findIndex((time) => {
    const start = Date.parse(hourlyTime(data, time));
    return start <= nowMs && nowMs < start + 3600_000;
  });
}

// ── Snapshot (current conditions, for the conditions engine) ──

export interface OpenMeteoSnapshot {
  snowDepthIn: number | null;
  newSnow24hIn: number;
  newSnow48hIn: number;
  forecastSnow48hIn: number;
  maxHighTemp48hF: number;
  skyCoverAvg: number;
  windGustMaxMph: number;
  freezingLevelFt: number;
  tempF: number | null;
  snowingNow: boolean;
}

export function parseSnapshot(data: OpenMeteoResponse, nowMs = Date.now()): OpenMeteoSnapshot {
  const h = data.hourly;
  const nowIdx = Math.min(NOW_IDX, h.time.length - 1);

  const snowDepthM = h.snow_depth[nowIdx]; // snow_depth is in METERS (verified against the live API — see design doc)
  const newSnow24hCm = sumWindow(h.snowfall, nowIdx - 24, 24);
  const newSnow48hCm = sumWindow(h.snowfall, nowIdx - 48, 48);
  const forecastSnowCm = sumWindow(h.snowfall, nowIdx, 48);
  const maxHighC = maxWindow(h.temperature_2m, nowIdx, 48);
  const skyCover = avgWindow(h.cloud_cover, nowIdx, 24);
  const windGustKmh = maxWindow(h.wind_gusts_10m, nowIdx, 24);
  const freezingLevelM = h.freezing_level_height[nowIdx];
  const tempC = h.temperature_2m[nowIdx];

  const currentIdx = findCurrentHourIndex(data, nowMs);
  const snowingNow = currentIdx >= 0 && (h.snowfall[currentIdx] ?? 0) > 0
    && hasCurrentSnowForecast([{
      time: hourlyTime(data, h.time[currentIdx]),
      shortForecast: weatherCodeToLabel(h.weathercode[currentIdx]),
      precipProbability: h.precipitation_probability[currentIdx] ?? 0,
    }], nowMs);

  return {
    snowDepthIn: snowDepthM != null ? Math.round(metersToInches(snowDepthM) * 10) / 10 : null,
    newSnow24hIn: Math.round(cmToInches(newSnow24hCm) * 10) / 10,
    newSnow48hIn: Math.round(cmToInches(newSnow48hCm) * 10) / 10,
    forecastSnow48hIn: Math.round(cmToInches(forecastSnowCm) * 10) / 10,
    maxHighTemp48hF: Math.round(celsiusToFahrenheit(maxHighC)),
    skyCoverAvg: Math.round(skyCover),
    windGustMaxMph: Math.round(kmhToMph(windGustKmh)),
    freezingLevelFt: Math.round(metersToFeet(freezingLevelM ?? 0)),
    tempF: tempC != null ? Math.round(celsiusToFahrenheit(tempC)) : null,
    snowingNow,
  };
}

// ── Forecast (5-day) ────────────────────────────────────────────

export function parseForecast(data: OpenMeteoResponse): WeatherPeriod[] {
  const d = data.daily;
  const days: WeatherPeriod[] = [];

  for (let i = PAST_DAYS; i < d.time.length && days.length < 5; i++) {
    const code = d.weathercode[i];
    const high = Math.round(celsiusToFahrenheit(d.temperature_2m_max[i]));
    const low = Math.round(celsiusToFahrenheit(d.temperature_2m_min[i]));
    const windSpeed = Math.round(kmhToMph(d.wind_gusts_10m_max[i]));

    days.push({
      dow: days.length === 0 ? "Today" : DAY_NAMES[new Date(d.time[i]).getUTCDay()],
      condition: weatherCodeToCondition(code),
      high,
      low,
      snowInches: Math.round(cmToInches(d.snowfall_sum[i]) * 10) / 10,
      shortForecast: weatherCodeToLabel(code),
      windSpeed,
      windDirection: degreesToCompass(d.wind_direction_10m_dominant[i]),
      windGust: windSpeed,
      precipProbability: d.precipitation_probability_max[i] ?? null,
      feelsLike: windChill(high, windSpeed),
    });
  }

  return days;
}

// ── Hourly (next 48h) ────────────────────────────────────────────

export function parseHourly(data: OpenMeteoResponse): HourlyWeather[] {
  const h = data.hourly;
  const nowIdx = Math.min(NOW_IDX, h.time.length - 1);
  const hourly: HourlyWeather[] = [];

  for (let i = nowIdx; i < nowIdx + 48 && i < h.time.length; i++) {
    const temp = Math.round(celsiusToFahrenheit(h.temperature_2m[i]));
    const windSpeed = Math.round(kmhToMph(h.wind_speed_10m[i]));

    hourly.push({
      time: hourlyTime(data, h.time[i]),
      temperature: temp,
      windSpeed,
      windDirection: degreesToCompass(h.wind_direction_10m[i]),
      shortForecast: weatherCodeToLabel(h.weathercode[i]),
      condition: weatherCodeToCondition(h.weathercode[i]),
      snowInches: Math.round(cmToInches(h.snowfall[i]) * 10) / 10,
      precipProbability: h.precipitation_probability[i] ?? 0,
      feelsLike: windChill(temp, windSpeed),
    });
  }

  return hourly;
}

// ── Public API (fetch + parse) ──────────────────────────────────

export async function getOpenMeteoSnapshot(
  lat: number,
  lng: number,
  elevationFt?: number | null,
): Promise<OpenMeteoSnapshot | null> {
  const data = await fetchOpenMeteo(lat, lng, elevationFt);
  return data ? parseSnapshot(data) : null;
}

export async function getOpenMeteoForecast(
  lat: number,
  lng: number,
  elevationFt?: number | null,
): Promise<WeatherPeriod[] | null> {
  const data = await fetchOpenMeteo(lat, lng, elevationFt);
  if (!data) return null;
  const days = parseForecast(data);
  return days.length > 0 ? days : null;
}

export async function getOpenMeteoHourly(
  lat: number,
  lng: number,
  elevationFt?: number | null,
): Promise<HourlyWeather[] | null> {
  const data = await fetchOpenMeteo(lat, lng, elevationFt);
  if (!data) return null;
  const hourly = parseHourly(data);
  return hourly.length > 0 ? hourly : null;
}
