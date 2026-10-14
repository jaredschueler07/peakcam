import { test } from "node:test";
import assert from "node:assert";
import { fetchNws } from "./nws";
import { NWS_USER_AGENT } from "../../weather";
import type { ResortContext } from "../types";

// fetchNws must not carry its own NWS heuristic: it goes through
// lib/weather.getWeatherForecast, so a "Wintry Mix" period scores the same 1"
// here as it does on the resort page and in scripts/snotel-sync.ts.

const resort: ResortContext = {
  id: "r-1",
  slug: "test-resort",
  name: "Test Resort",
  lat: 39.6403,
  lng: -106.3742,
  snotel_station_id: null,
  metadata: null,
};

function period(name: string, isDaytime: boolean, temperature: number, shortForecast: string) {
  return {
    name,
    isDaytime,
    temperature,
    temperatureUnit: "F",
    shortForecast,
    windSpeed: "10 mph",
    windDirection: "W",
    probabilityOfPrecipitation: { value: 40 },
  };
}

const POINTS = {
  properties: {
    gridId: "BOU",
    gridX: 42,
    gridY: 73,
    forecast: "https://api.weather.gov/gridpoints/BOU/42,73/forecast",
    forecastHourly: "https://api.weather.gov/gridpoints/BOU/42,73/forecast/hourly",
    forecastGridData: "https://api.weather.gov/gridpoints/BOU/42,73",
  },
};

function withFetch<T>(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
  run: () => Promise<T>,
): Promise<T> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) =>
    handler(String(url), init)) as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = realFetch;
  });
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("fetchNws scores wintry mix through the shared lib/weather heuristic", async () => {
  const seenAgents: string[] = [];
  const reading = await withFetch(
    (url, init) => {
      seenAgents.push((init?.headers as Record<string, string>)["User-Agent"]);
      if (url.startsWith("https://api.weather.gov/points/")) return json(POINTS);
      return json({
        properties: {
          periods: [
            period("Today", true, 28, "Wintry Mix"),
            period("Tonight", false, 12, "Mostly Cloudy"),
            period("Tomorrow", true, 31, "Snow Showers"),
            period("Tomorrow Night", false, 15, "Clear"),
            period("Day 3", true, 40, "Heavy Snow"), // outside the 48h window
          ],
        },
      });
    },
    () => fetchNws(resort),
  );

  assert.ok(reading, "expected a reading");
  assert.strictEqual(reading.source, "nws");
  assert.strictEqual(reading.resort_id, "r-1");
  assert.strictEqual(reading.temp_high_f, 28);
  assert.strictEqual(reading.temp_low_f, 12);
  // Today = Wintry Mix (1"), not 0 as the old copy-pasted heuristic scored it.
  assert.strictEqual(reading.new_snow_24h_in, 1);
  // 48h = today (1") + tomorrow (3"); day 3's heavy snow is excluded.
  assert.strictEqual(reading.forecast_snow_48h_in, 4);
  assert.strictEqual(reading.forecast_high_48h_f, 31);
  assert.ok(seenAgents.every((ua) => ua === NWS_USER_AGENT), "every NWS call carries the shared UA");
});

test("fetchNws leaves forecast_snow_48h_in null when nothing wintry is forecast", async () => {
  const reading = await withFetch(
    (url) => {
      if (url.startsWith("https://api.weather.gov/points/")) return json(POINTS);
      return json({
        properties: {
          periods: [
            period("Today", true, 45, "Sunny"),
            period("Tonight", false, 30, "Clear"),
          ],
        },
      });
    },
    () => fetchNws(resort),
  );
  assert.ok(reading);
  assert.strictEqual(reading.new_snow_24h_in, 0);
  assert.strictEqual(reading.forecast_snow_48h_in, null);
});

test("fetchNws returns null when the NWS points lookup fails", async () => {
  const reading = await withFetch(
    () => new Response("upstream down", { status: 503 }),
    () => fetchNws(resort),
  );
  assert.strictEqual(reading, null);
});
