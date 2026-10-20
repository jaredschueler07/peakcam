import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEPTH_NO_NORMAL_CAP,
  SCORE_COMPONENT_IDS,
  SCORE_RATING_LADDER,
  SCORE_VERSION,
  SCORE_WEIGHTS,
  STATUS_POINTS,
  buildScoreInput,
  componentClauses,
  computeScore,
  daysSinceSnowDay,
  depthComponent,
  forecastComponent,
  interpolate,
  parseStoredComponents,
  recentSnowComponent,
  reportScoreSource,
  scoreRating,
  snowQualityComponent,
  statusComponent,
  sumNewSnow,
  tempMax3d,
  type ScoreInput,
} from "./score";
import { RATING_THRESHOLDS } from "./conditions-engine";
import { scoreLeadersSentence, scoreSentence } from "./quotable";

function input(over: Partial<ScoreInput> = {}): ScoreInput {
  return {
    date: "2026-12-20",
    depth: { baseDepthIn: 48, pctOfNormal: 110, source: "snotel" },
    recent: { newSnow7dIn: 14, newSnow24hIn: 6, newSnow48hIn: 9, daysSinceSnow: 0, source: "snotel" },
    forecast: { total7dIn: 8, modelCount: 7 },
    quality: { tempMaxF3d: 28, tempSource: "snotel", tags: ["Powder Day"] },
    status: { value: "OPEN", source: "operator" },
    ...over,
  };
}

// ── Weights and ladder ───────────────────────────────────────

test("the five weights are 30/25/20/15/10 and add to 100", () => {
  assert.deepEqual(SCORE_WEIGHTS, { depthVsNormal: 30, recentSnow7d: 25, forecast7d: 20, snowQuality: 15, operatingStatus: 10 });
  assert.equal(SCORE_COMPONENT_IDS.reduce((s, id) => s + SCORE_WEIGHTS[id], 0), 100);
  assert.equal(SCORE_VERSION, "score-v1");
});

test("the rating ladder is great ≥ 75, good ≥ 55, fair ≥ 35, else poor, on the cond_rating labels", () => {
  assert.deepEqual(SCORE_RATING_LADDER, { great: 75, good: 55, fair: 35 });
  assert.equal(scoreRating(100), "great");
  assert.equal(scoreRating(75), "great");
  assert.equal(scoreRating(74), "good");
  assert.equal(scoreRating(55), "good");
  assert.equal(scoreRating(54), "fair");
  assert.equal(scoreRating(35), "fair");
  assert.equal(scoreRating(34), "poor");
  assert.equal(scoreRating(0), "poor");
});

test("every component's max is its weight and a full house scores 100 / great", () => {
  const r = computeScore(input({ depth: { baseDepthIn: 80, pctOfNormal: 140, source: "snotel" }, recent: { newSnow7dIn: 30, newSnow24hIn: 10, newSnow48hIn: 18, daysSinceSnow: 0, source: "snotel" }, forecast: { total7dIn: 24, modelCount: 9 } }));
  for (const id of SCORE_COMPONENT_IDS) assert.equal(r.components[id].max, SCORE_WEIGHTS[id], id);
  assert.equal(r.score, 100);
  assert.equal(r.rating, "great");
  assert.equal(r.scoredBy, "algorithmic");
  assert.equal(r.version, "score-v1");
  assert.equal(r.date, "2026-12-20");
});

test("nothing on file scores 0 / poor with every component sourced none", () => {
  const r = computeScore({
    date: "2026-10-20",
    depth: { baseDepthIn: null, pctOfNormal: null, source: "none" },
    recent: { newSnow7dIn: null, newSnow24hIn: null, newSnow48hIn: null, daysSinceSnow: null, source: "none" },
    forecast: null,
    quality: { tempMaxF3d: null, tempSource: "none", tags: [] },
    status: { value: "UNKNOWN", source: "none" },
  });
  assert.equal(r.score, 0);
  assert.equal(r.rating, "poor");
  for (const id of SCORE_COMPONENT_IDS) assert.equal(r.components[id].source, "none", id);
  assert.deepEqual(componentClauses(r.components), []);
});

// ── Scales anchored on RATING_THRESHOLDS ─────────────────────

test("interpolate is piecewise linear and clamped", () => {
  const a = [[0, 0], [10, 5], [20, 20]] as const;
  assert.equal(interpolate(-5, a), 0);
  assert.equal(interpolate(5, a), 2.5);
  assert.equal(interpolate(10, a), 5);
  assert.equal(interpolate(15, a), 12.5);
  assert.equal(interpolate(99, a), 20);
  assert.equal(interpolate(NaN, a), 0);
});

test("depth: the engine's fair / good percent-of-normal lines are half and 80 % of the points, 125 % is full", () => {
  assert.equal(depthComponent({ baseDepthIn: 40, pctOfNormal: RATING_THRESHOLDS.fair.pctOfNormal, source: "snotel" }).points, 15);
  assert.equal(depthComponent({ baseDepthIn: 40, pctOfNormal: RATING_THRESHOLDS.good.pctOfNormal, source: "snotel" }).points, 24);
  assert.equal(depthComponent({ baseDepthIn: 40, pctOfNormal: 125, source: "snotel" }).points, 30);
  assert.equal(depthComponent({ baseDepthIn: 40, pctOfNormal: 300, source: "snotel" }).points, 30);
  const c = depthComponent({ baseDepthIn: 40, pctOfNormal: 110, source: "snotel" });
  assert.equal(c.source, "snotel");
  assert.match(c.basis, /110% of the station's 1991–2020 median/);
  assert.match(c.basis, /base 40 in\./);
});

test("depth without a normal: the fair / good minimum depths anchor the scale and 60 in caps at 27", () => {
  assert.equal(depthComponent({ baseDepthIn: RATING_THRESHOLDS.fair.minDepth, pctOfNormal: null, source: "model" }).points, 12);
  assert.equal(depthComponent({ baseDepthIn: RATING_THRESHOLDS.good.minDepth, pctOfNormal: null, source: "snotel" }).points, 15);
  const deep = depthComponent({ baseDepthIn: 90, pctOfNormal: null, source: "model" });
  assert.equal(deep.points, DEPTH_NO_NORMAL_CAP);
  assert.equal(deep.source, "model");
  assert.match(deep.basis, /no station normal/);
  // A model resort never gets the normal branch even if a stray pct arrives.
  assert.equal(depthComponent({ baseDepthIn: 30, pctOfNormal: 150, source: "model" }).source, "model");
  assert.equal(depthComponent({ baseDepthIn: null, pctOfNormal: null, source: "none" }).points, 0);
});

test("recent snow: 6 in (the 24 h great line) is 10, 12 in (the 48 h great line) is 17, 24 in is full", () => {
  const at = (n: number) => recentSnowComponent({ newSnow7dIn: n, newSnow24hIn: null, newSnow48hIn: null, daysSinceSnow: 0, source: "snotel" }).points;
  assert.equal(at(0), 0);
  assert.equal(at(RATING_THRESHOLDS.great.newSnow24h), 10);
  assert.equal(at(RATING_THRESHOLDS.great.newSnow48h), 17);
  assert.equal(at(24), 25);
  assert.equal(at(60), 25);
  // Without daily rows the report's 48 h value stands in and the basis says so.
  const fallback = recentSnowComponent({ newSnow7dIn: null, newSnow24hIn: 3, newSnow48hIn: 6, daysSinceSnow: null, source: "model" });
  assert.equal(fallback.points, 10);
  assert.match(fallback.basis, /48 h \(no daily rows yet\)/);
  assert.match(fallback.basis, /model estimate/);
  assert.equal(recentSnowComponent({ newSnow7dIn: null, newSnow24hIn: null, newSnow48hIn: null, daysSinceSnow: null, source: "snotel" }).points, 0);
});

test("forecast: 6 in is half, 20 in is full, no run is zero with source none", () => {
  assert.equal(forecastComponent({ total7dIn: 6, modelCount: 5 }).points, 10);
  assert.equal(forecastComponent({ total7dIn: 20, modelCount: 9 }).points, 20);
  assert.equal(forecastComponent({ total7dIn: 0, modelCount: 9 }).points, 0);
  const none = forecastComponent(null);
  assert.equal(none.points, 0);
  assert.equal(none.source, "none");
  assert.match(forecastComponent({ total7dIn: 3, modelCount: 1 }).basis, /median of 1 model,/);
});

test("snow quality: fresh and cold is full; warmth, age and the engine's surface tags discount it", () => {
  const recent = { newSnow7dIn: 10, newSnow24hIn: 4, newSnow48hIn: 6, daysSinceSnow: 0, source: "snotel" as const };
  const depth = { baseDepthIn: 40, pctOfNormal: null, source: "snotel" as const };
  assert.equal(snowQualityComponent({ tempMaxF3d: 20, tempSource: "snotel", tags: [] }, recent, depth).points, 15);
  // 7 days old, 45°F: 0.65 × 0.725 × 15.
  const stale = snowQualityComponent({ tempMaxF3d: 45, tempSource: "snotel", tags: [] }, { ...recent, daysSinceSnow: 7 }, depth);
  assert.equal(stale.points, 7.1);
  assert.match(stale.basis, /7 days since the last snow day/);
  assert.match(stale.basis, /3-day high 45°F \(SNOTEL\)/);
  // Rain at base halves it; icy 0.6; the stronger discount wins.
  assert.equal(snowQualityComponent({ tempMaxF3d: 20, tempSource: "snotel", tags: ["Icy", "Rain at Base"] }, recent, depth).points, 7.5);
  // A powder-day tag floors freshness at 0.9 even when the daily rows say it has been a while.
  assert.equal(snowQualityComponent({ tempMaxF3d: 20, tempSource: "snotel", tags: ["Powder Day"] }, { ...recent, daysSinceSnow: 14 }, depth).points, 13.5);
  // Unknown freshness and temperature: 0.5 × 0.9.
  assert.equal(snowQualityComponent({ tempMaxF3d: null, tempSource: "none", tags: [] }, { ...recent, daysSinceSnow: null, newSnow24hIn: 0 }, depth).points, 6.8);
  assert.equal(snowQualityComponent({ tempMaxF3d: null, tempSource: "none", tags: [] }, { ...recent, source: "none" }, { ...depth, source: "none" }).source, "none");
});

test("operating status: OPEN full, PRE_SEASON and CLOSED_TODAY half, OFF_SEASON and UNKNOWN none", () => {
  assert.deepEqual(STATUS_POINTS, { OPEN: 10, CLOSED_TODAY: 5, PRE_SEASON: 5, OFF_SEASON: 0, UNKNOWN: 0 });
  const open = statusComponent({ value: "OPEN", source: "operator" });
  assert.equal(open.points, 10);
  assert.equal(open.source, "operator");
  assert.match(open.basis, /^open \(operator feed or confirmed date\)/);
  const pre = statusComponent({ value: "PRE_SEASON", source: "profile" });
  assert.equal(pre.points, 5);
  assert.match(pre.basis, /projected date/);
  assert.equal(statusComponent({ value: "UNKNOWN", source: "none" }).points, 0);
});

// ── Inputs from rows ─────────────────────────────────────────

const DAILY = [
  { date: "2026-12-14", snowDepthIn: 40, sweIn: null, newSnowIn: 0, qcFlag: "valid", tempMaxF: 30 },
  { date: "2026-12-15", snowDepthIn: 44, sweIn: null, newSnowIn: 4, qcFlag: "valid", tempMaxF: 28 },
  { date: "2026-12-16", snowDepthIn: 44, sweIn: null, newSnowIn: 0, qcFlag: "valid", tempMaxF: 31 },
  { date: "2026-12-17", snowDepthIn: 43, sweIn: null, newSnowIn: 0, qcFlag: "valid", tempMaxF: 36 },
  { date: "2026-12-18", snowDepthIn: 49, sweIn: null, newSnowIn: 6, qcFlag: "valid", tempMaxF: 25 },
  { date: "2026-12-19", snowDepthIn: 50, sweIn: null, newSnowIn: 1, qcFlag: "valid", tempMaxF: 27 },
  { date: "2026-12-20", snowDepthIn: 50, sweIn: null, newSnowIn: 0, qcFlag: "valid", tempMaxF: 29 },
  { date: "2026-12-21", snowDepthIn: 58, sweIn: null, newSnowIn: 8, qcFlag: "valid", tempMaxF: 20 },
];

test("row helpers: 7-day sum, days since a snow day and the 3-day high respect the scored date", () => {
  assert.equal(sumNewSnow(DAILY, "2026-12-14", "2026-12-20"), 11);
  assert.equal(daysSinceSnowDay(DAILY, "2026-12-20"), 1);
  assert.equal(daysSinceSnowDay(DAILY, "2026-12-17"), 2);
  assert.equal(daysSinceSnowDay(DAILY, "2026-12-13"), null);
  assert.equal(tempMax3d(DAILY, "2026-12-20"), 29);
  assert.equal(tempMax3d(DAILY, "2026-12-17"), 36);
  // Rows without a stored new_snow_in get it derived from the depth deltas.
  const derived = DAILY.map((r) => ({ ...r, newSnowIn: null }));
  assert.equal(sumNewSnow(derived, "2026-12-14", "2026-12-20"), null, "sumNewSnow reads what it is given");
  const built = buildScoreInput({ date: "2026-12-20", hasStation: true, report: null, daily: derived, forecast: null, status: { value: "UNKNOWN", source: "none" } });
  assert.equal(built.recent.newSnow7dIn, 11);
});

test("buildScoreInput: a SNOTEL report with a stored blend, and a model resort falling back to the blend's high", () => {
  const snotel = buildScoreInput({
    date: "2026-12-20",
    hasStation: true,
    report: { source: "snotel", updated_at: "2026-12-20T13:00:00Z", base_depth: "50", new_snow_24h: 0, new_snow_48h: 1, pct_of_normal: 112, tags: ["Bluebird"] },
    daily: DAILY,
    forecast: { total7dCm: 25.4, modelCount: 8, tempMaxC: -4 },
    status: { value: "OPEN", source: "operator" },
  });
  assert.equal(snotel.depth.source, "snotel");
  assert.equal(snotel.depth.baseDepthIn, 50);
  assert.equal(snotel.depth.pctOfNormal, 112);
  assert.equal(snotel.recent.newSnow7dIn, 11);
  assert.equal(snotel.recent.daysSinceSnow, 1);
  assert.deepEqual(snotel.forecast, { total7dIn: 10, modelCount: 8 });
  assert.equal(snotel.quality.tempMaxF3d, 29);
  assert.equal(snotel.quality.tempSource, "snotel");
  const r = computeScore(snotel);
  assert.equal(r.components.depthVsNormal.points, 26.9);
  assert.equal(r.components.recentSnow7d.points, 15.8);
  assert.equal(r.components.forecast7d.points, 14);
  assert.equal(r.components.operatingStatus.points, 10);
  assert.equal(r.score, 82);
  assert.equal(r.rating, "great");

  const model = buildScoreInput({
    date: "2026-12-20",
    hasStation: false,
    report: { source: "open_meteo", updated_at: "2026-12-20T13:00:00Z", base_depth: 30, new_snow_24h: 2, new_snow_48h: 5, pct_of_normal: null, tags: [] },
    daily: DAILY.map((r) => ({ ...r, tempMaxF: null })),
    forecast: { total7dCm: 10, modelCount: 7, tempMaxC: 2 },
    status: { value: "PRE_SEASON", source: "profile" },
  });
  assert.equal(model.depth.source, "model");
  assert.equal(model.quality.tempMaxF3d, 36);
  assert.equal(model.quality.tempSource, "model");
  assert.equal(computeScore(model).components.depthVsNormal.source, "model");
  assert.equal(reportScoreSource("manual", false), "operator");
  assert.equal(reportScoreSource("pipeline", true), "derived");
  assert.equal(reportScoreSource("snotel", false), "derived");
  assert.equal(reportScoreSource(null, true), "none");
});

// ── Stored rows and copy ─────────────────────────────────────

test("parseStoredComponents rebuilds every id from jsonb and fills gaps as empty", () => {
  const r = computeScore(input());
  const back = parseStoredComponents(JSON.parse(JSON.stringify(r.components)));
  assert.deepEqual(back, r.components);
  const partial = parseStoredComponents({ depthVsNormal: { points: 12, max: 30, basis: "x", source: "snotel" }, junk: 1 });
  assert.equal(partial.depthVsNormal.points, 12);
  assert.equal(partial.forecast7d.points, 0);
  assert.equal(partial.forecast7d.source, "none");
  assert.equal(partial.forecast7d.max, 20);
  assert.equal(parseStoredComponents(null).operatingStatus.basis, "not recorded");
});

test("the tagline is dated by the score day, names the resort with a link and lists the components strongest first", () => {
  const r = computeScore(input());
  const q = scoreSentence({ name: "Alta Ski Area", slug: "alta" }, r);
  assert.equal(q.asOf, null);
  assert.equal(q.href, "/resorts/alta");
  assert.match(q.text, /^As of Dec 20, Alta Ski Area's PeakCam Snow Score is \d+ of 100 \((great|good|fair|poor)\): /);
  assert.match(q.text, /operating status 10 of 10/);
  assert.ok(q.text.endsWith("."));
  assert.ok(!q.text.endsWith(".."));
  const empty = scoreSentence({ name: "Nowhere", slug: "nowhere" }, { date: "2026-10-20", score: 0, rating: "poor", components: { depthVsNormal: { points: 0, max: 30, source: "none" } } });
  assert.match(empty.text, /no component has data behind it yet\.$/);
});

test("the leaders sentence names up to three resorts with the first score spelled out and says so when there are none", () => {
  const q = scoreLeadersSentence([
    { name: "Alta", slug: "alta", score: 82, date: "2026-12-20" },
    { name: "Snowbird", slug: "snowbird", score: 79, date: "2026-12-20" },
    { name: "Brighton", slug: "brighton", score: 76, date: "2026-12-19" },
    { name: "Solitude", slug: "solitude", score: 70, date: "2026-12-20" },
  ]);
  assert.equal(q.text, "As of Dec 20, the best PeakCam Snow Scores are Alta (82 of 100), Snowbird (79) and Brighton (76).");
  assert.equal(q.segments.filter((s) => s.href).length, 3);
  assert.equal(scoreLeadersSentence([{ name: "Alta", slug: "alta", score: 82, date: "2026-12-20" }]).text, "As of Dec 20, the best PeakCam Snow Score is Alta (82 of 100).");
  assert.match(scoreLeadersSentence([]).text, /No PeakCam Snow Scores yet/);
});
