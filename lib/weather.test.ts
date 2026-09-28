import { test } from "node:test";
import assert from "node:assert/strict";
import type { HourlyWeather } from "./types";
import { bucketIntoPeriods, forecastToCondition, parseLocalParts, windChill } from "./weather";

// ── parseLocalParts ───────────────────────────────────────────
// The whole point: read the wall clock the string was written in, never the
// server's. NWS hourly `startTime` carries the resort offset; Open-Meteo hours
// get one attached by lib/open-meteo.ts hourlyTime().

test("parseLocalParts reads hour, date and weekday from the string's own offset", () => {
  // 2026-11-02 is a Monday.
  assert.deepEqual(parseLocalParts("2026-11-02T06:00:00-07:00"), { hour: 6, dateKey: "2026-11-02", weekday: 1 });
  // 23:00 local is 06:00Z the next day — the UTC view must not leak in.
  assert.deepEqual(parseLocalParts("2026-11-02T23:00:00-07:00"), { hour: 23, dateKey: "2026-11-02", weekday: 1 });
  // Positive and half-hour offsets, seconds with a fraction, compact offset.
  assert.deepEqual(parseLocalParts("2026-01-01T00:00:00+05:30"), { hour: 0, dateKey: "2026-01-01", weekday: 4 });
  assert.deepEqual(parseLocalParts("2026-07-12T12:00:00.000-03:00"), { hour: 12, dateKey: "2026-07-12", weekday: 0 });
  assert.deepEqual(parseLocalParts("2026-07-12T18:00:00-0300"), { hour: 18, dateKey: "2026-07-12", weekday: 0 });
});

test("parseLocalParts takes zone-less and Z strings as written", () => {
  assert.deepEqual(parseLocalParts("2026-07-12T12:00"), { hour: 12, dateKey: "2026-07-12", weekday: 0 });
  assert.deepEqual(parseLocalParts("2026-11-03T01:00:00Z"), { hour: 1, dateKey: "2026-11-03", weekday: 2 });
  assert.deepEqual(parseLocalParts(" 2026-11-03T01:00:00Z "), { hour: 1, dateKey: "2026-11-03", weekday: 2 });
});

test("parseLocalParts rejects malformed and impossible timestamps", () => {
  for (const bad of [
    "",
    "garbage",
    "2026-11-02",                 // date only
    "2026-11-02 06:00:00-07:00",  // no T
    "2026-13-01T00:00:00Z",       // month 13
    "2026-02-30T10:00:00Z",       // Feb 30 rolls over in Date.UTC
    "2026-11-02T24:00:00Z",       // hour 24
    "2026-11-02T06:60:00Z",       // minute 60
    "1762066800000",              // epoch millis
  ]) {
    assert.equal(parseLocalParts(bad), null, bad);
  }
});

// ── bucketIntoPeriods ─────────────────────────────────────────

function hour(time: string, over: Partial<HourlyWeather> = {}): HourlyWeather {
  return {
    time,
    temperature: 20,
    windSpeed: 5,
    windDirection: "W",
    shortForecast: "Sunny",
    condition: "clear",
    snowInches: 0,
    precipProbability: 0,
    feelsLike: 14,
    ...over,
  };
}

/**
 * A -07:00 NWS-style series that crosses local midnight: Monday 2026-11-02
 * 16:00 through Tuesday 2026-11-03 13:00, 22 hourly rows. In UTC that is
 * 23:00Z Monday → 20:00Z Tuesday, so bucketing in server UTC would have filed
 * Monday 17:00–23:00 local under Tuesday (or dropped it as "overnight") and
 * put Monday 23:00 local (06:00Z) into Tuesday morning.
 */
function mountainSeries(): HourlyWeather[] {
  const rows: HourlyWeather[] = [];
  for (let h = 16; h <= 23; h++) {
    rows.push(hour(`2026-11-02T${String(h).padStart(2, "0")}:00:00-07:00`, {
      snowInches: h >= 18 ? 0.5 : 0,
      temperature: h === 23 ? 1 : 20,
      condition: h >= 18 ? "light-snow" : "clear",
      shortForecast: h >= 18 ? "Light Snow" : "Sunny",
    }));
  }
  for (let h = 0; h <= 13; h++) {
    rows.push(hour(`2026-11-03T${String(h).padStart(2, "0")}:00:00-07:00`, {
      temperature: h < 6 ? -10 : 25,
    }));
  }
  return rows;
}

test("bucketIntoPeriods files a -07:00 series by resort-local hour and day across midnight", () => {
  const periods = bucketIntoPeriods(mountainSeries());
  assert.deepEqual(
    periods.map((p) => `${p.day} ${p.period}`),
    ["Mon afternoon", "Mon evening", "Tue morning", "Tue afternoon"],
  );

  const [monAfternoon, monEvening, tueMorning, tueAfternoon] = periods;
  // 16:00 + 17:00 local → afternoon; no snow yet.
  assert.equal(monAfternoon.snowInches, 0);
  // 18:00–23:00 local → six evening hours at 0.5" each, still on Monday.
  assert.equal(monEvening.snowInches, 3);
  assert.equal(monEvening.condition, "light-snow");
  assert.equal(monEvening.shortForecast, "Light Snow");
  // The 23:00 local row (06:00Z Tuesday) stays in Monday's evening…
  assert.equal(monEvening.lowTemp, 1);
  // …and Tuesday morning holds only 06:00–11:00 local, so the overnight -10°
  // rows (00:00–05:00 local) never appear anywhere.
  assert.equal(tueMorning.lowTemp, 25);
  assert.equal(tueMorning.highTemp, 25);
  assert.equal(tueAfternoon.highTemp, 25);
  for (const p of periods) assert.notEqual(p.lowTemp, -10);
});

test("bucketIntoPeriods is independent of the server timezone", () => {
  const previous = process.env.TZ;
  const results: string[] = [];
  try {
    for (const tz of ["UTC", "America/Denver", "Asia/Kolkata", "Pacific/Auckland"]) {
      process.env.TZ = tz;
      results.push(JSON.stringify(bucketIntoPeriods(mountainSeries())));
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
  for (const r of results) assert.equal(r, results[0]);
});

test("bucketIntoPeriods skips overnight and malformed rows and keeps day order", () => {
  const periods = bucketIntoPeriods([
    hour("2026-07-12T03:00:00-03:00"),  // overnight — dropped
    hour("not a timestamp"),            // malformed — dropped
    hour("2026-07-12T09:00:00-03:00", { temperature: 30 }),
    hour("2026-07-12T10:00:00-03:00", { temperature: 40, windSpeed: 15 }),
  ]);
  assert.equal(periods.length, 1);
  assert.equal(periods[0].day, "Sun");
  assert.equal(periods[0].period, "morning");
  assert.equal(periods[0].highTemp, 40);
  assert.equal(periods[0].lowTemp, 30);
  assert.equal(periods[0].windSpeed, 10); // mean of 5 and 15
  assert.equal(periods[0].windGust, 15);  // max
  assert.equal(bucketIntoPeriods([]).length, 0);
});

// ── Small pure helpers already exported from this module ──────

test("forecastToCondition maps NWS short forecasts to icon keys", () => {
  assert.equal(forecastToCondition("Blizzard"), "blizzard");
  assert.equal(forecastToCondition("Heavy Snow"), "heavy-snow");
  assert.equal(forecastToCondition("Rain And Snow"), "mixed");
  assert.equal(forecastToCondition("Light Snow"), "light-snow");
  assert.equal(forecastToCondition("Freezing Rain"), "freezing-rain");
  assert.equal(forecastToCondition("Chance Rain Showers"), "rain");
  assert.equal(forecastToCondition("Patchy Fog"), "fog");
  assert.equal(forecastToCondition("Mostly Cloudy"), "partly-cloudy");
  assert.equal(forecastToCondition("Sunny"), "clear");
  assert.equal(forecastToCondition(""), "partly-cloudy");
});

test("windChill applies the NWS formula only when it is cold and windy", () => {
  assert.equal(windChill(60, 20), 60);   // too warm
  assert.equal(windChill(20, 2), 20);    // not enough wind
  assert.equal(windChill(20, 15), 6);    // NWS table: 20°F @ 15 mph → 6°F
  assert.equal(windChill(0, 25), -24);   // NWS table: 0°F @ 25 mph → -24°F
});
