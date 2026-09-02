import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import {
  PC_BARK,
  PC_BARK_50,
  PC_BARK_DK,
  RATING_COLORS,
  RATING_CHIP_CLASS,
  RATING_DOT_CLASS,
  OFF_SEASON_COLOR,
  CONDITION_ORDER,
  ratingLabel,
} from "./theme-tokens";
import { RATING_ORDER } from "./conditions-engine";

/**
 * The whole point of the module is that JS-side hexes track the CSS custom
 * properties. If this drifts, map labels and chart axes quietly stop matching
 * the rest of the page (and, last time, stopped meeting contrast).
 */
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function cssVar(name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`));
  assert.ok(match, `--${name} not found in app/globals.css`);
  return match![1].toLowerCase();
}

test("the bark tokens match --pc-bark* in globals.css", () => {
  assert.strictEqual(PC_BARK, cssVar("pc-bark"));
  assert.strictEqual(PC_BARK_50, cssVar("pc-bark-50"));
  assert.strictEqual(PC_BARK_DK, cssVar("pc-bark-dk"));
});

// ── Condition rating palette ─────────────────────────────────

test("the rating hexes match --pc-great/-good/-fair/-poor in globals.css", () => {
  // A drift here shows up as a map marker whose color contradicts the chip on
  // the card that opens when you click it.
  assert.strictEqual(RATING_COLORS.great, cssVar("pc-great"));
  assert.strictEqual(RATING_COLORS.good, cssVar("pc-good"));
  assert.strictEqual(RATING_COLORS.fair, cssVar("pc-fair"));
  assert.strictEqual(RATING_COLORS.poor, cssVar("pc-poor"));
});

test("the off-season fill is the neutral bark, not a fifth invented color", () => {
  assert.strictEqual(OFF_SEASON_COLOR, PC_BARK_50);
});

test("every rating has a chip and a dot class", () => {
  for (const rating of RATING_ORDER) {
    assert.ok(RATING_CHIP_CLASS[rating], `no chip class for ${rating}`);
    assert.ok(RATING_DOT_CLASS[rating], `no dot class for ${rating}`);
  }
});

test("chip classes are literal and complete, so the Tailwind scanner finds them", () => {
  // Tailwind reads source text. A name assembled at runtime compiles to
  // nothing and the chip renders unstyled in production only.
  for (const cls of Object.values(RATING_CHIP_CLASS)) {
    assert.ok(!cls.includes("${"), "class strings must not be interpolated");
    assert.match(cls, /(^| )bg-[a-z0-9-]+( |$)/);
    assert.match(cls, /(^| )text-[a-z0-9-]+( |$)/);
    assert.match(cls, /(^| )border-[a-z0-9-]+( |$)/);
  }
});

test("mustard 'fair' takes ink text; the other three take cream", () => {
  assert.ok(RATING_CHIP_CLASS.fair.includes("text-ink"));
  assert.ok(RATING_CHIP_CLASS.great.includes("text-cream-50"));
  assert.ok(RATING_CHIP_CLASS.good.includes("text-cream-50"));
  assert.ok(RATING_CHIP_CLASS.poor.includes("text-cream-50"));
});

test("ratingLabel title-cases the stored lowercase value", () => {
  assert.strictEqual(ratingLabel("great"), "Great");
  assert.strictEqual(ratingLabel("poor"), "Poor");
  assert.strictEqual(ratingLabel(""), "");
});

test("CONDITION_ORDER sorts best first and inverts the engine's tier order", () => {
  assert.deepStrictEqual(CONDITION_ORDER, { great: 0, good: 1, fair: 2, poor: 3 });
  for (const [i, rating] of RATING_ORDER.entries()) {
    assert.strictEqual(CONDITION_ORDER[rating], RATING_ORDER.length - 1 - i);
  }
});
