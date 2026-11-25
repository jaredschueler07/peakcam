import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { POPULAR_RESORTS, POPULAR_SLUGS } from "./popular-resorts";
import { parseCsv, toOpeningRecord } from "../scripts/seed-resort-openings.mjs";

test("every POPULAR_RESORTS link is a POPULAR_SLUGS resort", () => {
  for (const { slug } of POPULAR_RESORTS) assert.ok(POPULAR_SLUGS.includes(slug), slug);
});

// Every popular resort needs an opening row, or its status reads UNKNOWN every
// morning before first chair and the pre-season guard has no dates to weigh
// (Jackson Hole, Park City, Whistler and Stowe had none on 2026-11-24).
test("every popular resort has a row in data/resort-openings.csv, and every row parses", () => {
  const rows = parseCsv(readFileSync(new URL("../data/resort-openings.csv", import.meta.url), "utf8")) as Array<Record<string, string>>;
  const slugs = new Set(rows.map((r) => r.slug));
  const missing = POPULAR_SLUGS.filter((slug) => !slugs.has(slug));
  assert.deepEqual(missing, [], `popular resorts with no opening row: ${missing.join(", ")}`);
  assert.equal(slugs.size, rows.length, "one row per resort");
  for (const row of rows) toOpeningRecord("resort-uuid", row);
});
