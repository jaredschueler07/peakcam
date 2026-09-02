import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import {
  computeTrend,
  computeConditions,
  computeUserScore,
  normalizeVisibility,
  normalizeWind,
  normalizeSnowQuality,
  normalizeTrailConditions,
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

// ── User-report score maps (single source of truth) ──────────

test("normalizeVisibility / normalizeWind derive 0-1 from the canonical maps", () => {
  for (const [k, v] of Object.entries(VISIBILITY_SCORES)) {
    assert.strictEqual(normalizeVisibility(k), v / VISIBILITY_SCORE_MAX);
  }
  for (const [k, v] of Object.entries(WIND_SCORES)) {
    assert.strictEqual(normalizeWind(k), v / WIND_SCORE_MAX);
  }
  // Spot-check the endpoints so a map edit is visible here.
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

test("the user-reports fetcher holds no second literal score table", () => {
  // Drift guard: lib/pipeline/fetchers/user-reports.ts once carried its own
  // visibility/wind maps on a 0/0.5/1.0 scale that disagreed with the
  // conditions-engine maps above. It must import the normalizers instead.
  const src = readFileSync(
    new URL("./pipeline/fetchers/user-reports.ts", import.meta.url),
    "utf8",
  );
  assert.match(src, /normalizeVisibility/);
  assert.match(src, /normalizeWind/);
  assert.doesNotMatch(src, /whiteout\s*:/, "fetcher redeclares a visibility score map");
  assert.doesNotMatch(src, /breezy\s*:/, "fetcher redeclares a wind score map");
});
