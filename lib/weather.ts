import type { WeatherPeriod, HourlyWeather, ForecastPeriod } from "./types";

// ─────────────────────────────────────────────────────────────
// National Weather Service API helpers
// Free — no API key required.
// All fetches MUST be server-side. NWS rate-limits aggressively.
// ─────────────────────────────────────────────────────────────

const NWS_USER_AGENT = "PeakCam/1.0 (contact@peakcam.io)"; // NWS requires a UA string

/** Snow-related keywords in NWS short forecast strings. */
const SNOW_KEYWORDS = [
  "snow", "blizzard", "flurr", "wintry", "sleet", "freezing",
];

/** Rough snow-inch estimate from NWS forecast string.
 *  NWS doesn't provide a structured snow amount in the basic forecast —
 *  this is a heuristic until we wire up the detailed hourly forecast. */
function estimateSnow(shortForecast: string): number {
  const lower = shortForecast.toLowerCase();
  if (lower.includes("blizzard") || lower.includes("heavy snow")) return 8;
  if (lower.includes("snow")) return 3;
  if (lower.includes("flurr") || lower.includes("wintry mix")) return 1;
  return 0;
}

/** Map NWS shortForecast string to a condition key for WeatherIcon. */
export function forecastToCondition(shortForecast: string): string {
  const lower = shortForecast.toLowerCase();
  if (lower.includes("blizzard")) return "blizzard";
  if (lower.includes("heavy snow")) return "heavy-snow";
  if (lower.includes("snow") && lower.includes("rain")) return "mixed";
  if (lower.includes("wintry mix") || lower.includes("sleet")) return "mixed";
  if (lower.includes("snow") || lower.includes("flurr")) return "light-snow";
  if (lower.includes("freezing rain") || lower.includes("freezing drizzle")) return "freezing-rain";
  if (lower.includes("rain") || lower.includes("shower") || lower.includes("drizzle")) return "rain";
  if (lower.includes("thunder")) return "rain";
  if (lower.includes("fog") || lower.includes("haze") || lower.includes("mist")) return "fog";
  if (lower.includes("wind")) return "wind";
  if (lower.includes("partly") || lower.includes("mostly cloud")) return "partly-cloudy";
  if (lower.includes("cloud") || lower.includes("overcast")) return "cloudy";
  if (lower.includes("sunny") || lower.includes("clear")) return "clear";
  return "partly-cloudy";
}

/** Wind chill formula (NWS standard).
 *  Returns feelsLike temp in °F. */
export function windChill(tempF: number, windMph: number): number {
  if (tempF <= 50 && windMph >= 3) {
    return Math.round(
      35.74 +
        0.6215 * tempF -
        35.75 * Math.pow(windMph, 0.16) +
        0.4275 * tempF * Math.pow(windMph, 0.16)
    );
  }
  return tempF;
}

/** Parse wind speed string like "15 mph" or "10 to 20 mph" into a number. */
function parseWindSpeed(windStr: string): number {
  const matches = windStr.match(/(\d+)/g);
  if (!matches) return 0;
  const nums = matches.map(Number);
  // For ranges like "10 to 20 mph", take the higher value
  return Math.max(...nums);
}

interface NWSPeriod {
  name: string;
  temperature: number;
  temperatureUnit: string;
  shortForecast: string;
  isDaytime: boolean;
  windSpeed?: string;
  windDirection?: string;
  probabilityOfPrecipitation?: { value: number | null };
}

/** Resolve NWS grid point from lat/lng. Returns { office, gridX, gridY, forecastUrl, forecastHourlyUrl }. */
async function resolveGridPoint(lat: number, lng: number) {
  const pointsRes = await fetch(
    `https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`,
    {
      headers: { "User-Agent": NWS_USER_AGENT },
      next: { revalidate: 3600 },
    }
  );
  if (!pointsRes.ok) return null;
  const data = await pointsRes.json();
  const props = data?.properties;
  if (!props) return null;
  return {
    office: props.gridId as string,
    gridX: props.gridX as number,
    gridY: props.gridY as number,
    forecastUrl: props.forecast as string,
    forecastHourlyUrl: props.forecastHourly as string,
  };
}

/**
 * Fetch 5-day forecast for a given lat/lng from the NWS API.
 * Returns null if NWS is unreachable — always handle gracefully.
 */
export async function getWeatherForecast(
  lat: number,
  lng: number
): Promise<WeatherPeriod[] | null> {
  try {
    const grid = await resolveGridPoint(lat, lng);
    if (!grid?.forecastUrl) return null;

    const forecastRes = await fetch(grid.forecastUrl, {
      headers: { "User-Agent": NWS_USER_AGENT },
      next: { revalidate: 3600 },
    });
    if (!forecastRes.ok) return null;
    const forecastData = await forecastRes.json();
    const periods: NWSPeriod[] = forecastData?.properties?.periods ?? [];

    // Collapse daytime/nighttime pairs into days
    const days: WeatherPeriod[] = [];
    let i = 0;
    while (i < periods.length && days.length < 5) {
      const p = periods[i];
      const next = periods[i + 1];

      if (p.isDaytime) {
        const low = next && !next.isDaytime ? next.temperature : null;
        const ws = p.windSpeed ? parseWindSpeed(p.windSpeed) : null;
        const high = p.temperature;
        days.push({
          dow: days.length === 0 ? "Today" : p.name.substring(0, 3),
          condition: forecastToCondition(p.shortForecast),
          high,
          low,
          snowInches: Math.max(
            estimateSnow(p.shortForecast),
            low != null ? estimateSnow(next?.shortForecast ?? "") : 0
          ),
          shortForecast: p.shortForecast,
          windSpeed: ws,
          windDirection: p.windDirection ?? null,
          windGust: null, // Not available in basic forecast
          precipProbability: p.probabilityOfPrecipitation?.value ?? null,
          feelsLike: ws != null ? windChill(high, ws) : null,
        });
        i += next && !next.isDaytime ? 2 : 1;
      } else {
        i++;
      }
    }

    return days.length > 0 ? days : null;
  } catch {
    return null;
  }
}

/**
 * Fetch 48-hour hourly forecast from NWS.
 * Returns null if NWS is unreachable.
 */
export async function getHourlyForecast(
  lat: number,
  lng: number
): Promise<HourlyWeather[] | null> {
  try {
    const grid = await resolveGridPoint(lat, lng);
    if (!grid?.forecastHourlyUrl) return null;

    const res = await fetch(grid.forecastHourlyUrl, {
      headers: { "User-Agent": NWS_USER_AGENT },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const periods = data?.properties?.periods ?? [];

    const hourly: HourlyWeather[] = periods.slice(0, 48).map(
      (p: {
        startTime: string;
        temperature: number;
        windSpeed: string;
        windDirection: string;
        shortForecast: string;
        probabilityOfPrecipitation?: { value: number | null };
      }) => {
        const ws = parseWindSpeed(p.windSpeed);
        const temp = p.temperature;
        return {
          time: p.startTime,
          temperature: temp,
          windSpeed: ws,
          windDirection: p.windDirection,
          shortForecast: p.shortForecast,
          condition: forecastToCondition(p.shortForecast),
          snowInches: estimateSnow(p.shortForecast),
          precipProbability: p.probabilityOfPrecipitation?.value ?? 0,
          feelsLike: windChill(temp, ws),
        };
      }
    );

    return hourly.length > 0 ? hourly : null;
  } catch {
    return null;
  }
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Bucket hourly data into morning/afternoon/evening periods per day. */
export function bucketIntoPeriods(hourly: HourlyWeather[]): ForecastPeriod[] {
  type Bucket = { period: "morning" | "afternoon" | "evening"; day: string; items: HourlyWeather[] };
  const buckets = new Map<string, Bucket>();

  for (const h of hourly) {
    const date = new Date(h.time);
    const hour = date.getHours();
    const dayKey = date.toISOString().slice(0, 10);
    const dow = DAY_NAMES[date.getDay()];

    let period: "morning" | "afternoon" | "evening";
    if (hour >= 6 && hour < 12) period = "morning";
    else if (hour >= 12 && hour < 18) period = "afternoon";
    else if (hour >= 18 && hour < 24) period = "evening";
    else continue; // skip overnight (0-6)

    const key = `${dayKey}-${period}`;
    if (!buckets.has(key)) {
      buckets.set(key, { period, day: dow, items: [] });
    }
    buckets.get(key)!.items.push(h);
  }

  const results: ForecastPeriod[] = [];

  for (const bucket of buckets.values()) {
    const { items, day, period } = bucket;
    if (items.length === 0) continue;

    // Dominant condition: most frequent
    const condCount = new Map<string, number>();
    for (const it of items) {
      condCount.set(it.condition, (condCount.get(it.condition) ?? 0) + 1);
    }
    let dominantCondition = items[0].condition;
    let maxCount = 0;
    for (const [cond, count] of condCount) {
      if (count > maxCount) {
        dominantCondition = cond;
        maxCount = count;
      }
    }

    // Dominant wind direction: most frequent
    const dirCount = new Map<string, number>();
    for (const it of items) {
      dirCount.set(it.windDirection, (dirCount.get(it.windDirection) ?? 0) + 1);
    }
    let dominantDir = items[0].windDirection;
    let maxDirCount = 0;
    for (const [dir, count] of dirCount) {
      if (count > maxDirCount) {
        dominantDir = dir;
        maxDirCount = count;
      }
    }

    // Most representative shortForecast: from the item with dominant condition
    const representative = items.find((it) => it.condition === dominantCondition) ?? items[0];

    results.push({
      day,
      period,
      condition: dominantCondition,
      highTemp: Math.max(...items.map((it) => it.temperature)),
      lowTemp: Math.min(...items.map((it) => it.temperature)),
      feelsLike: Math.min(...items.map((it) => it.feelsLike)),
      windSpeed: Math.round(items.reduce((sum, it) => sum + it.windSpeed, 0) / items.length),
      windGust: Math.max(...items.map((it) => it.windSpeed)),
      windDirection: dominantDir,
      snowInches: items.reduce((sum, it) => sum + it.snowInches, 0),
      precipProbability: Math.max(...items.map((it) => it.precipProbability)),
      shortForecast: representative.shortForecast,
    });
  }

  return results;
}
