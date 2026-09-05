import { test } from "node:test";
import assert from "node:assert/strict";
import { hasCurrentSnowForecast, hasFreshSnowForecast } from "./snow-forecast";

const now = Date.parse("2026-09-05T18:30:00Z");
const hour = (shortForecast: string, precipProbability = 90, time = "2026-09-05T11:00:00-07:00") =>
  ({ time, shortForecast, precipProbability });

test("Mt. Bachelor: a slight chance of rain and snow is not a snowfall badge", () => {
  assert.equal(hasCurrentSnowForecast([hour("Slight Chance Rain And Snow Showers", 23)], now), false);
});

test("only the current hour can qualify, with timezone offsets respected", () => {
  assert.equal(hasCurrentSnowForecast([hour("Snow")], now), true);
  assert.equal(hasCurrentSnowForecast([hour("Snow", 90, "2026-09-05T19:00:00Z")], now), false);
  assert.equal(hasCurrentSnowForecast([hour("Snow", 90, "2026-09-05T17:00:00Z")], now), false);
  assert.equal(hasCurrentSnowForecast([hour("Sunny"), hour("Snow", 90, "2026-09-05T19:00:00Z")], now), false);
});

test("snowfall forecasts qualify, unrelated winter weather and uncertain text do not", () => {
  for (const text of ["Snow", "Heavy Snow", "Snow Showers Likely", "Flurries", "Rain And Snow", "Blizzard"]) {
    assert.equal(hasCurrentSnowForecast([hour(text)], now), true, text);
  }
  for (const text of ["Chance Snow", "Snow Possible", "Freezing Rain", "Freezing Fog", "Sleet", "Wintry Mix", "Blowing Snow", "Sunny"]) {
    assert.equal(hasCurrentSnowForecast([hour(text)], now), false, text);
  }
  assert.equal(hasCurrentSnowForecast([hour("Snow", 20)], now), false);
});

test("missing, invalid, and expired hourly forecasts fail closed", () => {
  for (const data of [null, undefined, [], [hour("Snow", 90, "invalid")]]) {
    assert.equal(hasCurrentSnowForecast(data, now), false);
  }
  assert.equal(hasCurrentSnowForecast([hour("Snow")], Date.parse("2026-09-05T19:00:00Z")), false);
});

test("stored forecasts expire at the end of their sampled hour", () => {
  const report = { snowing_now: true, updated_at: "2026-09-05T18:20:00Z" };
  assert.equal(hasFreshSnowForecast(report, now), true);
  assert.equal(hasFreshSnowForecast(report, Date.parse("2026-09-05T19:00:00Z")), false);
  assert.equal(hasFreshSnowForecast(report, Date.parse("2026-09-05T18:00:00Z")), false);
  assert.equal(hasFreshSnowForecast({ ...report, updated_at: "invalid" }, now), false);
  assert.equal(hasFreshSnowForecast({ ...report, snowing_now: false }, now), false);
  assert.equal(hasFreshSnowForecast(null, now), false);
});
