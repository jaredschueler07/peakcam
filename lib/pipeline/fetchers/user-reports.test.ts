import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import {
  normalizeVisibility,
  normalizeWind,
  VISIBILITY_SCORES,
  WIND_SCORES,
  VISIBILITY_SCORE_MAX,
  WIND_SCORE_MAX,
} from "../../conditions-engine";

// The fetcher itself imports lib/supabase, which throws at import without env
// vars, so these tests inspect its source instead of executing it. That is
// enough for the property they guard: the fetcher must derive its 0–1
// visibility/wind scores from the engine, never from a second literal table.
const FETCHER_SRC = readFileSync(new URL("./user-reports.ts", import.meta.url), "utf8");

test("the user-reports fetcher imports the engine normalizers", () => {
  assert.match(FETCHER_SRC, /normalizeVisibility\(/);
  assert.match(FETCHER_SRC, /normalizeWind\(/);
  assert.match(FETCHER_SRC, /from\s+"\.\.\/\.\.\/conditions-engine"/);
});

test("drift guard: no literal visibility/wind score table in the fetcher", () => {
  // Historically: { clear: 1.0, foggy: 0.5, whiteout: 0.0 } and
  // { calm: 1.0, breezy: 0.66, gusty: 0.33, high: 0.0 }, which disagreed with
  // the engine (foggy 0.5 vs 2/3). Any vocabulary key followed by a number
  // means the table came back.
  const vocab = [...Object.keys(VISIBILITY_SCORES), ...Object.keys(WIND_SCORES)];
  for (const word of vocab) {
    assert.doesNotMatch(
      FETCHER_SRC,
      new RegExp(`\\b${word}\\s*:\\s*[0-9.]`),
      `fetcher redeclares a score for "${word}"`,
    );
  }
  assert.doesNotMatch(FETCHER_SRC, /Record<string,\s*number>/, "fetcher declares its own score map");
});

test("engine normalizers give the values the fetcher now stores", () => {
  // The old fetcher table's disagreements with the engine, pinned.
  assert.strictEqual(normalizeVisibility("foggy"), VISIBILITY_SCORES.foggy / VISIBILITY_SCORE_MAX); // 2/3, not 0.5
  assert.strictEqual(normalizeVisibility("whiteout"), VISIBILITY_SCORES.whiteout / VISIBILITY_SCORE_MAX); // 1/3, not 0
  assert.strictEqual(normalizeWind("breezy"), WIND_SCORES.breezy / WIND_SCORE_MAX); // 2/3, not 0.66
  assert.strictEqual(normalizeWind("gusty"), WIND_SCORES.gusty / WIND_SCORE_MAX); // 1/3, not 0.33
  assert.strictEqual(normalizeWind("high"), 0);
  assert.strictEqual(normalizeVisibility("clear"), 1);
});
