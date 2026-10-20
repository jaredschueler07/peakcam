import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, deriveNewSnow, type CumulativeNormalRow, type DailyRow } from "./snow-history";
import {
  PAST_SEASONS,
  POWDER_DAY_IN,
  formatDayLabel,
  pastSeasons,
  seasonCurve,
  seasonSentence,
  seasonToDate,
  trendFor,
} from "./season-stats";

function row(date: string, depth: number | null): DailyRow {
  return { date, snowDepthIn: depth, sweIn: null, newSnowIn: null, qcFlag: "valid" };
}

/** Depth path for a winter from a list of daily new-snow amounts starting Oct 1. */
function winterFrom(waterYear: number, falls: number[]): DailyRow[] {
  let depth = 0;
  const rows: DailyRow[] = [];
  falls.forEach((f, i) => {
    depth += f;
    rows.push(row(addDays(`${waterYear - 1}-10-01`, i), depth));
  });
  return deriveNewSnow(rows);
}

function normals(meanPerDay: number, recentPerDay: number): CumulativeNormalRow[] {
  return Array.from({ length: 273 }, (_, i) => ({
    dayOfWaterYear: i + 1,
    meanIn: Math.round(meanPerDay * (i + 1) * 10) / 10,
    p25In: Math.round(meanPerDay * (i + 1) * 0.8 * 10) / 10,
    p75In: Math.round(meanPerDay * (i + 1) * 1.2 * 10) / 10,
    years: 30,
    recentMeanIn: Math.round(recentPerDay * (i + 1) * 10) / 10,
    recentYears: 10,
  }));
}

// This season: 20 days from Oct 1 2026, a 9 in powder day on Oct 10 and 3 in on Oct 15.
const THIS = winterFrom(2027, [0, 0, 0, 2, 0, 0, 0, 0, 0, 9, 0, 0, 0, 0, 3, 0, 0, 0, 0, 1]);
// Last season: 30 days, 4 in on Oct 5, 10 in on Oct 12, 8 in on Oct 20.
const LAST = winterFrom(2026, [0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 10, 0, 0, 0, 0, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

test("POWDER_DAY_IN is the alert threshold and the only copy of the number", () => {
  assert.equal(POWDER_DAY_IN, 8);
});

test("seasonToDate: totals, powder days, deepest base, percent of normal on both baselines, last-year comparison", () => {
  const stats = seasonToDate([...LAST, ...THIS], normals(0.5, 0.4), "2026-10-20");
  assert.equal(stats.season.label, "2026-27");
  assert.equal(stats.dayOfSeason, 20);
  assert.equal(stats.lastMeasuredDate, "2026-10-20");
  assert.equal(stats.seasonToDateIn, 15);
  assert.equal(stats.daysMeasured, 20);
  assert.equal(stats.snowDays, 4);
  assert.equal(stats.powderDays, 1);
  assert.equal(stats.powderDayThresholdIn, POWDER_DAY_IN);
  assert.equal(stats.currentBaseIn, 15);
  assert.deepEqual(stats.deepestBase, { depthIn: 15, date: "2026-10-20" });
  assert.equal(stats.percentOfNormal.normalToDateIn, 10);
  assert.equal(stats.percentOfNormal.thirtyYear, 150);
  assert.equal(stats.percentOfNormal.recentNormalToDateIn, 8);
  assert.equal(stats.percentOfNormal.recentDecade, 188);
  assert.match(stats.percentOfNormal.baselineNote ?? "", /20% below the 30-winter normal of 10 in\./);
  assert.ok(stats.lastYear);
  assert.equal(stats.lastYear.season.label, "2025-26");
  assert.equal(stats.lastYear.seasonToDateIn, 22, "4 + 10 + 8 by day 20 last year");
  assert.equal(stats.lastYear.baseOnSameDayIn, 22);
  assert.equal(stats.lastYear.powderDays, 2);
  assert.equal(stats.lastYear.diffIn, -7);
  assert.equal(stats.lastYear.pctOfLastYear, 68);
});

test("seasonToDate before any row this season: zero, dated null, normals still answered, no last-year block without rows", () => {
  const stats = seasonToDate([], normals(0.5, 0.5), "2026-10-05");
  assert.equal(stats.seasonToDateIn, 0);
  assert.equal(stats.lastMeasuredDate, null);
  assert.equal(stats.currentBaseIn, null);
  assert.equal(stats.percentOfNormal.thirtyYear, 0);
  assert.equal(stats.percentOfNormal.baselineNote, null);
  assert.equal(stats.lastYear, null);
  assert.equal(stats.trend.direction, "steady");
});

test("seasonToDate ignores rows after `today` and answers null percents without normals", () => {
  const stats = seasonToDate(THIS, [], "2026-10-12");
  assert.equal(stats.seasonToDateIn, 11);
  assert.equal(stats.lastMeasuredDate, "2026-10-12");
  assert.equal(stats.percentOfNormal.thirtyYear, null);
  assert.equal(stats.percentOfNormal.recentDecade, null);
});

test("trendFor compares the last seven days with the seven before", () => {
  assert.deepEqual(trendFor(THIS, "2026-10-20"), { last7In: 4, prior7In: 9, direction: "falling" });
  assert.equal(trendFor(THIS, "2026-10-13").direction, "rising");
  assert.equal(trendFor(THIS, "2026-10-03").direction, "steady");
});

test("pastSeasons: the ten seasons before the current one, newest first, seasons without rows omitted, ENSO attached", () => {
  const rows = [...winterFrom(2017, [0, 5, 0, 9, 0, 0, 0, 0]), ...LAST, ...THIS];
  const past = pastSeasons(rows, normals(0.5, 0.5), { key: 2027, label: "2026-27", startDate: "2026-10-01" });
  assert.equal(PAST_SEASONS, 10);
  assert.deepEqual(past.map((p) => p.season.label), ["2025-26", "2016-17"]);
  const last = past[0];
  assert.equal(last.totalIn, 22);
  assert.equal(last.snowDays, 3);
  assert.equal(last.powderDays, 2);
  assert.equal(last.daysMeasured, 30);
  assert.deepEqual(last.maxStorm, { totalIn: 10, start: "2025-10-12", end: "2025-10-12", days: 1 });
  assert.deepEqual(last.deepestBase, { depthIn: 22, date: "2025-10-20" });
  assert.equal(last.weeklyCumulativeIn.length, 52);
  assert.equal(last.weeklyCumulativeIn[0], 4);
  assert.equal(last.weeklyCumulativeIn[2], 22);
  assert.equal(last.percentOfNormal, Math.round((22 / 136.5) * 100));
  assert.deepEqual(last.enso, { phase: "neutral", oni: -0.39, label: "Neutral" });
  assert.equal(past[1].enso?.phase, "neutral");
});

test("seasonCurve: one point per day through today, depth attached, band from the normals", () => {
  const curve = seasonCurve(THIS, normals(0.5, 0.4), "2026-10-20");
  assert.equal(curve.points.length, 20);
  assert.deepEqual(curve.points[9], { dayOfSeason: 10, date: "2026-10-10", cumulativeIn: 11, snowDepthIn: 11 });
  assert.equal(curve.points[19].cumulativeIn, 15);
  assert.equal(curve.band.length, 273);
  assert.deepEqual(curve.band[0], { dayOfSeason: 1, meanIn: 0.5, p25In: 0.4, p75In: 0.6, recentMeanIn: 0.4 });
  assert.equal(curve.normalYears, 30);
  assert.equal(seasonCurve([], [], "2026-10-03").points.length, 3);
});

test("seasonSentence is dated by the newest reading and drops what it does not know", () => {
  const stats = seasonToDate([...LAST, ...THIS], normals(0.5, 0.4), "2026-10-20");
  const s = seasonSentence(stats, { name: "Breckenridge", slug: "breckenridge" }, { kind: "snotel", stationName: "Hoosier Pass" });
  assert.equal(
    s.text,
    "Through Oct 20, the Breckenridge SNOTEL station (Hoosier Pass) has measured 15 in. of snow since Oct 1, 150% of the 30-winter normal to date, 1 powder day (8 in. or more); a year ago it had 22 in.",
  );
  assert.equal(s.asOfDay, "2026-10-20");
  assert.equal(s.segments.find((x) => x.href)?.href, "/resorts/breckenridge");

  const model = seasonSentence(seasonToDate(THIS, [], "2026-10-20"), { name: "Portillo", slug: "ski-portillo" }, { kind: "model" });
  assert.equal(model.text, "Through Oct 20, a weather-model estimate for Portillo puts 15 in. of snow since Oct 1, 1 powder day (8 in. or more).");

  const empty = seasonSentence(seasonToDate([], [], "2026-10-05"), { name: "Alta", slug: "alta" }, { kind: "snotel" });
  assert.match(empty.text, /^No daily measurements yet this season for Alta; the season curve starts with the first reading after Oct 1\.$/);
  assert.equal(empty.asOfDay, null);
  assert.equal(formatDayLabel("2025-10-20", 2026), "Oct 20, 2025");
});
