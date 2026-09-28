import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, retiredRowsFilter, toDateOrNull, toOpeningRecord } from "./seed-resort-openings.mjs";

// Importing the seeder must never touch the database: main() only runs when
// the file is the process entry point.

test("toDateOrNull: blank is null, a real day passes, anything else throws with the slug and column", () => {
  assert.equal(toDateOrNull("", "confirmed_open", "mammoth"), null);
  assert.equal(toDateOrNull(undefined, "confirmed_open", "mammoth"), null);
  assert.equal(toDateOrNull("2026-11-13", "confirmed_open", "mammoth"), "2026-11-13");
  assert.throws(() => toDateOrNull("11/13/2026", "confirmed_open", "mammoth"), /mammoth: confirmed_open "11\/13\/2026"/);
  assert.throws(() => toDateOrNull("2026-11-13T00:00:00Z", "projected_open", "vail"), /vail: projected_open/);
});

test("toOpeningRecord maps a CSV line to a resort_openings row and rejects a dateless one", () => {
  const record = toOpeningRecord("resort-uuid", {
    slug: "mammoth",
    season: "2026-27",
    projected_open: "",
    confirmed_open: "2026-11-13",
    closing_date: "",
    source_url: "https://www.mammothmountain.com/",
    notes: "",
  });
  assert.equal(record.resort_id, "resort-uuid");
  assert.equal(record.season, "2026-27");
  assert.equal(record.projected_open, null);
  assert.equal(record.confirmed_open, "2026-11-13");
  assert.equal(record.closing_date, null);
  assert.equal(record.source_url, "https://www.mammothmountain.com/");
  assert.equal(record.notes, null);
  assert.match(record.updated_at, /^\d{4}-\d{2}-\d{2}T/);

  // Retracting a date means deleting the line (the seed then retires the
  // row), not blanking every column.
  assert.throws(
    () => toOpeningRecord("resort-uuid", { slug: "mammoth", projected_open: "", confirmed_open: "", closing_date: "" }),
    /mammoth: row has no projected_open, confirmed_open or closing_date — delete the line/
  );
  assert.throws(() => toOpeningRecord("resort-uuid", { slug: "" }), /no slug/);
});

test("retiredRowsFilter selects every row whose resort is not in the CSV, quoted like fetchResortIds", () => {
  assert.equal(
    retiredRowsFilter(["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"]),
    "resort_id=not.in.(%2211111111-1111-1111-1111-111111111111%22,%2222222222-2222-2222-2222-222222222222%22)"
  );
  // Quotes and backslashes cannot break out of the operand.
  assert.equal(retiredRowsFilter(['a"b\\c']), "resort_id=not.in.(%22abc%22)");
  // An empty keep-list would match the whole table; the seeder never gets
  // here (it returns early with no records), but the helper refuses anyway.
  assert.throws(() => retiredRowsFilter([]), /refusing to match every row/);
});

test("parseCsv keeps quoted commas inside a field and trims every cell", () => {
  const rows = parseCsv(
    'slug,season,projected_open,confirmed_open,closing_date,source_url,notes\n' +
      'mammoth,2026-27,,2026-11-13,,https://example.com/a,"Opens Nov 13, weather permitting"\n' +
      ' vail , 2026-27 ,2026-11-13,,,https://example.com/b,\n'
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].notes, "Opens Nov 13, weather permitting");
  assert.equal(rows[1].slug, "vail");
  assert.equal(rows[1].season, "2026-27");
  assert.equal(rows[1].notes, "");
  assert.deepEqual(parseCsv("slug,season\n"), [], "a header alone is no rows");
});
