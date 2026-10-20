import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAwdbDaily, tripletFor } from "./snotel-backfill";
import { computeStationNormals, type StationRecord } from "./seed-snotel-normals";
import { addDays, deriveNewSnow, type DailyRow } from "../lib/snow-history";

test("tripletFor appends :STATE:SNTL only to a bare station number", () => {
  assert.equal(tripletFor("531", "CO"), "531:CO:SNTL");
  assert.equal(tripletFor("2041:VT:SCAN", "VT"), "2041:VT:SCAN");
});

test("parseAwdbDaily joins the six elements by calendar day and drops -99 / null", () => {
  const days = parseAwdbDaily([
    { stationElement: { elementCode: "SNWD" }, values: [{ date: "2026-01-01 00:00", value: 40 }, { date: "2026-01-02 00:00", value: -99 }, { date: "2026-01-03 00:00", value: 44 }] },
    { stationElement: { elementCode: "WTEQ" }, values: [{ date: "2026-01-01 00:00", value: 10.2 }, { date: "2026-01-02 00:00", value: 10.4 }, { date: "2026-01-03 00:00", value: null }] },
    { stationElement: { elementCode: "TMAX" }, values: [{ date: "2026-01-03 00:00", value: 28 }] },
  ]);
  assert.deepEqual(
    days.map((d) => [d.date, d.snowDepthIn, d.sweIn, d.tempMaxF, d.precipAccumIn]),
    [
      ["2026-01-01", 40, 10.2, null, null],
      ["2026-01-02", null, 10.4, null, null],
      ["2026-01-03", 44, null, 28, null],
    ],
  );
  assert.deepEqual(parseAwdbDaily([]), []);
});

test("computeStationNormals writes 366 daily rows and 24 monthly rows with the new columns filled from the record", () => {
  // 32 synthetic winters, 273 days each, 1 in every third day plus a 10 in storm on day 60.
  const daily: DailyRow[] = [];
  for (let wy = 1995; wy <= 2026; wy++) {
    let depth = 0;
    for (let d = 1; d <= 273; d++) {
      depth += d === 60 ? 10 : d % 3 === 0 ? 1 : 0;
      daily.push({ date: addDays(`${wy - 1}-10-01`, d - 1), snowDepthIn: depth, sweIn: depth / 4, newSnowIn: null, qcFlag: "valid" });
    }
  }
  const record: StationRecord = {
    wteqByDay: new Map([[100, [5, 6, 7, 8, 9]]]),
    snwdByDay: new Map([[100, [20, 24, 28, 32, 36]]]),
    daily: deriveNewSnow(daily),
  };
  const out = computeStationNormals("531:CO:SNTL", record, 2027);
  assert.equal(out.rows.length, 366);
  assert.equal(out.monthly.length, 24);
  assert.equal(out.thirtyYears, 30);
  assert.equal(out.tenYears, 10);
  const d100 = out.rows[99];
  assert.equal(d100.day_of_water_year, 100);
  assert.equal(d100.median_swe, 7);
  assert.equal(d100.median_depth, 28);
  assert.equal(d100.p10_depth, 22, "interpolated 10th percentile of 20..36");
  assert.equal(d100.cum_snow_years, 30);
  assert.equal(d100.cum_snow_recent_years, 10);
  assert.ok((d100.cum_snow_mean_in ?? 0) > 40, `day-100 cumulative mean ${d100.cum_snow_mean_in}`);
  assert.equal(d100.cum_snow_mean_in, d100.cum_snow_recent_mean_in, "identical winters → identical baselines");
  assert.equal(out.rows[300].cum_snow_mean_in, null, "no band past June 30");
  assert.equal(out.rows[0].median_swe, null, "fewer than five WMO samples → null");
  const nov30 = out.monthly.find((m) => m.month === 11 && m.window === "30yr")!;
  assert.equal(nov30.years_tracked, 30);
  assert.equal(nov30.max_storm_in, 10);
  assert.equal(nov30.max_storm_start?.slice(5), "11-29");
  assert.equal(out.monthly.filter((m) => m.window === "10yr").length, 12);
});
