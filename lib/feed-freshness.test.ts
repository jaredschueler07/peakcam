import { test } from "node:test";
import assert from "node:assert";
import { checkFreshness, FRESHNESS_THRESHOLD_HOURS } from "./feed-freshness";

const HOUR_MS = 60 * 60 * 1000;
const NOW = Date.parse("2026-08-04T13:00:00Z");

test("checkFreshness treats a recent row as fresh", () => {
  const latest = new Date(NOW - 2 * HOUR_MS).toISOString();
  const result = checkFreshness(NOW, latest);
  assert.strictEqual(result.stale, false);
  assert.ok(result.ageHours !== null && Math.abs(result.ageHours - 2) < 1e-6);
});

test("checkFreshness treats a row older than the threshold as stale", () => {
  const latest = new Date(NOW - 9 * HOUR_MS).toISOString();
  const result = checkFreshness(NOW, latest);
  assert.strictEqual(result.stale, true);
  assert.ok(result.ageHours !== null && Math.abs(result.ageHours - 9) < 1e-6);
});

test("checkFreshness is exclusive at the threshold boundary (exactly N hours is not yet stale)", () => {
  const latest = new Date(NOW - FRESHNESS_THRESHOLD_HOURS * HOUR_MS).toISOString();
  const result = checkFreshness(NOW, latest);
  assert.strictEqual(result.stale, false);

  const justOver = new Date(NOW - (FRESHNESS_THRESHOLD_HOURS * HOUR_MS + 1)).toISOString();
  assert.strictEqual(checkFreshness(NOW, justOver).stale, true);
});

test("checkFreshness treats an empty table (null timestamp) as stale, not a crash", () => {
  const result = checkFreshness(NOW, null);
  assert.strictEqual(result.stale, true);
  assert.strictEqual(result.ageHours, null);
});

test("checkFreshness treats an unparseable timestamp as stale rather than throwing", () => {
  const result = checkFreshness(NOW, "not-a-date");
  assert.strictEqual(result.stale, true);
  assert.strictEqual(result.ageHours, null);
});

test("checkFreshness honors a custom threshold", () => {
  const latest = new Date(NOW - 3 * HOUR_MS).toISOString();
  assert.strictEqual(checkFreshness(NOW, latest, 2).stale, true);
  assert.strictEqual(checkFreshness(NOW, latest, 4).stale, false);
});
