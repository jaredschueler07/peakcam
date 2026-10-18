import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatMountainTime,
  homeSentence,
  inches,
  latestUpdatedAt,
  pctOfNormalSentence,
  rankPctOfNormal,
  resortSentence,
  snowLeaders,
  sourceLabel,
  upcomingOpenings,
  type QuotableResort,
} from "./quotable";
import type { ResortOpening } from "./openings";
import type { SnowReport } from "./types";

// 2026-10-18 12:00 UTC = 6:00 a.m. MDT. Only the openings logic reads it.
const NOW = new Date("2026-10-18T12:00:00Z");

function makeSnow(overrides: Partial<SnowReport> = {}): SnowReport {
  return {
    id: "s1",
    resort_id: "r1",
    base_depth: 12,
    new_snow_24h: 1,
    new_snow_48h: 3,
    trails_open: null,
    trails_total: null,
    lifts_open: null,
    lifts_total: null,
    conditions: null,
    source: "snotel",
    updated_at: "2026-10-18T12:00:00Z",
    swe_in: 4,
    pct_of_normal: 85,
    trend_7d: null,
    outlook: null,
    auto_cond_rating: null,
    snowing_now: false,
    ...overrides,
  };
}

function makeResort(
  name: string,
  snow: Partial<SnowReport> | null,
  overrides: Partial<QuotableResort> = {},
): QuotableResort {
  const slug = name.toLowerCase().replace(/\s+/g, "-");
  const station = snow?.source === "open_meteo" || snow?.source === "pipeline" ? null : "415:CO:SNTL";
  return {
    id: `id-${slug}`,
    name,
    slug,
    snotel_station_id: station,
    snow_report: snow ? makeSnow({ resort_id: `id-${slug}`, ...snow }) : null,
    ...overrides,
  };
}

function makeOpening(resort_id: string, projected: string | null, confirmed: string | null = null): ResortOpening {
  return {
    id: `o-${resort_id}`,
    resort_id,
    season: "2026-27",
    projected_open: projected,
    confirmed_open: confirmed,
    closing_date: null,
    source_url: null,
    notes: null,
    updated_at: "2026-10-01T00:00:00Z",
  };
}

// ── Formatting ───────────────────────────────────────────────

test("formatMountainTime renders Mountain time with the zone named, independent of the machine zone", () => {
  assert.equal(formatMountainTime("2026-10-18T12:00:00Z"), "6:00 a.m. MT Oct 18");
  // 11:31 p.m. UTC is still the 18th in Denver (5:31 p.m. MDT).
  assert.equal(formatMountainTime("2026-10-18T23:31:07Z"), "5:31 p.m. MT Oct 18");
  // After the November fall-back the offset is -7 (MST); label stays "MT".
  assert.equal(formatMountainTime("2026-12-01T07:05:00Z"), "12:05 a.m. MT Dec 1");
  assert.equal(formatMountainTime("not a date"), "");
});

test("inches and sourceLabel", () => {
  assert.equal(inches(8), "8 in.");
  assert.equal(inches(0), "0 in.");
  assert.equal(inches(0.25), "0.3 in.");
  assert.equal(sourceLabel("snotel"), "SNOTEL");
  assert.equal(sourceLabel("open_meteo"), "model estimate");
  assert.equal(sourceLabel("pipeline"), "model estimate");
  assert.equal(sourceLabel("resort"), "resort-reported");
});

test("latestUpdatedAt picks the newest report and ignores nulls and junk", () => {
  assert.equal(
    latestUpdatedAt([
      { updated_at: "2026-10-18T10:29:06Z" },
      null,
      { updated_at: "2026-10-18T16:31:40Z" },
      { updated_at: "garbage" },
      { updated_at: "2026-10-17T16:31:40Z" },
    ]),
    "2026-10-18T16:31:40.000Z",
  );
  assert.equal(latestUpdatedAt([null, undefined]), null);
});

// ── Home: in season ──────────────────────────────────────────

test("home sentence in season: dated by the newest report, SNOTEL leader first, every number labelled", () => {
  const resorts = [
    makeResort("Lagunillas", { source: "open_meteo", new_snow_24h: 8, updated_at: "2026-10-18T13:28:42Z" }),
    makeResort("Breckenridge", { new_snow_24h: 1, updated_at: "2026-10-18T16:31:40Z" }),
    makeResort("Keystone", { new_snow_24h: 0, updated_at: "2026-10-18T16:34:20Z" }),
    makeResort("Portillo", { source: "open_meteo", new_snow_24h: 5, updated_at: "2026-10-18T13:29:01Z" }),
  ];
  const q = homeSentence(resorts, [], NOW);
  assert.equal(
    q.text,
    "As of 10:34 a.m. MT Oct 18, the most new snow in the last 24 h is 1 in. at Breckenridge (SNOTEL) and 8 in. at Lagunillas (model estimate).",
  );
  // The stamp is the newest report overall (Keystone's), not the render clock (6:00 a.m.).
  assert.equal(q.asOf, "2026-10-18T16:34:20.000Z");
  assert.equal(q.href, "/resorts/breckenridge");
  const links = q.segments.filter((s) => s.href).map((s) => [s.text, s.href]);
  assert.deepEqual(links, [
    ["Breckenridge", "/resorts/breckenridge"],
    ["Lagunillas", "/resorts/lagunillas"],
  ]);
  assert.equal(q.segments.map((s) => s.text).join(""), q.text);
});

test("snowLeaders: a larger modelled number never outranks a measured one; one source alone yields its top two", () => {
  const measuredAndModel = snowLeaders([
    makeResort("Model A", { source: "open_meteo", new_snow_24h: 12 }),
    makeResort("Station B", { new_snow_24h: 2 }),
    makeResort("Station C", { new_snow_24h: 4 }),
  ]);
  assert.deepEqual(measuredAndModel.map((r) => r.name), ["Station C", "Model A"]);

  const onlyStations = snowLeaders([
    makeResort("Station B", { new_snow_24h: 2 }),
    makeResort("Station C", { new_snow_24h: 4 }),
    makeResort("Station D", { new_snow_24h: 3 }),
  ]);
  assert.deepEqual(onlyStations.map((r) => r.name), ["Station C", "Station D"]);

  const onlyModels = snowLeaders([
    makeResort("Model A", { source: "open_meteo", new_snow_24h: 1 }),
    makeResort("Model B", { source: "pipeline", new_snow_24h: 1 }),
    makeResort("Model C", { source: "open_meteo", new_snow_24h: 7 }),
  ]);
  // Ties break alphabetically so the sentence is stable between syncs.
  assert.deepEqual(onlyModels.map((r) => r.name), ["Model C", "Model A"]);
});

test("home sentence with a single resort reporting snow names one resort, no dangling 'and'", () => {
  const q = homeSentence([makeResort("Ski Cooper", { new_snow_24h: 1 }), makeResort("Vail", { new_snow_24h: 0 })], [], NOW);
  assert.equal(q.text, "As of 6:00 a.m. MT Oct 18, the most new snow in the last 24 h is 1 in. at Ski Cooper (SNOTEL).");
});

// ── Home: off season ─────────────────────────────────────────

test("home sentence off season: honest zero count and the next three openings, linking /opening-dates", () => {
  const resorts = [
    makeResort("Arapahoe Basin", { new_snow_24h: 0, updated_at: "2026-10-18T16:31:40Z" }),
    makeResort("Keystone", { new_snow_24h: 0, updated_at: "2026-10-18T10:29:06Z" }),
    makeResort("Vail", { new_snow_24h: null }),
    makeResort("Loveland", { new_snow_24h: 0 }),
    makeResort("Copper", null),
  ];
  const openings = [
    makeOpening("id-keystone", "2026-10-31"),
    makeOpening("id-arapahoe-basin", null, "2026-10-24"),
    makeOpening("id-vail", "2026-11-13"),
    makeOpening("id-loveland", "2026-11-06"),
    // Already past: must not be listed as upcoming.
    makeOpening("id-copper", "2026-10-10"),
    // Unknown resort id: skipped, never named.
    makeOpening("id-ghost", "2026-10-20"),
  ];
  const q = homeSentence(resorts, openings, NOW);
  assert.equal(
    q.text,
    "As of 10:31 a.m. MT Oct 18, 0 of 4 resorts report new snow in the last 24 h. First openings: Arapahoe Basin (Oct 24), Keystone (Oct 31), Loveland (Nov 6).",
  );
  assert.equal(q.href, "/opening-dates");
  assert.equal(q.asOf, "2026-10-18T16:31:40.000Z");
});

test("upcomingOpenings counts today as upcoming on the US Pacific day, not the UTC one", () => {
  // 03:00 UTC on Oct 19 is still 8 p.m. Oct 18 in the Pacific zone.
  const lateEvening = new Date("2026-10-19T03:00:00Z");
  const resorts = [makeResort("Keystone", null)];
  const rows = upcomingOpenings([makeOpening("id-keystone", "2026-10-18")], resorts, lateEvening);
  assert.deepEqual(rows.map((r) => r.date), ["2026-10-18"]);
  assert.deepEqual(upcomingOpenings([makeOpening("id-keystone", "2026-10-18")], resorts, new Date("2026-10-19T12:00:00Z")), []);
});

test("home sentence with no reports at all carries no date and no count beyond zero", () => {
  const q = homeSentence([makeResort("Copper", null)], [], NOW);
  assert.equal(q.asOf, null);
  assert.equal(q.text, "0 of 0 resorts report new snow in the last 24 h.");
});

// ── Resort: SNOTEL ───────────────────────────────────────────

test("resort sentence for a SNOTEL resort with station details", () => {
  const q = resortSentence(makeResort("Breckenridge", { updated_at: "2026-10-18T12:00:00Z" }), NOW, {
    station: { name: "Hoosier Pass", elevationFt: 11400 },
  });
  assert.equal(
    q.text,
    "As of 6:00 a.m. MT Oct 18, the Breckenridge SNOTEL station (Hoosier Pass, 11,400 ft) reports 1 in. of new snow in 24 h, 3 in. in 48 h, base 12 in., snowpack 85% of normal.",
  );
  assert.equal(q.asOf, "2026-10-18T12:00:00.000Z");
  assert.equal(q.href, undefined);
});

test("resort sentence omits the station parenthetical when the station is unknown", () => {
  const q = resortSentence(makeResort("Breckenridge", {}), NOW);
  assert.match(q.text, /^As of 6:00 a\.m\. MT Oct 18, the Breckenridge SNOTEL station reports 1 in\. of new snow in 24 h/);
  assert.doesNotMatch(q.text, /\(/);
});

test("resort sentence drops null fields instead of printing them", () => {
  const q = resortSentence(makeResort("Breckenridge", { new_snow_48h: null, base_depth: null, pct_of_normal: null }), NOW);
  assert.equal(q.text, "As of 6:00 a.m. MT Oct 18, the Breckenridge SNOTEL station reports 1 in. of new snow in 24 h.");

  const only48 = resortSentence(makeResort("Breckenridge", { new_snow_24h: null, base_depth: null, pct_of_normal: null }), NOW);
  assert.equal(only48.text, "As of 6:00 a.m. MT Oct 18, the Breckenridge SNOTEL station reports 3 in. of new snow in 48 h.");

  const empty = resortSentence(
    makeResort("Breckenridge", { new_snow_24h: null, new_snow_48h: null, base_depth: null, pct_of_normal: null }),
    NOW,
  );
  assert.equal(empty.text, "As of 6:00 a.m. MT Oct 18, the Breckenridge SNOTEL station has no readings in its latest report.");
});

test("resort sentence suppresses percent-of-normal below 2 in. SWE, outside 10–300, and for model rows", () => {
  const lowSwe = resortSentence(makeResort("Ski Cooper", { swe_in: 0.2, pct_of_normal: 29 }), NOW);
  assert.doesNotMatch(lowSwe.text, /of normal/);
  const tooHigh = resortSentence(makeResort("Ski Cooper", { swe_in: 5, pct_of_normal: 900 }), NOW);
  assert.doesNotMatch(tooHigh.text, /of normal/);
  const tooLow = resortSentence(makeResort("Ski Cooper", { swe_in: 5, pct_of_normal: 9 }), NOW);
  assert.doesNotMatch(tooLow.text, /of normal/);
  const edge = resortSentence(makeResort("Ski Cooper", { swe_in: 2, pct_of_normal: 300 }), NOW);
  assert.match(edge.text, /snowpack 300% of normal/);
  const model = resortSentence(makeResort("Whistler", { source: "open_meteo", swe_in: 10, pct_of_normal: 120 }), NOW);
  assert.doesNotMatch(model.text, /of normal/);
});

// ── Resort: model / no report ────────────────────────────────

test("resort sentence for a model resort says so and never claims a station", () => {
  const q = resortSentence(
    makeResort("Lagunillas", {
      source: "open_meteo",
      new_snow_24h: 2,
      new_snow_48h: 2,
      base_depth: 76,
      updated_at: "2026-10-18T13:28:42Z",
    }),
    NOW,
  );
  assert.equal(
    q.text,
    "As of 7:28 a.m. MT Oct 18, a weather-model estimate for Lagunillas puts 2 in. of new snow in 24 h, 2 in. in 48 h, base 76 in.",
  );
  assert.doesNotMatch(q.text, /SNOTEL/);
});

test("resort sentence with no report names the opening date when one is ahead", () => {
  const projected = resortSentence(makeResort("Breckenridge", null), NOW, {
    opening: makeOpening("id-breckenridge", "2026-11-07"),
  });
  assert.equal(projected.text, "No snow report yet this season for Breckenridge; projected opening Nov 7.");
  assert.equal(projected.href, "/opening-dates");
  assert.equal(projected.asOf, null);

  const confirmed = resortSentence(makeResort("Mammoth", null), NOW, {
    opening: makeOpening("id-mammoth", null, "2026-11-13"),
  });
  assert.equal(confirmed.text, "No snow report yet this season for Mammoth; opening Nov 13.");

  const past = resortSentence(makeResort("Copper", null), NOW, { opening: makeOpening("id-copper", "2026-10-01") });
  assert.equal(past.text, "No snow report yet this season for Copper.");
  const none = resortSentence(makeResort("Copper", null), NOW);
  assert.equal(none.text, "No snow report yet this season for Copper.");
});

// ── Percent of normal (Sprint 9) ─────────────────────────────

test("rankPctOfNormal keeps only publishable station rows, deepest first", () => {
  const ranked = rankPctOfNormal([
    makeResort("Breckenridge", { swe_in: 6, pct_of_normal: 140 }),
    makeResort("Ski Cooper", { swe_in: 0.2, pct_of_normal: 900 }),
    makeResort("Vail", { swe_in: 3, pct_of_normal: 35 }),
    makeResort("Whistler", { source: "open_meteo", swe_in: 20, pct_of_normal: 200 }),
    makeResort("Keystone", { swe_in: 4, pct_of_normal: null }),
    makeResort("Aspen", null),
  ]);
  assert.deepEqual(ranked.map((r) => [r.name, r.pct]), [
    ["Breckenridge", 140],
    ["Vail", 35],
  ]);
});

test("pctOfNormalSentence: dated leaderboard sentence, and an honest line when nothing is publishable", () => {
  const q = pctOfNormalSentence(
    [
      makeResort("Breckenridge", { swe_in: 6, pct_of_normal: 140, updated_at: "2026-10-18T16:31:40Z" }),
      makeResort("Vail", { swe_in: 3, pct_of_normal: 35 }),
      makeResort("Ski Cooper", { swe_in: 0.2, pct_of_normal: 900 }),
      makeResort("Whistler", { source: "open_meteo", swe_in: 20, pct_of_normal: 200, updated_at: "2026-10-18T20:00:00Z" }),
    ],
    NOW,
  );
  assert.equal(
    q.text,
    "As of 10:31 a.m. MT Oct 18, 2 of 3 SNOTEL-fed resorts have enough snow to measure against normal; the deepest relative to its 1991–2020 median is Breckenridge at 140%, the thinnest Vail at 35%.",
  );
  assert.equal(q.href, "/resorts/breckenridge");

  const none = pctOfNormalSentence([makeResort("Ski Cooper", { swe_in: 0.2, pct_of_normal: 900 })], NOW);
  assert.equal(
    none.text,
    "As of 6:00 a.m. MT Oct 18, none of the 1 SNOTEL-fed resorts has the 2 in. of snow water equivalent needed to compare its snowpack with the 1991–2020 median.",
  );
});
