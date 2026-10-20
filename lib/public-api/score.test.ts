import { test } from "node:test";
import assert from "node:assert/strict";
import type { Cam, ResortScoreRow, ResortWithData, SnowReport } from "@/lib/types";
import { ResortLightSchema, ResortSchema, ResortScoreHistorySchema, ResortScoreSchema, SnowReportListSchema } from "./schema";
import { rankPowder, serializeResort, serializeResortLight, serializeResortList, serializeScore } from "./serialize";
import { buildScoreDocument, rankByScore, scoreLeaders, serializeSnowReportList } from "./score";
import { resortMarkdown } from "./markdown-page";

const NOW = new Date("2026-12-20T18:00:00Z");

function report(over: Partial<SnowReport> = {}): SnowReport {
  return {
    id: "r1", resort_id: "id-alta", base_depth: 60, new_snow_24h: 12, new_snow_48h: 20, trails_open: null, trails_total: null, lifts_open: null, lifts_total: null,
    conditions: "Powder Day||Expect fresh powder today.", source: "snotel", updated_at: "2026-12-20T12:00:00Z", swe_in: 14, pct_of_normal: 118, trend_7d: "rising", outlook: "more_snow", auto_cond_rating: "great", snowing_now: false,
    ...over,
  };
}

function cam(over: Partial<Cam> = {}): Cam {
  return { id: "cam-1", resort_id: "id-alta", name: "Summit", elevation: null, embed_type: "image", embed_url: "https://example.com/cam.jpg", youtube_id: null, is_active: true, auto_disabled: false, consecutive_failures: 0, last_checked_at: "2026-12-20T17:00:00Z", created_at: "2026-01-01T00:00:00Z", ...over } as Cam;
}

function resort(over: Partial<ResortWithData> = {}): ResortWithData {
  return {
    id: "id-alta", name: "Alta", slug: "alta", state: "UT", region: "Wasatch", country: "US", lat: 40.59, lng: -111.64, snotel_station_id: "1308:UT:SNTL", cond_rating: "great", is_active: true, website_url: null,
    snow_report: report(), cams: [cam()],
    ...over,
  } as ResortWithData;
}

const COMPONENTS = {
  depthVsNormal: { points: 26.9, max: 30, basis: "snowpack 118% of the station's 1991–2020 median for today (SNOTEL), base 60 in.", source: "snotel" },
  recentSnow7d: { points: 20, max: 25, basis: "16 in. of new snow in the last 7 days (SNOTEL)", source: "snotel" },
  forecast7d: { points: 10, max: 20, basis: "6 in. forecast over the next 7 days (median of 7 models, Open-Meteo)", source: "model" },
  snowQuality: { points: 15, max: 15, basis: "snow within the last day, 3-day high 24°F (SNOTEL)", source: "derived" },
  operatingStatus: { points: 10, max: 10, basis: "open (operator feed or confirmed date)", source: "operator" },
};

const ROW: ResortScoreRow = { resort_id: "id-alta", date: "2026-12-20", score: 82, rating: "great", components: COMPONENTS, scored_by: "algorithmic" };
const HISTORY: ResortScoreRow[] = [
  { ...ROW, date: "2026-12-19", score: 76 },
  { ...ROW, date: "2026-12-18", score: 70, rating: "good" },
  ROW,
];

test("serializeScore: parses, recomputes a missing rating from the ladder, carries the dated tagline and the version", () => {
  const doc = ResortScoreSchema.parse(serializeScore(resort(), ROW));
  assert.equal(doc.score, 82);
  assert.equal(doc.rating, "great");
  assert.equal(doc.scoredBy, "algorithmic");
  assert.equal(doc.version, "score-v1");
  assert.match(doc.tagline, /^As of Dec 20, Alta's PeakCam Snow Score is 82 of 100 \(great\): snow quality 15 of 15, operating status 10 of 10, depth vs normal 26\.9 of 30, /);
  assert.equal(doc.components.forecast7d.source, "model");
  const unrated = ResortScoreSchema.parse(serializeScore(resort(), { ...ROW, score: "61" as unknown as number, rating: null }));
  assert.equal(unrated.score, 61);
  assert.equal(unrated.rating, "good");
});

test("score on the resort document: present and null when the index is served, absent when it is not", () => {
  const served = ResortSchema.parse(serializeResort(resort(), { now: NOW, score: ROW }));
  assert.equal(served.score?.score, 82);
  const none = ResortSchema.parse(serializeResort(resort(), { now: NOW, score: null }));
  assert.equal(none.score, null);
  assert.ok("score" in none);
  const off = ResortSchema.parse(serializeResort(resort(), { now: NOW }));
  assert.ok(!("score" in off));
  // The index form keys by resort id.
  const viaIndex = ResortSchema.parse(serializeResort(resort(), { now: NOW, scores: { "id-alta": ROW } }));
  assert.equal(viaIndex.score?.score, 82);
  const viaEmptyIndex = ResortSchema.parse(serializeResort(resort(), { now: NOW, scores: {} }));
  assert.equal(viaEmptyIndex.score, null);
  // The single row wins over the index.
  assert.equal(ResortSchema.parse(serializeResort(resort(), { now: NOW, score: null, scores: { "id-alta": ROW } })).score, null);
});

test("light rows and powder entries carry the light score; the list sorts by score on request", () => {
  const light = ResortLightSchema.parse(serializeResortLight(resort(), { now: NOW, score: ROW }));
  assert.deepEqual(light.score, { date: "2026-12-20", score: 82, rating: "great" });
  assert.ok(!("score" in serializeResortLight(resort(), { now: NOW })));

  const resorts = [
    resort(),
    resort({ id: "id-vail", slug: "vail", name: "Vail", state: "CO", snow_report: report({ resort_id: "id-vail", new_snow_24h: 6 }) }),
    resort({ id: "id-brighton", slug: "brighton", name: "Brighton", snow_report: report({ resort_id: "id-brighton", new_snow_24h: 3 }) }),
  ];
  const scores = { "id-alta": ROW, "id-brighton": { ...ROW, resort_id: "id-brighton", score: 90 } };
  const list = serializeResortList(resorts, { now: NOW, scores, sort: "score" });
  assert.deepEqual(list.resorts.map((r) => r.slug), ["brighton", "alta", "vail"], "unscored rows last");
  assert.deepEqual(serializeResortList(resorts, { now: NOW, scores }).resorts.map((r) => r.slug), ["alta", "brighton", "vail"], "default stays alphabetical");

  const powder = rankPowder(resorts, {}, { now: NOW, scores });
  assert.deepEqual(powder.results.map((r) => [r.slug, r.score?.score ?? null]), [["alta", 82], ["vail", null], ["brighton", 90]]);
  assert.ok(!("score" in rankPowder(resorts, {}, { now: NOW }).results[0]));
});

test("buildScoreDocument: today plus the history oldest first; available false without rows", () => {
  const doc = ResortScoreHistorySchema.parse(buildScoreDocument(resort(), { today: ROW, history: HISTORY }, { now: NOW }));
  assert.equal(doc.available, true);
  assert.equal(doc.today?.score, 82);
  assert.deepEqual(doc.history.map((h) => [h.date, h.score, h.rating]), [["2026-12-18", 70, "good"], ["2026-12-19", 76, "great"], ["2026-12-20", 82, "great"]]);
  assert.equal(doc.days, 30);
  assert.equal(doc.apiUrl, "https://www.peakcam.io/api/v1/resorts/alta/score-components");
  assert.equal(doc.pageUrl, "https://www.peakcam.io/resorts/alta#snow-score");
  assert.equal(doc.methodologyUrl, "https://www.peakcam.io/methodology#score");
  assert.equal(doc.sentence, doc.today?.tagline);
  assert.equal(doc.generatedAt, NOW.toISOString());

  const empty = ResortScoreHistorySchema.parse(buildScoreDocument(resort(), { today: null, history: [] }, { now: NOW }));
  assert.equal(empty.available, false);
  assert.equal(empty.today, null);
  assert.match(empty.sentence, /No Snow Score for this resort yet/);
  // History present but today's row too old: the history still shows, today is null.
  const stale = buildScoreDocument(resort(), { today: null, history: HISTORY.slice(0, 2) }, { now: NOW, baseUrl: "http://localhost:3000" });
  assert.equal(stale.available, true);
  assert.equal(stale.today, null);
  assert.equal(stale.pageUrl, "http://localhost:3000/resorts/alta#snow-score");
  // A table that could not be read is "not available", not "no rows".
  assert.equal(buildScoreDocument(resort(), { today: null, history: null }, { now: NOW }).available, false);
});

test("rankByScore and scoreLeaders rank highest first, ties by name, and skip unscored resorts", () => {
  const resorts = [resort(), resort({ id: "id-vail", slug: "vail", name: "Vail" }), resort({ id: "id-brighton", slug: "brighton", name: "Brighton" }), resort({ id: "id-snowbird", slug: "snowbird", name: "Snowbird" })];
  const scores = { "id-alta": ROW, "id-brighton": { ...ROW, resort_id: "id-brighton", score: 82 }, "id-snowbird": { ...ROW, resort_id: "id-snowbird", score: 90, date: "2026-12-19" } };
  assert.deepEqual(rankByScore(resorts, scores).map((x) => x.resort.slug), ["snowbird", "alta", "brighton"]);
  assert.deepEqual(scoreLeaders(resorts, scores, 2), [
    { name: "Snowbird", slug: "snowbird", score: 90, date: "2026-12-19" },
    { name: "Alta", slug: "alta", score: 82, date: "2026-12-20" },
  ]);
  assert.deepEqual(rankByScore(resorts, null), []);
  assert.deepEqual(scoreLeaders(resorts, undefined), []);
});

test("snow-report list: sort by score, new snow or base, a state filter, and a dated sentence over the rows kept", () => {
  const resorts = [
    resort(),
    resort({ id: "id-vail", slug: "vail", name: "Vail", state: "CO", snow_report: report({ resort_id: "id-vail", new_snow_24h: 6, base_depth: 70 }) }),
    resort({ id: "id-brighton", slug: "brighton", name: "Brighton", snow_report: report({ resort_id: "id-brighton", new_snow_24h: 3, base_depth: 50 }) }),
    resort({ id: "id-nowhere", slug: "nowhere", name: "Nowhere", state: "CO", snow_report: null }),
  ];
  const scores = { "id-alta": ROW, "id-brighton": { ...ROW, resort_id: "id-brighton", score: 90, date: "2026-12-19" }, "id-vail": { ...ROW, resort_id: "id-vail", score: 40, rating: "fair" as const } };

  const byScore = SnowReportListSchema.parse(serializeSnowReportList(resorts, { sort: "score" }, { now: NOW, scores }));
  assert.deepEqual(byScore.resorts.map((r) => r.slug), ["brighton", "alta", "vail", "nowhere"]);
  assert.equal(byScore.sort, "score");
  assert.equal(byScore.state, null);
  assert.equal(byScore.scoredAsOf, "2026-12-20");
  assert.equal(byScore.sentence, "As of Dec 20, the best PeakCam Snow Scores are Brighton (90 of 100), Alta (82) and Vail (40).");

  const bySnow = serializeSnowReportList(resorts, { sort: "newSnow24h" }, { now: NOW, scores });
  assert.deepEqual(bySnow.resorts.map((r) => r.slug), ["alta", "vail", "brighton", "nowhere"]);
  const byBase = serializeSnowReportList(resorts, { sort: "baseDepth" }, { now: NOW, scores });
  assert.deepEqual(byBase.resorts.map((r) => r.slug), ["vail", "alta", "brighton", "nowhere"]);
  assert.deepEqual(serializeSnowReportList(resorts, {}, { now: NOW, scores }).resorts.map((r) => r.slug), ["alta", "brighton", "nowhere", "vail"]);

  const colorado = serializeSnowReportList(resorts, { sort: "score", state: "co" }, { now: NOW, scores });
  assert.deepEqual(colorado.resorts.map((r) => r.slug), ["vail", "nowhere"]);
  assert.equal(colorado.state, "co");
  assert.equal(colorado.sentence, "As of Dec 20, the best PeakCam Snow Score is Vail (40 of 100).");

  const unscored = serializeSnowReportList(resorts, { sort: "score" }, { now: NOW, scores: {} });
  assert.equal(unscored.scoredAsOf, null);
  assert.match(unscored.sentence, /No PeakCam Snow Scores yet/);
  assert.deepEqual(unscored.resorts.map((r) => r.slug), ["alta", "vail", "brighton", "nowhere"], "all unscored: new snow breaks the tie, then name");
});

test("the markdown alternate carries the score tagline and the components link when the document has a score", () => {
  const withScore = resortMarkdown(serializeResort(resort(), { now: NOW, score: ROW }), { now: NOW });
  assert.match(withScore, /\nSnow Score: As of Dec 20, Alta's PeakCam Snow Score is 82 of 100 \(great\): .* Algorithmic, formula score-v1; components and 30-day history at https:\/\/www\.peakcam\.io\/api\/v1\/resorts\/alta\/score-components\.\n/);
  const without = resortMarkdown(serializeResort(resort(), { now: NOW, score: null }), { now: NOW });
  assert.ok(!without.includes("Snow Score:"));
});
