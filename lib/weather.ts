import type { WeatherPeriod } from "./types";

// ─────────────────────────────────────────────────────────────
// National Weather Service API helpers
// Free — no API key required.
// All fetches MUST be server-side. NWS rate-limits aggressively.
// ─────────────────────────────────────────────────────────────

const NWS_USER_AGENT = "PeakCam/1.0 (contact@peakcam.app)"; // NWS requires a UA string

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

/** Weather icon emoji from NWS forecast string. */
function forecastToIcon(shortForecast: string): string {
  const lower = shortForecast.toLowerCase();
  if (lower.includes("blizzard") || lower.includes("heavy snow")) return "🌨️";
  if (lower.includes("snow") || lower.includes("wintry")) return "🌨️";
  if (lower.includes("rain") && lower.includes("snow")) return "🌧️";
  if (lower.includes("rain") || lower.includes("shower")) return "🌧️";
  if (lower.includes("thunder")) return "⛈️";
  if (lower.includes("partly") || lower.includes("mostly cloud")) return "⛅";
  if (lower.includes("cloud") || lower.includes("overcast")) return "☁️";
  if (lower.includes("mostly sunny") || lower.includes("mostly clear")) return "🌤️";
  if (lower.includes("sunny") || lower.includes("clear")) return "☀️";
  return "⛅";
}

interface NWSPeriod {
  name: string;
  temperature: number;
  temperatureUnit: string;
  shortForecast: string;
  isDaytime: boolean;
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
    // Step 1: resolve the forecast office and gridpoint
    const pointsRes = await fetch(
      `https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`,
      {
        headers: { "User-Agent": NWS_USER_AGENT },
        next: { revalidate: 3600 }, // cache 1 hour
      }
    );
    if (!pointsRes.ok) return null;
    const pointsData = await pointsRes.json();
    const forecastUrl: string = pointsData?.properties?.forecast;
    if (!forecastUrl) return null;

    // Step 2: fetch the forecast
    const forecastRes = await fetch(forecastUrl, {
      headers: { "User-Agent": NWS_USER_AGENT },
      next: { revalidate: 3600 },
    });
    if (!forecastRes.ok) return null;
    const forecastData = await forecastRes.json();
    const periods: NWSPeriod[] = forecastData?.properties?.periods ?? [];

    // Step 3: collapse daytime/nighttime pairs into days
    const days: WeatherPeriod[] = [];
    let i = 0;
    while (i < periods.length && days.length < 5) {
      const p = periods[i];
      const next = periods[i + 1];

      if (p.isDaytime) {
        const low = next && !next.isDaytime ? next.temperature : null;
        days.push({
          dow: days.length === 0 ? "Today" : p.name.substring(0, 3),
          icon: forecastToIcon(p.shortForecast),
          high: p.temperature,
          low,
          snowInches: Math.max(
            estimateSnow(p.shortForecast),
            low != null ? estimateSnow(next?.shortForecast ?? "") : 0
          ),
          shortForecast: p.shortForecast,
        });
        i += next && !next.isDaytime ? 2 : 1;
      } else {
        // Starts on a night period (rare) — skip
        i++;
      }
    }

    return days.length > 0 ? days : null;
  } catch {
    // NWS is occasionally flaky — never crash the page
    return null;
  }
}
