import { test } from "node:test";
import assert from "node:assert/strict";
import type { ResortWithData, SnowReport } from "@/lib/types";
import { addDays, deriveNewSnow, type CumulativeNormalRow, type DailyRow, type MonthlyNormalRow } from "@/lib/snow-history";
import { POWDER_DAY_IN } from "@/lib/season-stats";
import { LeaderboardSchema, MonthlyClimatologySchema, ResortHistorySchema, SeasonStatsSchema } from "./schema";
import { buildLeaderboardDocument, buildMonthlyClimatology, buildResortHistory, buildSeasonStats, mountainDay } from "./history";
import type { ResortHistoryData } from "./data";

// 2027-01-12 15:00 UTC = 08:00 MST → Mountain day 2027-01-12, day 104 of the water year.
const NOW = new Date("2027-01-12T15:00:00Z");

function report(over: Partial<SnowReport> = {}): SnowReport {
  return {
    id: "s",
    resort_id: "id-breckenridge",
    base_depth: 40,
    new_snow_24h: 3,
    new_snow_48h: 5,
    trails_open: null,
    trails_total: null,
    lifts_open: null,
    lifts_total: null,
    conditions: null,
    source: "snotel",
    updated_at: "2027-01-12T12:00:00Z",
    swe_in: 10,
    pct_of_normal: 100,
    trend_7d: null,
    outlook: null,
    auto_cond_rating: null,
    snowing_now: false,
    ...over,
  };
}

const BRECK: ResortWithData = {
  id: "id-breckenridge",
  slug: "breckenridge",
  name: "Breckenridge",
  state: "CO",
  country: "US",
  region: "Rockies",
  lat: 39.48,
  lng: -106.07,
  website_url: null,
  cam_page_url: null,
  cond_rating: "good",
  snotel_station_id: "1041:CO:SNTL",
  x_url: null,
  facebook_url: null,
  instagram_url: null,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  snow_report: report(),
  cams: [],
};

const PORTILLO: ResortWithData = { ...BRECK, id: "id-portillo", slug: "ski-portillo", name: "Ski Portillo", state: "Chile", country: "CL", lat: -32.8, snotel_station_id: null, snow_report: report({ source: "open_meteo" }) };

function winter(waterYear: number, days: number, perDay = 1): DailyRow[] {
  let depth = 0;
  const rows: DailyRow[] = [];
  for (let d = 1; d <= days; d++) {
    depth += d % 3 === 0 ? perDay * 3 : 0;
    if (d === 60) depth += 10;
    rows.push({ date: addDays(`${waterYear - 1}-10-01`, d - 1), snowDepthIn: depth, sweIn: depth / 4, newSnowIn: null, qcFlag: "valid" });
  }
  return deriveNewSnow(rows);
}

const NORMALS: CumulativeNormalRow[] = Array.from({ length: 273 }, (_, i) => ({ dayOfWaterYear: i + 1, meanIn: i + 1, p25In: (i + 1) * 0.8, p75In: (i + 1) * 1.2, years: 30, recentMeanIn: (i + 1) * 0.85, recentYears: 10 }));

const MONTHLY: MonthlyNormalRow[] = [10, 11, 12, 1, 2, 3, 4].flatMap((month) => [
  { month, window: "30yr" as const, avgSnowfallIn: 30, avgSnowDays: 8, avgDepthIn: 40, maxStormIn: 24, maxStormStart: "2019-12-25", maxStormEnd: "2019-12-27", yearsTracked: 30 },
  { month, window: "10yr" as const, avgSnowfallIn: month === 1 ? 20 : 31, avgSnowDays: 7, avgDepthIn: 38, maxStormIn: 18, maxStormStart: "2024-01-05", maxStormEnd: "2024-01-05", yearsTracked: 10 },
]);

const DATA: ResortHistoryData = {
  rows: [...winter(2017, 273), ...winter(2026, 273, 2), ...winter(2027, 104)],
  normals: NORMALS,
  monthly: MONTHLY,
};

test("mountainDay is the Mountain-time calendar day", () => {
  assert.equal(mountainDay(NOW), "2027-01-12");
  assert.equal(mountainDay(new Date("2027-01-13T05:30:00Z")), "2027-01-12");
});

test("buildResortHistory parses against ResortHistory and carries the curve, band and ten past seasons", () => {
  const doc = buildResortHistory(BRECK, DATA, { now: NOW });
  assert.doesNotThrow(() => ResortHistorySchema.parse(doc));
  assert.equal(doc.pageUrl, "https://www.peakcam.io/resorts/breckenridge/history");
  assert.equal(doc.apiUrl, "https://www.peakcam.io/api/v1/resorts/breckenridge/history");
  assert.equal(doc.source, "snotel");
  assert.equal(doc.station?.id, "1041:CO:SNTL");
  assert.equal(doc.station?.name, "Beaver Ck Village");
  assert.equal(doc.season.label, "2026-27");
  assert.equal(doc.asOf, "2027-01-12");
  assert.equal(doc.powderDayThresholdIn, POWDER_DAY_IN);
  assert.equal(doc.curve.points.length, 104);
  assert.equal(doc.curve.band.length, 273);
  assert.equal(doc.curve.normalYears, 30);
  assert.deepEqual(doc.pastSeasons.map((p) => p.season.label), ["2025-26", "2016-17"]);
  assert.equal(doc.pastSeasons[0].weeklyCumulativeIn.length, 52);
  assert.equal(doc.pastSeasons[0].enso?.phase, "neutral");
  assert.ok(doc.pastSeasons[0].totalIn > doc.pastSeasons[1].totalIn);
});

test("buildSeasonStats parses, computes both baselines and the quotable sentence", () => {
  const doc = buildSeasonStats(BRECK, DATA, { now: NOW });
  assert.doesNotThrow(() => SeasonStatsSchema.parse(doc));
  assert.equal(doc.dayOfSeason, 104);
  assert.equal(doc.asOf, "2027-01-12");
  assert.ok(doc.seasonToDateIn > 100);
  assert.equal(doc.percentOfNormal.normalToDateIn, 104);
  assert.equal(doc.percentOfNormal.thirtyYear, Math.round((doc.seasonToDateIn / 104) * 100));
  assert.equal(doc.percentOfNormal.recentDecade, Math.round((doc.seasonToDateIn / 88.4) * 100));
  assert.match(doc.percentOfNormal.baselineNote ?? "", /15% below/);
  assert.equal(doc.powderDays, 1);
  assert.ok(doc.lastYear && doc.lastYear.seasonToDateIn > doc.seasonToDateIn);
  assert.match(doc.sentence, /^Through Jan 12, the Breckenridge SNOTEL station \(Beaver Ck Village\) has measured \d+ in\. of snow since Oct 1, \d+% of the 30-winter normal to date, 1 powder day \(8 in\. or more\); a year ago it had \d+ in\.$/);
});

test("buildMonthlyClimatology parses, orders months from October and notes the January baseline gap", () => {
  const doc = buildMonthlyClimatology(BRECK, DATA, { now: NOW });
  assert.doesNotThrow(() => MonthlyClimatologySchema.parse(doc));
  assert.equal(doc.available, true);
  assert.deepEqual(doc.months.map((m) => m.month), [10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const jan = doc.months.find((m) => m.month === 1)!;
  assert.equal(jan.label, "Jan");
  assert.equal(jan.thirtyYear.avgSnowfallIn, 30);
  assert.equal(jan.recentDecade.avgSnowfallIn, 20);
  assert.equal(jan.recentVsThirtyPct, 67);
  assert.match(jan.baselineNote ?? "", /33% below the 30-winter normal of 30 in\./);
  const dec = doc.months.find((m) => m.month === 12)!;
  assert.equal(dec.baselineNote, null);
  const may = doc.months.find((m) => m.month === 5)!;
  assert.equal(may.thirtyYear.yearsTracked, 0);
  assert.match(doc.note, /Beaver Ck Village/);
});

test("a model-fed resort gets a curve without a band, no monthly climatology, and a model sentence", () => {
  const data: ResortHistoryData = { rows: winter(2027, 104), normals: [], monthly: [] };
  const history = buildResortHistory(PORTILLO, data, { now: NOW });
  assert.equal(history.source, "open_meteo");
  assert.equal(history.station, null);
  assert.equal(history.hemisphere, "south");
  assert.equal(history.season.label, "2026", "Southern seasons start Apr 1 and are labelled by year");
  assert.equal(history.curve.band.length, 0);
  const monthly = buildMonthlyClimatology(PORTILLO, data, { now: NOW });
  assert.equal(monthly.available, false);
  assert.equal(monthly.months.length, 0);
  assert.match(monthly.note, /weather-model/);
  const stats = buildSeasonStats(PORTILLO, data, { now: NOW });
  assert.equal(stats.percentOfNormal.thirtyYear, null);
  assert.match(stats.sentence, /a weather-model estimate for Ski Portillo puts/);
});

test("buildLeaderboardDocument parses against Leaderboard with station names resolved", () => {
  const { doc } = buildLeaderboardDocument(
    "season-snowfall",
    [BRECK, PORTILLO],
    [{ resortId: BRECK.id, stationId: "1041:CO:SNTL", seasonTotalIn: 120, snowDays: 20, powderDays: 3, daysMeasured: 100, deepestBaseIn: 60, deepestBaseDate: "2027-01-10", weekTotalIn: 10, lastDate: "2027-01-12", latestDepthIn: 55 }],
    NOW,
    { state: "CO" },
  );
  assert.doesNotThrow(() => LeaderboardSchema.parse(doc));
  assert.equal(doc.kind, "season-snowfall");
  assert.equal(doc.count, 1);
  assert.equal(doc.results[0].station?.name, "Beaver Ck Village");
  assert.equal(doc.results[0].canonicalUrl, "https://www.peakcam.io/resorts/breckenridge");
  assert.equal(doc.pageUrl, "https://www.peakcam.io/snow-report/season-snowfall");
  assert.deepEqual(doc.filters, { state: "CO", source: null });
  assert.match(doc.sentence, /the most snow since Oct 1 is 120 in\. at Breckenridge \(SNOTEL\)\.$/);
});
