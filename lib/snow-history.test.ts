import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_DAYS_PER_WINTER,
  SEASON_CURVE_DAYS,
  addDays,
  baselineNote,
  cumulativeByDay,
  cumulativeNormal,
  dayOfSeason,
  daysBetween,
  deepestBase,
  deriveNewSnow,
  ensoForWaterYear,
  groupBySeason,
  monthlyClimatology,
  percentile,
  previousSeason,
  qcSeries,
  qualifyingWinters,
  recentVsThirtyPct,
  seasonMonths,
  seasonOf,
  storms,
  weeklyCumulative,
  type DailyRow,
  type RawDay,
} from "./snow-history";

// ── Fixtures ─────────────────────────────────────────────────

function row(date: string, depth: number | null, newSnow: number | null = null): DailyRow {
  return { date, snowDepthIn: depth, sweIn: depth == null ? null : depth / 4, newSnowIn: newSnow, qcFlag: "valid" };
}

/**
 * A synthetic winter: depth climbs `perDay` in per day from Oct 1 through
 * day `days`, with a storm of `stormIn` on day 60 (Nov 29). `scale` lets the
 * normals tests build winters that differ.
 */
function winter(waterYear: number, opts: { days?: number; perDay?: number; stormIn?: number; scale?: number } = {}): DailyRow[] {
  const { days = 273, perDay = 0.5, stormIn = 10, scale = 1 } = opts;
  const start = `${waterYear - 1}-10-01`;
  const rows: DailyRow[] = [];
  let depth = 0;
  for (let d = 1; d <= days; d++) {
    const date = addDays(start, d - 1);
    const fall = (d === 60 ? stormIn : d % 3 === 0 ? perDay * 3 : 0) * scale;
    depth = d > 220 ? Math.max(0, depth - 2) : depth + fall;
    rows.push(row(date, Math.round(depth * 10) / 10));
  }
  return deriveNewSnow(rows);
}

// ── Dates and seasons ────────────────────────────────────────

test("seasonOf: Northern seasons are water years labelled 2026-27; Southern seasons start Apr 1", () => {
  assert.deepEqual(seasonOf("2026-10-18"), { key: 2027, label: "2026-27", startDate: "2026-10-01" });
  assert.deepEqual(seasonOf("2027-03-05"), { key: 2027, label: "2026-27", startDate: "2026-10-01" });
  assert.deepEqual(seasonOf("2026-09-30"), { key: 2026, label: "2025-26", startDate: "2025-10-01" });
  assert.deepEqual(seasonOf("2026-08-10", "south"), { key: 2026, label: "2026", startDate: "2026-04-01" });
  assert.deepEqual(seasonOf("2026-03-10", "south"), { key: 2025, label: "2025", startDate: "2025-04-01" });
});

test("dayOfSeason and previousSeason", () => {
  const season = seasonOf("2026-10-18");
  assert.equal(dayOfSeason("2026-10-01", season), 1);
  assert.equal(dayOfSeason("2026-10-18", season), 18);
  assert.equal(dayOfSeason("2027-01-01", season), 93);
  assert.equal(dayOfSeason("2027-06-30", season), SEASON_CURVE_DAYS);
  assert.deepEqual(previousSeason(season), seasonOf("2025-12-01"));
  assert.deepEqual(previousSeason(season, 10), { key: 2017, label: "2016-17", startDate: "2016-10-01" });
  assert.equal(daysBetween("2026-02-28", "2026-03-01"), 1);
  assert.equal(addDays("2027-02-28", 1), "2027-03-01");
  assert.deepEqual(seasonMonths().slice(0, 4), [10, 11, 12, 1]);
  assert.deepEqual(seasonMonths("south").slice(0, 3), [4, 5, 6]);
});

// ── Derivation ───────────────────────────────────────────────

test("deriveNewSnow: positive depth change on consecutive days, null across gaps or missing depth, existing values kept", () => {
  const out = deriveNewSnow([
    row("2026-11-01", 10),
    row("2026-11-02", 16),
    row("2026-11-03", 14),
    row("2026-11-05", 20),
    row("2026-11-06", null),
    row("2026-11-07", 22),
    row("2026-11-08", 30, 5),
  ]);
  assert.deepEqual(
    out.map((r) => r.newSnowIn),
    [null, 6, 0, null, null, null, 5],
  );
});

test("qcSeries: runs validateReading day by day, carries a silent day forward, derives new snow from QC'd depths and resets context across gaps", () => {
  const raw: RawDay[] = [
    { date: "2026-12-01", snowDepthIn: 20, sweIn: 5, precipAccumIn: 8, tempObsF: 20, tempMaxF: 25, tempMinF: 10 },
    { date: "2026-12-02", snowDepthIn: 26, sweIn: 6, precipAccumIn: 8.5, tempObsF: 20, tempMaxF: 25, tempMinF: 10 },
    // Spike: +60 in one day → previous depth is used, flagged suspect, no new snow
    { date: "2026-12-03", snowDepthIn: 86, sweIn: 6.2, precipAccumIn: 8.6, tempObsF: 20, tempMaxF: 25, tempMinF: 10 },
    // Silent day → carried forward, flagged missing, new snow null
    { date: "2026-12-04", snowDepthIn: null, sweIn: null, precipAccumIn: null, tempObsF: null, tempMaxF: null, tempMinF: null },
    { date: "2026-12-05", snowDepthIn: 30, sweIn: 7, precipAccumIn: 9, tempObsF: 20, tempMaxF: 25, tempMinF: 10 },
    // Gap of three days: not spike-checked against Dec 5, new snow null
    { date: "2026-12-09", snowDepthIn: 90, sweIn: 20, precipAccumIn: 12, tempObsF: 20, tempMaxF: 25, tempMinF: 10 },
    { date: "2026-12-10", snowDepthIn: 92, sweIn: 20.5, precipAccumIn: 12.2, tempObsF: 20, tempMaxF: 25, tempMinF: 10 },
  ];
  const out = qcSeries(raw);
  assert.deepEqual(out.map((r) => r.qcFlag), ["valid", "valid", "suspect", "missing", "valid", "valid", "valid"]);
  assert.deepEqual(out.map((r) => r.snowDepthIn), [20, 26, 26, 26, 30, 90, 92]);
  assert.deepEqual(out.map((r) => r.newSnowIn), [null, 6, 0, null, 4, null, 2]);
  assert.equal(out[3].precipAccumIn, 8.6);
});

// ── Grouping and curves ──────────────────────────────────────

test("groupBySeason splits rows at Oct 1 and sorts; cumulativeByDay adds only measured new snow", () => {
  const rows = [...winter(2026), ...winter(2027, { days: 30 })];
  const seasons = groupBySeason(rows);
  assert.deepEqual(seasons.map((s) => s.label), ["2025-26", "2026-27"]);
  assert.equal(seasons[1].rows.length, 30);
  const curve = cumulativeByDay(seasons[0]);
  assert.equal(curve.length, SEASON_CURVE_DAYS);
  assert.equal(curve[0], 0, "day 1 has no previous day, so nothing is counted");
  assert.ok(curve[59] >= 10, "the day-60 storm is in the curve");
  for (let i = 1; i < curve.length; i++) assert.ok(curve[i] >= curve[i - 1], "cumulative never falls");
  const weekly = weeklyCumulative(seasons[0]);
  assert.equal(weekly.length, 52);
  assert.equal(weekly[0], curve[6]);
  assert.equal(weekly[51], curve[SEASON_CURVE_DAYS - 1], "weeks past June 30 carry the final total");
});

test("storms merge consecutive snow days and rank by total; deepestBase returns the first day the max was reached", () => {
  const rows = deriveNewSnow([
    row("2026-12-01", 10),
    row("2026-12-02", 15),
    row("2026-12-03", 22),
    row("2026-12-04", 22.4),
    row("2026-12-05", 22),
    row("2026-12-06", 40),
    row("2026-12-07", 40),
  ]);
  const found = storms(rows);
  assert.deepEqual(found, [
    { start: "2026-12-06", end: "2026-12-06", days: 1, totalIn: 18 },
    { start: "2026-12-02", end: "2026-12-03", days: 2, totalIn: 12 },
  ]);
  assert.deepEqual(deepestBase(rows), { depthIn: 40, date: "2026-12-06" });
  assert.equal(deepestBase([row("2026-12-01", null)]), null);
});

// ── Normals ──────────────────────────────────────────────────

test("qualifyingWinters keeps complete winters with enough readings, most recent first-N, and excludes the current water year", () => {
  const seasons = groupBySeason([
    ...winter(2010),
    ...winter(2011, { days: 100 }), // too short
    ...winter(2012),
    ...winter(2013),
    ...winter(2027, { days: 20 }), // in progress
  ]);
  assert.deepEqual(qualifyingWinters(seasons, 30, 2027).map((s) => s.key), [2010, 2012, 2013]);
  assert.deepEqual(qualifyingWinters(seasons, 2, 2027).map((s) => s.key), [2012, 2013]);
  assert.ok(MIN_DAYS_PER_WINTER > 100);
});

test("cumulativeNormal: mean/p25/p75 by day across winters, 273 points, and the recent decade is the last ten", () => {
  const rows: DailyRow[] = [];
  for (let wy = 1995; wy <= 2026; wy++) rows.push(...winter(wy, { scale: wy >= 2017 ? 2 : 1 }));
  const seasons = groupBySeason(rows);
  const thirty = cumulativeNormal(seasons, "30yr", 2027);
  const ten = cumulativeNormal(seasons, "10yr", 2027);
  assert.equal(thirty.years, 30);
  assert.deepEqual([thirty.waterYears[0], thirty.waterYears.at(-1)], [1997, 2026]);
  assert.equal(ten.years, 10);
  assert.deepEqual(ten.waterYears, [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
  assert.equal(thirty.points.length, SEASON_CURVE_DAYS);
  const d100 = thirty.points[99];
  assert.equal(d100.dayOfWaterYear, 100);
  assert.ok(d100.p25In <= d100.meanIn && d100.meanIn <= d100.p75In);
  // The doubled recent winters pull the 10-year mean to exactly twice the single-scale curve.
  const single = cumulativeByDay(seasons.find((s) => s.key === 2000)!);
  assert.equal(ten.points[99].meanIn, Math.round(single[99] * 2 * 10) / 10);
  assert.equal(cumulativeNormal([], "30yr", 2027).points.length, 0);
});

test("percentile interpolates and the band is ordered", () => {
  assert.equal(percentile([1, 2, 3, 4], 50), 2.5);
  assert.equal(percentile([1, 2, 3, 4], 25), 1.75);
  assert.equal(percentile([], 50), null);
});

test("monthlyClimatology: averages per month over qualifying winters, storms by start month, years tracked", () => {
  const rows: DailyRow[] = [];
  for (let wy = 2017; wy <= 2026; wy++) rows.push(...winter(wy));
  const months = monthlyClimatology(groupBySeason(rows), "10yr", 2027);
  assert.equal(months.length, 12);
  const nov = months.find((m) => m.month === 11)!;
  assert.equal(nov.yearsTracked, 10);
  assert.equal(nov.maxStormIn, 10, "the Nov 29 storm");
  assert.equal(nov.maxStormStart?.slice(5), "11-29");
  assert.ok((nov.avgSnowfallIn ?? 0) > 10);
  assert.ok((nov.avgSnowDays ?? 0) >= 9);
  const aug = months.find((m) => m.month === 8)!;
  assert.equal(aug.yearsTracked, 0, "no readings in August");
  assert.equal(aug.avgSnowfallIn, null);
});

test("baselineNote only when the decade differs by more than 10 %", () => {
  assert.equal(recentVsThirtyPct(100, 92), 92);
  assert.equal(baselineNote(100, 92, "by this date"), null);
  assert.match(baselineNote(100, 80, "by this date") ?? "", /^The last ten winters averaged 80 in\. by this date, 20% below the 30-winter normal of 100 in\.; both are shown\.$/);
  assert.match(baselineNote(50, 60, "in January") ?? "", /20% above/);
  assert.equal(baselineNote(null, 60, "x"), null);
  assert.equal(baselineNote(0, 60, "x"), null);
});

test("ensoForWaterYear reads the NOAA DJF table", () => {
  assert.deepEqual(ensoForWaterYear(2016), { phase: "el-nino", oni: 2.5, label: "El Niño" });
  assert.deepEqual(ensoForWaterYear(2011), { phase: "la-nina", oni: -1.29, label: "La Niña" });
  assert.equal(ensoForWaterYear(2014)?.phase, "neutral");
  assert.equal(ensoForWaterYear(1950), null);
});
