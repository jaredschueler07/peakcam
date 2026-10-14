import { test } from "node:test";
import assert from "node:assert";
import {
  computeSnotelRating,
  computeTrend,
  computeConditions,
  computeUserScore,
  describeRatingRule,
  normalizeVisibility,
  normalizeWind,
  normalizeSnowQuality,
  normalizeTrailConditions,
  RATING_RULES,
  RATING_THRESHOLDS,
  VISIBILITY_SCORES,
  WIND_SCORES,
  VISIBILITY_SCORE_MAX,
  WIND_SCORE_MAX,
  type ConditionsInput,
  type UserConditionReport,
} from "./conditions-engine";

test("computeTrend uses the default 0.5in threshold when none is passed", () => {
  assert.strictEqual(computeTrend([10, 10.3, 10.6]), "rising"); // delta 0.6 > 0.5
  assert.strictEqual(computeTrend([10, 10.2, 10.3]), "stable"); // delta 0.3 <= 0.5
});

test("computeTrend accepts a custom threshold", () => {
  // A 1.5in swing is "rising" under the default 0.5in threshold...
  assert.strictEqual(computeTrend([20, 21, 21.5]), "rising");
  // ...but "stable" under a 2.0in threshold meant for depth-series data.
  assert.strictEqual(computeTrend([20, 21, 21.5], 2.0), "stable");
});

test("computeTrend still requires 3+ valid values regardless of threshold", () => {
  assert.strictEqual(computeTrend([20, 30], 2.0), "stable");
  assert.strictEqual(computeTrend([null, null], 2.0), "stable");
});

test("computeConditions threads a custom history7d.thresholdIn through to trend7d", () => {
  const input: ConditionsInput = {
    current: { snowDepthIn: 40, sweIn: null, newSnow24h: 0, newSnow48h: 0 },
    normals: { medianSweIn: null, pctile10SweIn: null, pctile90SweIn: null },
    history7d: { sweValues: [38, 39, 40], thresholdIn: 5.0 }, // 2in swing, under a 5in threshold
    forecast: { snowInchesNext48h: 0, maxHighTemp48h: 30 },
  };
  const result = computeConditions(input);
  assert.strictEqual(result.trend7d, "stable");
});


test("fresh snow cannot produce a good rating without a substantial base", () => {
  const input: ConditionsInput = {
    current: { snowDepthIn: 2, sweIn: null, newSnow24h: 2, newSnow48h: 2 },
    normals: { medianSweIn: null, pctile10SweIn: null, pctile90SweIn: null },
    history7d: { sweValues: [] },
    forecast: { snowInchesNext48h: 0, maxHighTemp48h: 74 },
  };
  assert.strictEqual(computeConditions(input).condRating, "poor");
});

test("GOOD requires a known substantial base plus recent snow or an at-normal snowpack", () => {
  assert.equal(computeSnotelRating(2, 2, 30, null), "good");
  assert.equal(computeSnotelRating(2, 2, 24, null), "good");
  assert.equal(computeSnotelRating(2, 2, 23, null), "fair");
  // The documented %-of-normal path: a healthy base with no new snow is GOOD.
  assert.equal(computeSnotelRating(0, 0, 30, 100), "good");
  assert.equal(computeSnotelRating(0, 0, 30, 99), "fair");
  assert.equal(computeSnotelRating(0, 0, 23, 100), "fair");
});
test("unknown depth caps at FAIR whatever the storm total", () => {
  assert.equal(computeSnotelRating(4, 4, null, null), "fair");
  assert.equal(computeSnotelRating(6, 6, null, null), "fair");
  assert.equal(computeSnotelRating(0, 12, null, null), "fair");
  assert.equal(computeSnotelRating(0, 0, null, null), "poor");
});
test("GREAT requires a big storm on a usable base", () => {
  const { great } = RATING_THRESHOLDS;
  assert.equal(computeSnotelRating(6, 6, great.minDepth, null), "great");
  assert.equal(computeSnotelRating(0, 12, great.minDepth, null), "great");
  assert.equal(computeSnotelRating(6, 6, 40, 50), "great"); // % of normal does not gate GREAT
  // One inch short of the base floor falls through to the FAIR base rule.
  assert.equal(computeSnotelRating(6, 6, great.minDepth - 1, null), "fair");
  assert.equal(computeSnotelRating(6, 6, 2, null), "poor");
});
test("Tamarack case: a sensor delta on a 2in base is never GOOD or GREAT", () => {
  // newSnow24h is a depth-sensor delta, so a 2in (or 6in) reading on a 2in
  // base is a blip, not a powder day.
  assert.equal(computeSnotelRating(2, 2, 2, null), "poor");
  assert.equal(computeSnotelRating(6, 6, 2, null), "poor");
  const input: ConditionsInput = {
    current: { snowDepthIn: 2, sweIn: null, newSnow24h: 6, newSnow48h: 6 },
    normals: { medianSweIn: null, pctile10SweIn: null, pctile90SweIn: null },
    history7d: { sweValues: [] },
    forecast: { snowInchesNext48h: 0, maxHighTemp48h: 74 },
  };
  assert.strictEqual(computeConditions(input).condRating, "poor");
});

// ── Rule text (single source of truth for UI copy) ───────────

test("RATING_RULES quotes the live thresholds so tooltips cannot drift", () => {
  const t = RATING_THRESHOLDS;
  assert.match(RATING_RULES.great, new RegExp(`${t.great.newSnow24h}"\\+`));
  assert.match(RATING_RULES.great, new RegExp(`${t.great.newSnow48h}"\\+`));
  assert.match(RATING_RULES.great, new RegExp(`at least ${t.great.minDepth}"`));
  assert.match(RATING_RULES.good, new RegExp(`at least ${t.good.minDepth}"`));
  assert.match(RATING_RULES.good, new RegExp(`${t.good.newSnow24h}"\\+`));
  assert.match(RATING_RULES.good, new RegExp(`${t.good.pctOfNormal}%\\+`));
  assert.match(RATING_RULES.fair, new RegExp(`at least ${t.fair.minDepth}"`));
  assert.match(RATING_RULES.fair, new RegExp(`${t.fair.pctOfNormal}%\\+`));
  assert.match(RATING_RULES.poor, new RegExp(`under ${t.fair.minDepth}"`));
  for (const rating of ["great", "good", "fair", "poor"] as const) {
    assert.strictEqual(RATING_RULES[rating], describeRatingRule(rating));
  }
});

// ── User-report score maps (single source of truth) ──────────

test("normalizeVisibility / normalizeWind derive 0-1 from the canonical maps", () => {
  for (const [k, v] of Object.entries(VISIBILITY_SCORES)) {
    assert.strictEqual(normalizeVisibility(k), v / VISIBILITY_SCORE_MAX);
  }
  for (const [k, v] of Object.entries(WIND_SCORES)) {
    assert.strictEqual(normalizeWind(k), v / WIND_SCORE_MAX);
  }
  assert.strictEqual(normalizeVisibility("clear"), 1);
  assert.strictEqual(normalizeWind("calm"), 1);
  assert.strictEqual(normalizeWind("high"), 0);
});

test("normalizers fall back to the scale midpoint for off-vocabulary values", () => {
  assert.strictEqual(normalizeVisibility("smoky"), 0.5);
  assert.strictEqual(normalizeWind(null), 0.5);
  assert.strictEqual(normalizeSnowQuality(undefined), 0.5);
  assert.strictEqual(normalizeTrailConditions("closed"), 0.5);
});

test("computeUserScore agrees with the normalizers it is built from", () => {
  const r: UserConditionReport = {
    snow_quality: "powder", visibility: "foggy", wind: "gusty", trail_conditions: "groomed",
  };
  const expected =
    normalizeSnowQuality(r.snow_quality) * 0.4 +
    normalizeVisibility(r.visibility) * 0.2 +
    normalizeWind(r.wind) * 0.2 +
    normalizeTrailConditions(r.trail_conditions) * 0.2;
  assert.strictEqual(computeUserScore([r]), expected);
});

test("computeUserScore survives an off-vocabulary value instead of returning NaN", () => {
  const score = computeUserScore([
    { snow_quality: "slush" as never, visibility: "clear", wind: "calm", trail_conditions: "groomed" },
  ]);
  assert.ok(score != null && Number.isFinite(score), `expected a finite score, got ${score}`);
});
