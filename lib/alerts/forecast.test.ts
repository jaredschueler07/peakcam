import { test } from "node:test";
import assert from "node:assert/strict";
import { findForecastAlert } from "./forecast";
import type { WeatherPeriod } from "../types";
const periods = (snow: number[]) => snow.map((snowInches, i) => ({
  snowInches,
  date: `2026-09-${String(10 + i).padStart(2, "0")}`,
} as WeatherPeriod));
test("finds a three-day storm starting tomorrow", () => {
  assert.deepEqual(findForecastAlert(periods([0, 1, 1, 1, 0, 0, 0]), 2), {
    snowInches: 3,
    leadDays: 1,
    forecastDays: 3,
    stormStartDate: "2026-09-11",
  });
});
test("respects each threshold", () => {
  assert.equal(findForecastAlert(periods([0, 1, 1, 1, 0, 0, 0]), 12), null);
});
test("finds snow at the end of the seven-day horizon", () => {
  assert.deepEqual(findForecastAlert(periods([0, 0, 0, 0, 0, 0, 3]), 2), {
    snowInches: 3,
    leadDays: 6,
    forecastDays: 1,
    stormStartDate: "2026-09-16",
  });
});
test("ignores today, invalid snowfall and days beyond the horizon", () => {
  assert.equal(findForecastAlert(periods([20, NaN, -1, 0, 0, 0, 0, 20]), 2), null);
});
test("empty forecast cannot alert", () => assert.equal(findForecastAlert([], 2), null));
