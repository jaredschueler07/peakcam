import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parsePasses, parseProfileCsv, summarize, toProfileRecord, toProfileRecords, PROFILE_CSV_COLUMNS } from "./import-profiles";

// Importing the script must never touch the database: main() only runs when
// the file is the process entry point.

const HEADER = PROFILE_CSV_COLUMNS.join(",");

function row(over: Partial<Record<(typeof PROFILE_CSV_COLUMNS)[number], string>> = {}) {
  return {
    slug: "alta",
    runs_total: "119",
    lifts_total: "5",
    skiable_acres: "2614",
    vertical_ft: "2538",
    annual_snowfall_in: "543",
    longest_run_mi: "",
    elevation_base_ft: "8530",
    elevation_summit_ft: "11068",
    passes: "ikon;mountain-collective",
    trail_map_url: "https://www.alta.com/trail-map",
    wikidata_id: "Q2840279",
    source_url: "https://www.alta.com/Ikon https://www.ikonpass.com/en/destinations",
    notes: "",
    ...over,
  };
}

test("toProfileRecord maps a CSV line to the resorts PATCH body, blanks become NULL", () => {
  const record = toProfileRecord(row());
  assert.equal(record.slug, "alta");
  assert.deepEqual(record.patch, {
    runs_total: 119,
    lifts_total: 5,
    skiable_acres: 2614,
    vertical_ft: 2538,
    annual_snowfall_in: 543,
    longest_run_mi: null,
    elevation_base_ft: 8530,
    elevation_summit_ft: 11068,
    passes: ["ikon", "mountain-collective"],
    trail_map_url: "https://www.alta.com/trail-map",
    wikidata_id: "Q2840279",
  });
  assert.equal(record.source_url, "https://www.alta.com/Ikon");
  // An all-blank row still patches: every column to NULL, passes to [].
  const blank = toProfileRecord(row({ runs_total: "", lifts_total: "", skiable_acres: "", vertical_ft: "", annual_snowfall_in: "", elevation_base_ft: "", elevation_summit_ft: "", passes: "", trail_map_url: "", wikidata_id: "", source_url: "" }));
  assert.equal(blank.patch.runs_total, null);
  assert.deepEqual(blank.patch.passes, []);
  assert.equal(blank.source_url, null);
});

test("validation rejects bad numbers, impossible elevations, bad passes, bad URLs and bad Q-ids", () => {
  assert.throws(() => toProfileRecord(row({ runs_total: "lots" })), /alta: runs_total "lots"/);
  assert.throws(() => toProfileRecord(row({ lifts_total: "5.5" })), /lifts_total "5.5" must be a whole number/);
  assert.throws(() => toProfileRecord(row({ skiable_acres: "-3" })), /skiable_acres "-3"/);
  assert.throws(() => toProfileRecord(row({ annual_snowfall_in: "5000" })), /sanity ceiling/);
  assert.throws(() => toProfileRecord(row({ elevation_summit_ft: "8000" })), /elevation_summit_ft 8000 is not above/);
  // A vertical that disagrees with summit minus base is the operator's own
  // inconsistency: recorded as a warning, written as published.
  const warned = toProfileRecord(row({ vertical_ft: "3000" }));
  assert.equal(warned.patch.vertical_ft, 3000);
  assert.deepEqual(warned.warnings, ["alta: vertical_ft 3000 vs summit minus base 2538"]);
  assert.deepEqual(toProfileRecord(row()).warnings, []);
  assert.throws(() => toProfileRecord(row({ passes: "ikon;epic-local" })), /passes token "epic-local"/);
  assert.throws(() => toProfileRecord(row({ trail_map_url: "alta.com/map" })), /trail_map_url "alta.com\/map" is not a URL/);
  assert.throws(() => toProfileRecord(row({ wikidata_id: "2840279" })), /wikidata_id "2840279" is not a Q-id/);
  assert.throws(() => toProfileRecord(row({ slug: "Alta Ski Area" })), /invalid slug/);
});

test("parsePasses canonicalises order and dedupes", () => {
  assert.deepEqual(parsePasses("mountain-collective; ikon;ikon", "alta"), ["ikon", "mountain-collective"]);
  assert.deepEqual(parsePasses("", "alta"), []);
});

test("parseProfileCsv requires every column and toProfileRecords rejects duplicate slugs", () => {
  const rows = parseProfileCsv(`${HEADER}\nalta,119,5,2614,2538,543,,8530,11068,ikon,,Q2840279,https://www.alta.com/Ikon,"derived; see page"\n`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].notes, "derived; see page");
  assert.throws(() => parseProfileCsv("slug,runs_total\nalta,119\n"), /missing column/);
  assert.throws(
    () => toProfileRecords(parseProfileCsv(`${HEADER}\nalta,,,,,,,,,,,,,\nalta,,,,,,,,,,,,,\n`)),
    /Duplicate slug in CSV: "alta"/,
  );
});

test("the committed data/resort-profiles.csv validates end to end and matches data/resorts.csv's slugs", () => {
  const root = path.resolve(__dirname, "..");
  const records = toProfileRecords(parseProfileCsv(fs.readFileSync(path.join(root, "data/resort-profiles.csv"), "utf-8")));
  const resortSlugs = new Set(
    fs
      .readFileSync(path.join(root, "data/resorts.csv"), "utf-8")
      .split("\n")
      .slice(1)
      .filter((l) => l.trim())
      .map((l) => l.split(",")[1]),
  );
  assert.equal(records.length, resortSlugs.size, "one profile row per resort");
  for (const r of records) assert.ok(resortSlugs.has(r.slug), `${r.slug} is not in data/resorts.csv`);
  const counts = summarize(records);
  // The research floor for this block: most of the catalogue has its core
  // sizing figures and more than half carries a Wikidata item.
  assert.ok(counts.runs_total >= 100, `runs_total filled for ${counts.runs_total}`);
  assert.ok(counts.wikidata_id >= 90, `wikidata_id filled for ${counts.wikidata_id}`);
});
