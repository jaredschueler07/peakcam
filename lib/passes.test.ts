import { test } from "node:test";
import assert from "node:assert/strict";
import type { ResortWithData, SnowReport } from "./types";
import { SEASON_PASSES } from "./resort-profile";
import { PASS_INFO, buildPassPage, isSeasonPassSlug, passDescription, passMarkdown, passMarkdownPath, passPath, passTitle, resortsOnPass } from "./passes";

const AT = "2026-12-20T13:00:00.000Z";

function snow(over: Partial<SnowReport>): SnowReport {
  return {
    id: "s", resort_id: "r", base_depth: null, new_snow_24h: null, new_snow_48h: null, trails_open: null, trails_total: null,
    lifts_open: null, lifts_total: null, conditions: null, source: "snotel", updated_at: AT, swe_in: null, pct_of_normal: null,
    trend_7d: null, outlook: null, auto_cond_rating: null, snowing_now: false, ...over,
  };
}

function resort(over: Partial<ResortWithData> & { slug: string; name: string }): ResortWithData {
  return {
    id: over.slug, state: "CO", country: "US", region: "Front Range", lat: 39.6, lng: -105.9, website_url: null, cam_page_url: null,
    cond_rating: "fair", snotel_station_id: null, x_url: null, facebook_url: null, instagram_url: null, is_active: true, created_at: AT,
    snow_report: null, cams: [], ...over,
  } as ResortWithData;
}

const ROWS: ResortWithData[] = [
  resort({ slug: "alta", name: "Alta Ski Area", state: "UT", passes: ["ikon", "mountain-collective"], snotel_station_id: "766:UT:SNTL", snow_report: snow({ base_depth: 60, new_snow_24h: 8 }) }),
  resort({ slug: "copper", name: "Copper Mountain", passes: ["ikon"], snow_report: snow({ base_depth: 12 }) }),
  resort({ slug: "vail", name: "Vail", passes: ["epic"], snow_report: snow({ base_depth: 20 }) }),
  resort({ slug: "legacy", name: "Legacy Row" }), // no passes column at all
];

test("every pass has info, a path and a markdown path", () => {
  for (const pass of SEASON_PASSES) {
    assert.ok(PASS_INFO[pass].url.startsWith("https://"));
    assert.equal(passPath(pass), `/passes/${pass}`);
    assert.equal(passMarkdownPath(pass), `/passes/${pass}/index.md`);
    assert.ok(isSeasonPassSlug(pass));
  }
  assert.ok(!isSeasonPassSlug("gold"));
});

test("resortsOnPass reads the validated passes column and tolerates rows without it", () => {
  assert.deepEqual(resortsOnPass(ROWS, "ikon").map((r) => r.slug), ["alta", "copper"]);
  assert.deepEqual(resortsOnPass(ROWS, "epic").map((r) => r.slug), ["vail"]);
  assert.deepEqual(resortsOnPass(ROWS, "indy"), []);
});

test("buildPassPage ranks by base, counts places and dates the sentence to the data", () => {
  const page = buildPassPage("ikon", ROWS);
  assert.equal(page.count, 2);
  assert.equal(page.reported, 2);
  assert.deepEqual(page.places, ["Colorado", "Utah"]);
  assert.equal(page.asOf, AT);
  assert.deepEqual(page.rows.map((r) => r.slug), ["alta", "copper"]);
  assert.equal(page.pageUrl, "https://www.peakcam.io/passes/ikon");
  assert.match(page.sentence.text, /^As of 6:00 a\.m\. MT Dec 20, the deepest base among Ikon Pass resorts is Alta Ski Area at base 60 in\., 8 in\. of new snow in 24 h \(SNOTEL, Snowbird\)/);
  assert.equal(passTitle(page), "Ikon Pass Snow Report — 2 Resorts, Measured Base & Webcams | PeakCam");
  assert.match(passDescription(page), /2 Ikon Pass resorts PeakCam tracks across 2 states and provinces/);
  assert.match(passDescription(page), /Deepest base right now: Alta Ski Area, 60 in\./);
});

test("an empty pass still renders and says why", () => {
  const page = buildPassPage("indy", ROWS);
  assert.equal(page.count, 0);
  assert.equal(page.asOf, null);
  assert.match(page.sentence.text, /No snow reports yet this season for the 0 Indy Pass resorts PeakCam tracks/);
  assert.match(passMarkdown(page), /No resort on PeakCam currently names this pass/);
});

test("pass markdown lists the rows with state, source and the operator link", () => {
  const md = passMarkdown(buildPassPage("ikon", ROWS));
  assert.match(md, /^# Ikon Pass snow report, 2 resorts on PeakCam/);
  assert.match(md, /Pass operator: https:\/\/www\.ikonpass\.com/);
  assert.match(md, /\| 1 \| \[Alta Ski Area\]\(https:\/\/www\.peakcam\.io\/resorts\/alta\) \| Utah \| 60 in\. \| 8 in\. \| – \| SNOTEL \(Snowbird\)/);
});
