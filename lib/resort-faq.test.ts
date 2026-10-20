import { test } from "node:test";
import assert from "node:assert/strict";
import type { Cam, ResortWithData, SnowReport } from "./types";
import type { ResortOpening } from "./openings";
import { buildResortFaqPage, faqPageLd, waterYearDayLabel, MAX_FAQ_ITEMS } from "./resort-faq";

// Fixture: a SNOTEL-fed Utah resort with every profile column filled, in
// season, so the full question set can be asserted; the "missing data" tests
// strip fields from it.

const NOW = new Date("2026-12-20T15:00:00Z"); // 8:00 a.m. MST, in season
const AT = "2026-12-20T12:00:00.000Z";

function cam(over: Partial<Cam> = {}): Cam {
  return {
    id: "cam-1",
    resort_id: "r1",
    name: "Collins",
    elevation: "9,000 ft",
    embed_type: "youtube",
    embed_url: null,
    youtube_id: "abc",
    is_active: true,
    consecutive_failures: 0,
    auto_disabled: false,
    last_checked_at: AT,
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function snow(over: Partial<SnowReport> = {}): SnowReport {
  return {
    id: "s1",
    resort_id: "r1",
    base_depth: 42,
    new_snow_24h: 6,
    new_snow_48h: 11,
    trails_open: null,
    trails_total: null,
    lifts_open: null,
    lifts_total: null,
    conditions: "powder,fresh||Expect clear skies today.",
    source: "snotel",
    updated_at: AT,
    swe_in: 9.5,
    pct_of_normal: 118,
    trend_7d: "rising",
    outlook: "more_snow",
    auto_cond_rating: "great",
    snowing_now: false,
    ...over,
  };
}

function resort(over: Partial<ResortWithData> = {}): ResortWithData {
  return {
    id: "r1",
    name: "Alta Ski Area",
    slug: "alta",
    state: "UT",
    country: "US",
    region: "Wasatch Range",
    lat: 40.5884,
    lng: -111.6386,
    website_url: "https://www.alta.com",
    cam_page_url: null,
    cond_rating: "great",
    snotel_station_id: "366:UT:SNTL",
    x_url: null,
    facebook_url: null,
    instagram_url: null,
    is_active: true,
    created_at: "2025-01-01T00:00:00Z",
    runs_total: 119,
    lifts_total: 5,
    skiable_acres: 2614,
    vertical_ft: 2538,
    annual_snowfall_in: 543,
    longest_run_mi: 3.5,
    passes: ["ikon", "mountain-collective"],
    wikidata_id: "Q2840279",
    snow_report: snow(),
    cams: [cam()],
    ...over,
  };
}

const OPENING: ResortOpening = {
  id: "o1",
  resort_id: "r1",
  season: "2026-27",
  projected_open: null,
  confirmed_open: "2026-11-20",
  closing_date: null,
  source_url: "https://www.alta.com",
  notes: null,
  updated_at: AT,
};

const EXTRAS = {
  elevation: { baseFt: 8530, summitFt: 11068 },
  opening: OPENING,
  normals: { peakMedianDepthIn: 98, peakDayOfWaterYear: 180 },
  station: { name: "Alta", elevationFt: 8730 },
};

const LEAK = /\{|\}|\bnull\b|\bundefined\b|\bNaN\b|\[object/;

test("a fully described resort gets every identity question plus the operational ones, no template leaks", () => {
  const faq = buildResortFaqPage(resort(), NOW, EXTRAS);
  const questions = faq.map((f) => f.question);
  assert.deepEqual(questions.slice(0, 7), [
    "Where is Alta Ski Area?",
    "How high is Alta Ski Area?",
    "How big is Alta Ski Area?",
    "When does Alta Ski Area open for the 2026–27 season?",
    "How much snow does Alta Ski Area get in a typical season?",
    "Which ski pass covers Alta Ski Area?",
    "What is the base depth at Alta Ski Area today?",
  ]);
  assert.ok(faq.length >= 5 && faq.length <= MAX_FAQ_ITEMS, `got ${faq.length}`);
  for (const item of faq) {
    assert.ok(item.question.length > 0 && item.answer.length > 0);
    assert.doesNotMatch(item.question, LEAK, item.question);
    assert.doesNotMatch(item.answer, LEAK, item.answer);
  }
  const by = Object.fromEntries(faq.map((f) => [f.question, f.answer]));
  assert.equal(by["Where is Alta Ski Area?"], "Alta Ski Area is a ski resort in the Wasatch Range, Utah. Coordinates: 40.59° N, 111.64° W.");
  assert.equal(by["How high is Alta Ski Area?"], "Alta Ski Area runs from a base at 8,530 ft to a summit at 11,068 ft, a vertical drop of 2,538 ft.");
  assert.equal(
    by["How big is Alta Ski Area?"],
    "Alta Ski Area has 2,614 acres of skiable terrain, 119 named runs and 5 lifts, as published by the resort. The longest run is 3.5 mi.",
  );
  assert.equal(
    by["When does Alta Ski Area open for the 2026–27 season?"],
    "Alta Ski Area opened for the 2026–27 season on Friday, November 20, 2026, a date the resort announced.",
  );
  assert.match(by["How much snow does Alta Ski Area get in a typical season?"], /average of 543 in of snowfall a season \(resort-published figure\)/);
  assert.match(by["How much snow does Alta Ski Area get in a typical season?"], /Alta NRCS station \(8,730 ft\), the 1991–2020 median snow depth peaks at 98 inches around Mar 29/);
  assert.match(by["Which ski pass covers Alta Ski Area?"], /^Alta Ski Area is on the Ikon Pass and Mountain Collective passes/);
  assert.equal(
    by["What is the base depth at Alta Ski Area today?"],
    "As of 5:00 a.m. MT Dec 20, the SNOTEL sensor at the Alta station (8,730 ft) measures a 42 inches base at Alta Ski Area. 6 inches of new snow fell in the last 24 hours. Snow water equivalent is 118% of the station's 1991–2020 median for today's date.",
  );
  // The operational questions from lib/resort-copy.ts follow, minus the
  // superseded "right now" one.
  assert.ok(questions.includes("Does Alta Ski Area have live webcams?"));
  assert.ok(questions.includes("Where does Alta Ski Area's snow data come from?"));
  assert.ok(!questions.some((q) => /have right now\?$/.test(q)));
});

test("missing data drops a question instead of emitting a placeholder", () => {
  const bare = resort({
    runs_total: null,
    lifts_total: null,
    skiable_acres: null,
    vertical_ft: null,
    annual_snowfall_in: null,
    longest_run_mi: null,
    passes: [],
    snow_report: snow({ base_depth: null }),
  });
  const faq = buildResortFaqPage(bare, NOW, { elevation: { baseFt: null, summitFt: null }, opening: null, normals: null, station: null });
  const questions = faq.map((f) => f.question);
  assert.deepEqual(
    questions.filter((q) => /^(How high|How big|When does|How much snow does .* typical|Which ski pass|What is the base depth)/.test(q)),
    [],
  );
  assert.ok(questions.includes("Where is Alta Ski Area?"));
  for (const item of faq) assert.doesNotMatch(item.answer, LEAK, item.answer);
  // Still a usable block: location, webcams, conditions, provenance.
  assert.ok(faq.length >= 3, `got ${faq.length}`);
});

test("partial profiles answer with what exists: summit only, projected opening, model-estimated base", () => {
  const partial = resort({
    runs_total: null,
    lifts_total: 12,
    skiable_acres: null,
    vertical_ft: null,
    annual_snowfall_in: null,
    longest_run_mi: null,
    snotel_station_id: null,
    passes: ["indy"],
    snow_report: snow({ source: "open_meteo", pct_of_normal: null, swe_in: null }),
  });
  const faq = buildResortFaqPage(partial, NOW, {
    elevation: { baseFt: null, summitFt: 11068 },
    opening: { ...OPENING, confirmed_open: null, projected_open: "2026-12-28" },
    normals: null,
    station: null,
  });
  const by = Object.fromEntries(faq.map((f) => [f.question, f.answer]));
  assert.equal(by["How high is Alta Ski Area?"], "Alta Ski Area's summit is at 11,068 ft.");
  assert.equal(by["How big is Alta Ski Area?"], "Alta Ski Area has 12 lifts, as published by the resort.");
  assert.match(by["When does Alta Ski Area open for the 2026–27 season?"], /^Alta Ski Area is projected to open for the 2026–27 season around Monday, December 28, 2026\. That is a projection/);
  assert.match(by["Which ski pass covers Alta Ski Area?"], /^Alta Ski Area is on the Indy Pass, per the pass's published resort lists/);
  assert.equal(
    by["What is the base depth at Alta Ski Area today?"],
    "As of 5:00 a.m. MT Dec 20, the latest report for Alta Ski Area puts the base at 42 inches (model estimate). 6 inches of new snow fell in the last 24 hours.",
  );
  assert.ok(!("How much snow does Alta Ski Area get in a typical season?" in by));
});

test("a Southern-hemisphere row with only a closing date asks about the season, not an opening", () => {
  const andes = resort({ name: "Portillo", slug: "ski-portillo", state: "Chile", country: "CL", region: "Central Andes", lat: -32.8, lng: -70.1, snotel_station_id: null, snow_report: null, passes: [] });
  const faq = buildResortFaqPage(andes, new Date("2026-10-18T12:00:00Z"), {
    elevation: { baseFt: 9350, summitFt: 10860 },
    opening: { ...OPENING, season: "2026", confirmed_open: null, closing_date: "2026-09-27" },
  });
  const by = Object.fromEntries(faq.map((f) => [f.question, f.answer]));
  assert.equal(by["When is the 2026 season at Portillo?"], "Portillo's 2026 season closed on Sunday, September 27, 2026. The next season's dates are listed once the resort announces them.");
  assert.equal(by["Where is Portillo?"], "Portillo is a ski resort in the Central Andes, Chile. Coordinates: 32.80° S, 70.10° W.");
  assert.ok(!("What is the base depth at Portillo today?" in by));
});

test("faqPageLd mirrors the list exactly and is null for an empty list", () => {
  const faq = buildResortFaqPage(resort(), NOW, EXTRAS);
  const ld = faqPageLd(faq) as { "@type": string; mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }> };
  assert.equal(ld["@type"], "FAQPage");
  assert.equal(ld.mainEntity.length, faq.length);
  assert.equal(ld.mainEntity[0].name, faq[0].question);
  assert.equal(ld.mainEntity[0].acceptedAnswer.text, faq[0].answer);
  assert.equal(faqPageLd([]), null);
});

test("waterYearDayLabel counts from Oct 1", () => {
  assert.equal(waterYearDayLabel(1), "Oct 1");
  assert.equal(waterYearDayLabel(93), "Jan 1");
  assert.equal(waterYearDayLabel(180), "Mar 29");
});
