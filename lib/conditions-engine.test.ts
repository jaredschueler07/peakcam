import { computeSnotelRating } from "./conditions-engine";
import { test } from "node:test";
import assert from "node:assert";
import { computeTrend, computeConditions, type ConditionsInput } from "./conditions-engine";

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

test("GOOD requires recent snow and a known substantial base", () => {
  assert.equal(computeSnotelRating(2, 2, 30, null), "good");
  assert.equal(computeSnotelRating(2, 2, 24, null), "good");
  assert.equal(computeSnotelRating(2, 2, 23, null), "fair");
  assert.equal(computeSnotelRating(0, 0, 30, 100), "fair");
});
test("unknown depth with fresh snow remains FAIR, not POOR or GOOD", () => {
  assert.equal(computeSnotelRating(4, 4, null, null), "fair");
  assert.equal(computeSnotelRating(0, 0, null, null), "poor");
});
test("GREAT retains the existing depth-blind threshold", () => {
  assert.equal(computeSnotelRating(6, 6, 2, null), "great");
});
