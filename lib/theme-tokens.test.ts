import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { PC_BARK, PC_BARK_50, PC_BARK_DK } from "./theme-tokens";

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
