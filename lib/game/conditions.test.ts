import assert from "node:assert/strict";
import test from "node:test";
import type { Resort, SnowReport, WeatherPeriod } from "../types";
import { buildConditionsSnapshot } from "./conditions";

const resort = {
  id: "resort-1", name: "Heavenly", slug: "heavenly", state: "CA", country: "US",
  region: "Tahoe", lat: 38.9, lng: -120.0, website_url: null, cam_page_url: null,
  cond_rating: "good", snotel_station_id: null, x_url: null, facebook_url: null,
  instagram_url: null, is_active: true, created_at: "2025-01-01T00:00:00Z",
} satisfies Resort;

const report = {
  id: "report-1", resort_id: resort.id, base_depth: 64, new_snow_24h: 3,
  new_snow_48h: 5, trails_open: 90, trails_total: 97, lifts_open: 24,
  lifts_total: 28, conditions: "Packed powder", source: "pipeline",
  updated_at: "2026-02-03T14:00:00Z", swe_in: 18, pct_of_normal: 104,
  trend_7d: "rising", outlook: "stable", auto_cond_rating: "good",
  snowing_now: false,
} satisfies SnowReport;

const snowForecast = [{
  dow: "Today", condition: "light-snow", high: 26, low: 15, snowInches: 3,
  shortForecast: "Snow showers", windSpeed: 12, windDirection: "W",
  windGust: 24, precipProbability: 80, feelsLike: 14,
}] satisfies WeatherPeriod[];

test("eight inches in 24 hours takes priority and produces the powder-day snapshot", () => {
  assert.deepEqual(buildConditionsSnapshot(resort, { ...report, new_snow_24h: 8 }, null), {
    surface: "powder", weatherDefault: 0, powderDay: true,
    baseDepthIn: 64, snow24In: 8, stamp: "POWDER DAY",
  });
});

test("poor and explicitly icy conditions map to distinct hard-snow surfaces", () => {
  assert.equal(buildConditionsSnapshot({ ...resort, cond_rating: "poor" }, report).surface, "firm");
  assert.equal(buildConditionsSnapshot({ ...resort, cond_rating: "icy" } as unknown as Resort, report).surface, "ice");
  assert.equal(buildConditionsSnapshot(resort, { ...report, conditions: "Machine groomed, icy" }).surface, "ice");
});

test("NWS snow selects the snowfall preset without changing packed surface", () => {
  assert.deepEqual(buildConditionsSnapshot(resort, report, snowForecast), {
    surface: "packed", weatherDefault: 1, powderDay: false,
    baseDepthIn: 64, snow24In: 3, stamp: "Packed powder",
  });
});

test("missing live data uses the deterministic classic fallback", () => {
  assert.deepEqual(buildConditionsSnapshot(resort, null, null), {
    surface: "packed", weatherDefault: 0, powderDay: false,
    baseDepthIn: null, snow24In: null, stamp: "Classic conditions",
  });
});

test("a forecast-only snapshot still starts in snowfall weather", () => {
  assert.deepEqual(buildConditionsSnapshot(resort, null, snowForecast), {
    surface: "packed", weatherDefault: 1, powderDay: false,
    baseDepthIn: null, snow24In: null, stamp: "Classic conditions",
  });
});
