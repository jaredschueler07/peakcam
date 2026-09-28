import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAboutParagraphs,
  buildResortFaq,
  buildResortMetaDescription,
  buildResortSchemaDescription,
} from "./resort-copy";
import type { ResortWithData, SnowReport, Cam } from "./types";

const WINTER = new Date("2026-01-15T12:00:00Z");
const SUMMER = new Date("2026-07-15T12:00:00Z");

function makeResort(overrides: Partial<ResortWithData> = {}): ResortWithData {
  return {
    id: "r1",
    name: "Testline Peak",
    slug: "testline-peak",
    state: "CO",
    country: "US",
    region: "Rockies",
    lat: 39.6,
    lng: -106.4,
    website_url: null,
    cam_page_url: null,
    cond_rating: "good",
    snotel_station_id: "1234:CO:SNTL",
    x_url: null,
    facebook_url: null,
    instagram_url: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    snow_report: makeSnow(),
    cams: [makeCam("c1"), makeCam("c2")],
    ...overrides,
  } as ResortWithData;
}

function makeSnow(overrides: Partial<SnowReport> = {}): SnowReport {
  return {
    id: "s1",
    resort_id: "r1",
    base_depth: 62,
    new_snow_24h: 7,
    new_snow_48h: 11,
    trails_open: 120,
    trails_total: 150,
    lifts_open: 20,
    lifts_total: 24,
    conditions: "powder,fresh||Deep refills overnight with wind-sheltered stashes holding.",
    source: "snotel",
    updated_at: "2026-01-15T06:00:00Z",
    swe_in: 14.2,
    pct_of_normal: 112,
    trend_7d: "rising",
    outlook: "more_snow",
    auto_cond_rating: "great",
    snowing_now: false,
    ...overrides,
  } as SnowReport;
}

function makeCam(id: string, is_active = true): Cam {
  return {
    id,
    resort_id: "r1",
    name: `Cam ${id}`,
    elevation: null,
    embed_type: "youtube",
    embed_url: null,
    youtube_id: "abc",
    is_active,
    consecutive_failures: 0,
    auto_disabled: false,
    last_checked_at: null,
    created_at: "2026-01-01T00:00:00Z",
  } as Cam;
}

test("about paragraphs carry the live numbers", () => {
  const [p1, p2] = buildAboutParagraphs(makeResort(), WINTER);
  assert.match(p1, /Testline Peak is a ski resort in the Rockies, Colorado\./);
  assert.match(p1, /2 webcams/);
  assert.match(p1, /NRCS station/);
  assert.match(p2, /62 inches/);
  assert.match(p2, /112% of this station's 1991–2020 median/);
  assert.match(p2, /7 inches of new snow/);
  assert.match(p2, /Resort-reported: 120 of 150 trails open/);
});

test("region phrasing: 'the' for ranges, dedupe when region names the state", () => {
  const vail = makeResort({ region: "Colorado Rockies", state: "CO" });
  assert.match(buildAboutParagraphs(vail, WINTER)[0], /in the Colorado Rockies\./);
  const pc = makeResort({ region: "Wasatch Range", state: "UT" });
  assert.match(buildAboutParagraphs(pc, WINTER)[0], /in the Wasatch Range, Utah\./);
  const heavenly = makeResort({ region: "Lake Tahoe", state: "CA" });
  assert.match(buildAboutParagraphs(heavenly, WINTER)[0], /in Lake Tahoe, California\./);
});

test("no-station resorts get model wording, never SNOTEL claims", () => {
  const resort = makeResort({ snotel_station_id: null, state: "Chile", country: "CL", region: "Central Andes" });
  const [p1] = buildAboutParagraphs(resort, WINTER);
  assert.match(p1, /is a ski resort in the Central Andes, Chile\./);
  assert.doesNotMatch(p1, /Chile, Chile/);
  assert.match(p1, /weather-model estimates/);
  assert.doesNotMatch(p1, /NRCS/);
  const faq = buildResortFaq(resort, WINTER);
  const provenance = faq[faq.length - 1];
  assert.match(provenance.answer, /Open-Meteo/);
  assert.doesNotMatch(provenance.answer, /NRCS station assigned/);
});

test("1-inch values do not read '1 inches'", () => {
  const resort = makeResort({ snow_report: makeSnow({ base_depth: 1, new_snow_24h: 1 }) });
  const all = buildAboutParagraphs(resort, WINTER).join(" ");
  assert.doesNotMatch(all, /1 inches/);
  assert.match(all, /1 inch/);
});

test("extreme percent-of-normal is suppressed", () => {
  const resort = makeResort({ snow_report: makeSnow({ pct_of_normal: 400 }) });
  const all = buildAboutParagraphs(resort, WINTER).join(" ");
  assert.doesNotMatch(all, /400%/);
});

test("tag-only conditions string never becomes a FAQ answer", () => {
  const resort = makeResort({ snow_report: makeSnow({ conditions: "powder,fresh" }) });
  const faq = buildResortFaq(resort, WINTER);
  assert.equal(faq.find((f) => f.question.includes("conditions")), undefined);
});

test("missing data drops sentences instead of padding", () => {
  const resort = makeResort({
    cams: [],
    snow_report: makeSnow({
      base_depth: null,
      new_snow_24h: null,
      trend_7d: null,
      trails_open: null,
      trails_total: null,
    }),
  });
  const paragraphs = buildAboutParagraphs(resort, WINTER);
  const all = paragraphs.join(" ");
  assert.doesNotMatch(all, /webcam/);
  assert.doesNotMatch(all, /base depth/);
  assert.doesNotMatch(all, /trails/);
});

test("off-season replaces snow claims with the off-season note", () => {
  const paragraphs = buildAboutParagraphs(makeResort(), SUMMER);
  assert.match(paragraphs.join(" "), /off-season/);
  assert.doesNotMatch(paragraphs.join(" "), /base depth is/);
  assert.doesNotMatch(paragraphs.join(" "), /no skiable snow/);
});

test("faq: winter with full data yields the five core questions", () => {
  const faq = buildResortFaq(makeResort(), WINTER);
  const questions = faq.map((f) => f.question);
  assert.equal(faq.length, 5);
  assert.match(questions[0], /How much snow/);
  assert.match(faq[0].answer, /62 inches/);
  assert.match(faq[0].answer, /NRCS station/);
  assert.match(questions[1], /live webcams/);
  assert.match(faq[1].answer, /2 webcams/);
  assert.match(faq[1].answer, /live video/);
  assert.match(questions[2], /conditions/);
  assert.equal(faq[2].answer, "Deep refills overnight with wind-sheltered stashes holding.");
  assert.match(questions[3], /lifts/);
  assert.match(faq[3].answer, /Resort-reported: 20 of 24 lifts and 120 of 150 trails are open/);
  assert.match(questions[4], /snow data come from/);
});

test("faq: inactive cams are not counted", () => {
  const resort = makeResort({ cams: [makeCam("c1"), makeCam("c2", false)] });
  const faq = buildResortFaq(resort, WINTER);
  const camAnswer = faq.find((f) => f.question.includes("webcams"))!.answer;
  assert.match(camAnswer, /1 webcam\b/);
});

test("faq: off-season answers honestly about no skiable snow", () => {
  const faq = buildResortFaq(makeResort(), SUMMER);
  assert.match(faq[0].answer, /off-season/);
  // A late-season base >= 20" is surfaced honestly instead of denied.
  assert.match(faq[0].answer, /62 inch/);
});

test("faq answers are self-contained (name the resort, no dangling pronoun openers)", () => {
  const faq = buildResortFaq(makeResort(), WINTER);
  for (const f of faq) {
    assert.doesNotMatch(f.answer, /^(It|They|This|That)\b/);
  }
});

test("meta description: off-season swaps dead numbers for the coming season", () => {
  const desc = buildResortMetaDescription(makeResort(), SUMMER);
  assert.equal(
    desc,
    "Testline Peak live webcams and snow report. Rockies, Colorado. Opens 2026–27 — first snow and forecasts on PeakCam.",
  );
  assert.doesNotMatch(desc, /62″|base,/);
  // No cams: no webcam claim.
  const noCams = buildResortMetaDescription(makeResort({ cams: [] }), SUMMER);
  assert.match(noCams, /^Testline Peak snow report and ski conditions\. Rockies, Colorado\. Opens/);
  assert.doesNotMatch(noCams, /webcam|\(0/);
});

test("meta description: off-season copy fits a 160-char SERP snippet for the longest catalogue name", () => {
  // The longest name in data/resorts.csv with its real region/state; WINTER is
  // the Andes off-season, so this exercises the off-season branch.
  const osorno = makeResort({
    name: "Volcán Osorno (Centro de Ski y Montaña Volcán Osorno)",
    lat: -41.1278,
    state: "Chile",
    country: "CL",
    region: "Lake District",
    snotel_station_id: null,
  });
  for (const resort of [osorno, makeResort({ ...osorno, cams: [] })]) {
    const desc = buildResortMetaDescription(resort, WINTER);
    assert.match(desc, /^Volcán Osorno \(Centro de Ski y Montaña Volcán Osorno\) /);
    assert.match(desc, /Lake District, Chile\. Opens 2026 — first snow and forecasts on PeakCam\.$/);
    assert.ok(desc.length <= 160, `${desc.length} chars: ${desc}`);
  }
  // Longest northern name + place combination in the catalogue (two-year season label).
  const fortyNine = makeResort({ name: "49 Degrees North Mountain Resort", state: "WA", region: "Selkirk Mountains" });
  const northern = buildResortMetaDescription(fortyNine, SUMMER);
  assert.match(northern, /Selkirk Mountains, Washington\. Opens 2026–27 —/);
  assert.ok(northern.length <= 160, `${northern.length} chars: ${northern}`);
});

test("meta description: off-season omits a missing region and dedupes region/state", () => {
  const noRegion = makeResort({ region: null as unknown as string });
  assert.match(buildResortMetaDescription(noRegion, SUMMER), /snow report\. Colorado\. Opens/);
  const vail = makeResort({ region: "Colorado Rockies" });
  assert.match(buildResortMetaDescription(vail, SUMMER), /snow report\. Colorado Rockies\. Opens/);
});

test("meta description: southern-hemisphere off-season names a single-year season", () => {
  const andes = makeResort({ lat: -33.3, state: "Chile", country: "CL", region: "Central Andes", snotel_station_id: null });
  assert.match(buildResortMetaDescription(andes, WINTER), /Central Andes, Chile\. Opens 2026 — first snow/);
  assert.match(
    buildResortMetaDescription(andes, new Date("2026-11-15T12:00:00Z")),
    /Opens 2027 —/,
  );
});

test("meta description: in season leads with the numbers, one period, full state name", () => {
  const resort = makeResort({
    snow_report: makeSnow({ conditions: "bluebird||Expect clear bluebird skies today.." }),
  });
  const desc = buildResortMetaDescription(resort, WINTER);
  assert.equal(
    desc,
    "Testline Peak live cams — 62″ base, Expect clear bluebird skies today. 2 webcams available. Real-time snow report for Colorado.",
  );
  assert.doesNotMatch(desc, /\.\./);
  assert.doesNotMatch(desc, /\bCO\b/);
});

test("meta description: in season drops a missing base and tag-only conditions; singular cam", () => {
  const resort = makeResort({
    cams: [makeCam("c1")],
    snow_report: makeSnow({ base_depth: null, conditions: "powder,fresh" }),
  });
  assert.equal(
    buildResortMetaDescription(resort, WINTER),
    "Testline Peak live cams and snow report. 1 webcam available. Real-time snow report for Colorado.",
  );
});

test("meta description: no snow report falls back without a state code", () => {
  assert.equal(
    buildResortMetaDescription(makeResort({ snow_report: null }), WINTER),
    "Live webcams and real-time snow conditions at Testline Peak, Colorado. Check base depth, trail status, and powder reports.",
  );
});

test("meta description: Andes rows in season name the country once", () => {
  const andes = makeResort({ lat: -33.3, state: "Chile", country: "CL", region: "Central Andes" });
  const desc = buildResortMetaDescription(andes, SUMMER);
  assert.match(desc, /Real-time snow report for Chile\.$/);
  assert.doesNotMatch(desc, /Chile, Chile/);
});

test("schema description uses the narrative half of conditions with one period", () => {
  const resort = makeResort({
    snow_report: makeSnow({ conditions: "bluebird||Expect clear bluebird skies today.." }),
  });
  assert.equal(
    buildResortSchemaDescription(resort),
    "Testline Peak — 62″ base depth, Expect clear bluebird skies today. 2 live webcams available.",
  );
  const tagOnly = buildResortSchemaDescription(
    makeResort({ snow_report: makeSnow({ conditions: "powder,fresh" }) }),
  );
  assert.doesNotMatch(tagOnly, /\|\||powder,fresh/);
  assert.equal(tagOnly, "Testline Peak — 62″ base depth. 2 live webcams available.");
  assert.equal(
    buildResortSchemaDescription(makeResort({ snow_report: null })),
    "Live webcams and snow conditions at Testline Peak, Colorado.",
  );
});
