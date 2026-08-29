import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAboutParagraphs, buildResortFaq } from "./resort-copy";
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
