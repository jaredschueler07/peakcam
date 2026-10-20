import { test } from "node:test";
import assert from "node:assert/strict";
import type { ResortWithData, SnowReport } from "./types";
import { LEADERBOARD_COPY, LEADERBOARD_KINDS, buildLeaderboard, isLeaderboardKind, type SeasonAggregateRow } from "./leaderboards";
import { POWDER_DAY_IN } from "./season-stats";

// 2027-01-12 15:00 UTC = 8:00 a.m. MST.
const NOW = new Date("2027-01-12T15:00:00Z");

function report(over: Partial<SnowReport>): SnowReport {
  return {
    id: "s",
    resort_id: "r",
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
    ...over,
  } as SnowReport;
}

function resort(slug: string, name: string, over: Partial<ResortWithData> = {}): ResortWithData {
  return {
    id: `id-${slug}`,
    slug,
    name,
    state: "CO",
    country: "US",
    region: "Rockies",
    lat: 39.5,
    lng: -106,
    website_url: null,
    cam_page_url: null,
    cond_rating: "good",
    snotel_station_id: "842:CO:SNTL",
    x_url: null,
    facebook_url: null,
    instagram_url: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    snow_report: report({ resort_id: `id-${slug}` }),
    cams: [],
    ...over,
  } as ResortWithData;
}

function agg(resortId: string, over: Partial<SeasonAggregateRow> = {}): SeasonAggregateRow {
  return {
    resortId,
    stationId: "842:CO:SNTL",
    seasonTotalIn: 100,
    snowDays: 20,
    powderDays: 3,
    daysMeasured: 100,
    deepestBaseIn: 60,
    deepestBaseDate: "2027-01-10",
    weekTotalIn: 10,
    lastDate: "2027-01-12",
    latestDepthIn: 55,
    ...over,
  };
}

const RESORTS: ResortWithData[] = [
  resort("alta", "Alta", { state: "UT", snow_report: report({ base_depth: 120, new_snow_24h: 12 }) }),
  resort("breckenridge", "Breckenridge", { snow_report: report({ base_depth: 50 }) }),
  resort("vail", "Vail", { snow_report: report({ base_depth: 50 }) }),
  resort("portillo", "Ski Portillo", { state: "Chile", country: "CL", lat: -32.8, snotel_station_id: null, snow_report: report({ base_depth: 10, source: "open_meteo" }) }),
  resort("big-sky", "Big Sky", { state: "MT", snow_report: null }),
];

const AGGS: SeasonAggregateRow[] = [
  agg("id-alta", { seasonTotalIn: 210, powderDays: 9, weekTotalIn: 31 }),
  agg("id-breckenridge", { seasonTotalIn: 150, powderDays: 4, weekTotalIn: 28 }),
  agg("id-vail", { seasonTotalIn: 150, powderDays: 4, weekTotalIn: 0, lastDate: "2027-01-01" }),
  agg("id-portillo", { stationId: "open-meteo", seasonTotalIn: 5, powderDays: 0, weekTotalIn: 2 }),
];

test("kinds and copy", () => {
  assert.deepEqual([...LEADERBOARD_KINDS], ["best-powder-this-week", "season-powder-days", "deepest-base", "season-snowfall"]);
  assert.ok(isLeaderboardKind("deepest-base"));
  assert.ok(!isLeaderboardKind("deepest-bass"));
  for (const kind of LEADERBOARD_KINDS) {
    assert.ok(LEADERBOARD_COPY[kind].title.length > 10);
    assert.ok(LEADERBOARD_COPY[kind].rule.length > 40);
  }
  assert.match(LEADERBOARD_COPY["season-powder-days"].rule, new RegExp(`${POWDER_DAY_IN} in\\.`));
});

test("best-powder-this-week ranks the 7-day total, drops rows older than the window, keeps the Andes", () => {
  const board = buildLeaderboard("best-powder-this-week", RESORTS, AGGS, NOW);
  assert.equal(board.weekStart, "2027-01-06");
  assert.deepEqual(board.ranked.map((e) => [e.rank, e.slug, e.value, e.source]), [
    [1, "alta", 31, "snotel"],
    [2, "breckenridge", 28, "snotel"],
    [3, "portillo", 2, "open_meteo"],
  ]);
  assert.equal(board.totalMatching, 3, "vail's last row is before the window; big-sky has no rows");
  assert.equal(board.ranked[0].stationId, "842:CO:SNTL");
  assert.equal(board.ranked[2].stationId, null);
  assert.deepEqual(board.ranked[0].detail, { label: "base", value: "55 in." });
  assert.equal(board.sentence.text, "As of 11:00 a.m. MT Jan 12, the most new snow in the last 7 days is 31 in. at Alta (SNOTEL), then 28 in. at Breckenridge (SNOTEL).");
  assert.equal(board.sentence.href, "/resorts/alta");
  assert.equal(board.asOf, "2027-01-12T18:00:00.000Z");
  assert.equal(board.unavailable, false);
});

test("season boards are Northern-hemisphere only and tie-break by name", () => {
  const days = buildLeaderboard("season-powder-days", RESORTS, AGGS, NOW);
  assert.deepEqual(days.ranked.map((e) => [e.slug, e.value, e.unit]), [["alta", 9, "days"], ["breckenridge", 4, "days"], ["vail", 4, "days"]]);
  assert.ok(!days.ranked.some((e) => e.slug === "portillo"), "Andes are not on a season-bound board");
  assert.equal(days.pool, 4, "big-sky is in the pool but has no rows");
  assert.equal(days.season.label, "2026-27");
  assert.equal(days.sentence.text, "As of 11:00 a.m. MT Jan 12, the most powder days (8 in. or more in a day) since Oct 1 is 9 days at Alta (SNOTEL), then 4 days at Breckenridge (SNOTEL).");

  const snowfall = buildLeaderboard("season-snowfall", RESORTS, AGGS, NOW, { limit: 2 });
  assert.deepEqual(snowfall.ranked.map((e) => e.slug), ["alta", "breckenridge"]);
  assert.equal(snowfall.totalMatching, 3);
  assert.deepEqual(snowfall.ranked[0].detail, { label: "powder days", value: "9" });
});

test("deepest-base reads the catalogue's latest report and needs no aggregates", () => {
  const board = buildLeaderboard("deepest-base", RESORTS, null, NOW);
  assert.deepEqual(board.ranked.map((e) => [e.slug, e.value, e.source]), [["alta", 120, "snotel"], ["breckenridge", 50, "snotel"], ["vail", 50, "snotel"], ["portillo", 10, "open_meteo"]]);
  assert.equal(board.ranked[0].measuredAt, "2027-01-12T12:00:00.000Z");
  assert.deepEqual(board.ranked[0].detail, { label: "24 h", value: "12 in." });
  assert.equal(board.unavailable, false);
  assert.equal(board.sentence.text, "As of 5:00 a.m. MT Jan 12, the deepest base is 120 in. at Alta (SNOTEL), then 50 in. at Breckenridge (SNOTEL).");
});

test("filters: state and measured-only; an empty board says why", () => {
  const ut = buildLeaderboard("season-snowfall", RESORTS, AGGS, NOW, { state: "ut" });
  assert.deepEqual(ut.ranked.map((e) => e.slug), ["alta"]);
  const measured = buildLeaderboard("best-powder-this-week", RESORTS, AGGS, NOW, { source: "snotel" });
  assert.ok(!measured.ranked.some((e) => e.source !== "snotel"));
  const none = buildLeaderboard("season-snowfall", RESORTS, AGGS.map((a) => ({ ...a, seasonTotalIn: 0 })), NOW);
  assert.equal(none.ranked.length, 3, "zero is a measurement, still listed; the Andes and the resort with no rows are not");
  assert.match(none.sentence.text, /none of the 4 Northern-hemisphere resorts has recorded snow since Oct 1\.$/);
});

test("without the season_stats function the season boards are empty and say so", () => {
  const board = buildLeaderboard("season-snowfall", RESORTS, null, NOW);
  assert.equal(board.unavailable, true);
  assert.equal(board.ranked.length, 0);
  assert.match(board.sentence.text, /not available right now/);
});
