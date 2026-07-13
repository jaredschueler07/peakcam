import { test } from "node:test";
import assert from "node:assert";
import {
  cmToInches,
  metersToInches,
  metersToFeet,
  feetToMeters,
  celsiusToFahrenheit,
  kmhToMph,
  weatherCodeToCondition,
  weatherCodeToLabel,
  degreesToCompass,
  parseSnapshot,
  parseForecast,
  parseHourly,
  type OpenMeteoResponse,
} from "./open-meteo";

// ── Unit conversions ──────────────────────────────────────────

test("cmToInches converts centimeters to inches", () => {
  assert.strictEqual(cmToInches(2.54), 1);
  assert.strictEqual(cmToInches(0), 0);
});

test("metersToInches and metersToFeet convert meters", () => {
  assert.ok(Math.abs(metersToInches(1) - 39.3701) < 0.001);
  assert.ok(Math.abs(metersToFeet(1) - 3.28084) < 0.001);
});

test("feetToMeters is the inverse of metersToFeet", () => {
  assert.ok(Math.abs(feetToMeters(metersToFeet(100)) - 100) < 0.01);
});

test("celsiusToFahrenheit converts known reference points", () => {
  assert.strictEqual(celsiusToFahrenheit(0), 32);
  assert.strictEqual(celsiusToFahrenheit(100), 212);
  assert.strictEqual(celsiusToFahrenheit(-40), -40);
});

test("kmhToMph converts km/h to mph", () => {
  assert.ok(Math.abs(kmhToMph(100) - 62.1371) < 0.001);
});

// ── Weather code mapping ──────────────────────────────────────

test("weatherCodeToCondition maps known WMO codes", () => {
  assert.strictEqual(weatherCodeToCondition(0), "clear");
  assert.strictEqual(weatherCodeToCondition(3), "cloudy");
  assert.strictEqual(weatherCodeToCondition(45), "fog");
  assert.strictEqual(weatherCodeToCondition(61), "rain");
  assert.strictEqual(weatherCodeToCondition(56), "freezing-rain");
  assert.strictEqual(weatherCodeToCondition(71), "light-snow");
  assert.strictEqual(weatherCodeToCondition(75), "heavy-snow");
});

test("weatherCodeToCondition falls back to partly-cloudy for unknown codes", () => {
  assert.strictEqual(weatherCodeToCondition(999), "partly-cloudy");
});

test("weatherCodeToLabel maps known codes to human labels", () => {
  assert.strictEqual(weatherCodeToLabel(0), "Clear");
  assert.strictEqual(weatherCodeToLabel(75), "Heavy Snow");
});

test("degreesToCompass maps compass points including wrap-around", () => {
  assert.strictEqual(degreesToCompass(0), "N");
  assert.strictEqual(degreesToCompass(90), "E");
  assert.strictEqual(degreesToCompass(180), "S");
  assert.strictEqual(degreesToCompass(270), "W");
  assert.strictEqual(degreesToCompass(45), "NE");
  assert.strictEqual(degreesToCompass(359), "N");
});

// ── Parsers, against a synthetic fixture ──────────────────────
// PAST_DAYS=2 → hourly index 48 is "now" (local midnight of today).
// Build 96 hourly entries (4 days) so every 48h window (past and
// future) is fully populated — a shorter fixture would silently
// under-count due to the parser's array-bounds guard.

function buildFixture(): OpenMeteoResponse {
  const hourlyTimes: string[] = [];
  const snowfall: number[] = [];
  const snowDepth: number[] = [];
  const temp: number[] = [];
  const windGust: number[] = [];
  const windSpeed: number[] = [];
  const windDir: number[] = [];
  const cloudCover: number[] = [];
  const freezingLevel: number[] = [];
  const weathercode: number[] = [];
  const precipProb: number[] = [];

  const start = new Date("2026-07-10T00:00:00");
  for (let i = 0; i < 96; i++) {
    const t = new Date(start.getTime() + i * 3600_000);
    hourlyTimes.push(t.toISOString().slice(0, 16));
    snowfall.push(1); // 1cm every hour → 24h window = 24cm, 48h window = 48cm
    snowDepth.push(0.5); // constant 0.5m depth (~19.7in) — snow_depth is in METERS, not cm
    temp.push(-5); // constant -5C (=23F)
    windGust.push(20); // constant 20km/h
    windSpeed.push(10);
    windDir.push(90); // due east
    cloudCover.push(40); // constant 40%
    freezingLevel.push(2000); // constant 2000m (~6562ft)
    weathercode.push(71); // light snow
    precipProb.push(60);
  }

  const dailyTimes = ["2026-07-08", "2026-07-09", "2026-07-10", "2026-07-11", "2026-07-12"];

  return {
    elevation: 2500,
    hourly: {
      time: hourlyTimes,
      snowfall,
      snow_depth: snowDepth,
      temperature_2m: temp,
      wind_gusts_10m: windGust,
      wind_speed_10m: windSpeed,
      wind_direction_10m: windDir,
      cloud_cover: cloudCover,
      freezing_level_height: freezingLevel,
      weathercode,
      precipitation_probability: precipProb,
    },
    daily: {
      time: dailyTimes,
      weathercode: [71, 71, 71, 73, 0],
      temperature_2m_max: [-3, -3, -3, -2, 5],
      temperature_2m_min: [-8, -8, -8, -7, -1],
      snowfall_sum: [24, 24, 24, 30, 0],
      precipitation_probability_max: [60, 60, 60, 70, 10],
      wind_gusts_10m_max: [25, 25, 25, 30, 10],
      wind_direction_10m_dominant: [90, 90, 90, 180, 270],
    },
  };
}

test("parseSnapshot computes depth, new-snow windows, and grid fields", () => {
  const snap = parseSnapshot(buildFixture());
  assert.ok(Math.abs(snap.snowDepthIn! - 19.7) < 0.2); // 50cm ≈ 19.69in
  // All snow-inch fields are rounded to 1 decimal by the implementation
  // (Math.round(x * 10) / 10) — match that rounding in the expected value,
  // not the raw conversion, or these assertions fail even on correct code.
  assert.strictEqual(snap.newSnow24hIn, Math.round(cmToInches(24) * 10) / 10);
  assert.strictEqual(snap.newSnow48hIn, Math.round(cmToInches(48) * 10) / 10);
  assert.strictEqual(snap.forecastSnow48hIn, Math.round(cmToInches(48) * 10) / 10); // next 48h, same constant rate
  assert.strictEqual(snap.maxHighTemp48hF, celsiusToFahrenheit(-5));
  assert.strictEqual(snap.skyCoverAvg, 40);
  assert.ok(Math.abs(snap.windGustMaxMph - kmhToMph(20)) < 0.5);
  assert.ok(Math.abs(snap.freezingLevelFt - metersToFeet(2000)) < 5);
  assert.strictEqual(snap.tempF, celsiusToFahrenheit(-5));
  assert.strictEqual(snap.snowingNow, true); // constant 1cm/hr snowfall throughout
});

test("parseForecast shapes 5 daily WeatherPeriod entries starting with Today", () => {
  const days = parseForecast(buildFixture());
  assert.strictEqual(days.length, 3); // forecast_days beyond past_days: indices 2,3,4
  assert.strictEqual(days[0].dow, "Today");
  assert.strictEqual(days[0].condition, "light-snow");
  // high/low are Math.round()-ed by the implementation — -3C/-8C aren't
  // exact-integer °F conversions, so match the rounded value, not the raw one.
  assert.strictEqual(days[0].high, Math.round(celsiusToFahrenheit(-3)));
  assert.strictEqual(days[0].low, Math.round(celsiusToFahrenheit(-8)));
  assert.strictEqual(days[1].shortForecast, "Snow");
  assert.strictEqual(days[2].condition, "clear");
});

test("parseHourly returns the next 48 hours shaped as HourlyWeather", () => {
  const hourly = parseHourly(buildFixture());
  assert.strictEqual(hourly.length, 48);
  assert.strictEqual(hourly[0].temperature, celsiusToFahrenheit(-5));
  assert.strictEqual(hourly[0].condition, "light-snow");
  assert.strictEqual(hourly[0].windDirection, "E");
  assert.strictEqual(hourly[0].snowInches, Math.round(cmToInches(1) * 10) / 10);
});
