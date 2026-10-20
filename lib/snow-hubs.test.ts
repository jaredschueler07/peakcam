import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import type { ResortWithData, SnowReport } from "./types";
import { listHubs } from "./hubs";
import { RESERVED_SNOW_REPORT_SEGMENTS, buildSnowHub, measuredRow, rankByBase, snowHubDescription, snowHubMarkdown, snowHubSentence, snowHubTitle } from "./snow-hubs";

// Pure: hand-made resort rows, no Supabase. Hub resolution itself is covered
// by lib/hubs.test.ts; these tests cover the ranking, the dated sentence and
// the markdown over it.

const AT = "2026-12-20T13:00:00.000Z"; // 6:00 a.m. MST

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
  resort({ slug: "wolf-creek", name: "Wolf Creek", region: "San Juan Mountains", snotel_station_id: "874:CO:SNTL", snow_report: snow({ base_depth: 42, new_snow_24h: 3, pct_of_normal: 120 }) }),
  resort({ slug: "loveland", name: "Loveland", snow_report: snow({ base_depth: 12, new_snow_24h: 0, source: "open_meteo", updated_at: "2026-12-20T12:00:00.000Z" }) }),
  resort({ slug: "copper", name: "Copper Mountain", region: "Summit County", snow_report: snow({ base_depth: 12, new_snow_24h: 2 }) }),
  resort({ slug: "eldora", name: "Eldora" }),
  resort({ slug: "alta", name: "Alta Ski Area", state: "UT", region: "Little Cottonwood Canyon", snow_report: snow({ base_depth: 60 }) }),
];

test("rankByBase: deepest first, new snow breaks ties, no report last", () => {
  const ranked = rankByBase(ROWS.map(measuredRow)).map((r) => r.slug);
  assert.deepEqual(ranked, ["alta", "wolf-creek", "copper", "loveland", "eldora"]);
});

test("measuredRow keeps the source, station name and percent of normal only for SNOTEL rows", () => {
  const wolf = measuredRow(ROWS[0]);
  assert.equal(wolf.source, "snotel");
  assert.equal(wolf.stationId, "874:CO:SNTL");
  assert.equal(wolf.pctOfNormal, 120);
  const loveland = measuredRow(ROWS[1]);
  assert.equal(loveland.source, "open_meteo");
  assert.equal(loveland.stationId, null);
  assert.equal(measuredRow(ROWS[3]).source, null);
});

test("buildSnowHub resolves a state like /ski-cams and ranks its resorts", () => {
  const page = buildSnowHub("colorado", ROWS);
  assert.ok(page);
  assert.equal(page.hub.label, "Colorado");
  assert.equal(page.count, 4);
  assert.equal(page.reported, 3);
  assert.equal(page.asOf, AT);
  assert.equal(page.pageUrl, "https://www.peakcam.io/snow-report/colorado");
  assert.equal(page.markdownUrl, "https://www.peakcam.io/snow-report/colorado/index.md");
  assert.deepEqual(page.rows.map((r) => r.slug), ["wolf-creek", "copper", "loveland", "eldora"]);
  assert.equal(page.sentence.text, "As of 6:00 a.m. MT Dec 20, the deepest base in Colorado is Wolf Creek at base 42 in., 3 in. of new snow in 24 h (SNOTEL, Wolf Creek Summit), then Copper Mountain at base 12 in., 2 in. of new snow in 24 h (SNOTEL); 3 of 4 resorts have a report.");
  assert.equal(page.sentence.href, "/resorts/wolf-creek");
  assert.equal(buildSnowHub("nowhere", ROWS), null);
  assert.equal(buildSnowHub("deepest-base", ROWS), null);
});

test("the sentence says so when nothing is reported or nothing is on the ground", () => {
  const utah = { where: "in Utah", group: "Utah" };
  assert.equal(snowHubSentence([measuredRow(ROWS[3])], utah).text, "No snow reports yet this season for the 1 Utah resort PeakCam tracks.");
  const bare = measuredRow(resort({ slug: "x", name: "X", snow_report: snow({ base_depth: 0 }) }));
  assert.match(snowHubSentence([bare], utah).text, /none of the 1 Utah resorts with a report has snow on the ground/);
});

test("title, description and markdown carry the count and the leader", () => {
  const page = buildSnowHub("colorado", ROWS)!;
  assert.equal(snowHubTitle(page.hub, page.count), "Colorado Snow Report — 4 Resorts, Measured Base & New Snow | PeakCam");
  assert.match(snowHubDescription(page.hub, page), /Deepest base right now: Wolf Creek, 42 in\./);
  const md = snowHubMarkdown(page);
  assert.match(md, /^# Colorado snow report, 4 resorts/);
  assert.match(md, /\| 1 \| \[Wolf Creek\]\(https:\/\/www\.peakcam\.io\/resorts\/wolf-creek\) \| 42 in\. \| 3 in\. \| – \| 120% \| SNOTEL \(Wolf Creek Summit\)/);
  assert.match(md, /\| 4 \| \[Eldora\]\(.*\) \| – \| – \| – \| – \| no report yet \| – \| 0 \|/);
});

test("no hub slug in the catalogue shadows a static /snow-report child", () => {
  const rows = parse(readFileSync(join(__dirname, "..", "data", "resorts.csv"), "utf-8"), { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true }) as Array<{ slug: string; name: string; state: string; region: string }>;
  const { states, regions } = listHubs(rows);
  const slugs = [...states, ...regions].map((g) => g.hub.slug);
  for (const reserved of RESERVED_SNOW_REPORT_SEGMENTS) {
    assert.ok(!slugs.includes(reserved), `hub slug "${reserved}" collides with a static /snow-report page`);
  }
  assert.ok(slugs.includes("colorado"));
});
