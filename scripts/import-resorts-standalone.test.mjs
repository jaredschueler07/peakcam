import { test } from "node:test";
import assert from "node:assert";
import {
  CAM_KINDS,
  RESORT_PASSES,
  hasElevationData,
  parseList,
  parsePasses,
  toCamRecord,
  toResortMetadataRecord,
  toResortRecord,
} from "./import-resorts-standalone.mjs";

const quiet = () => {};

// ── Legacy elevation helpers ──────────────────────────────────

test("hasElevationData is true when both elevation fields are present", () => {
  assert.strictEqual(hasElevationData({ elevation_base_ft: "8360", elevation_summit_ft: "10860" }), true);
});

test("hasElevationData is false when fields are blank or missing", () => {
  assert.strictEqual(hasElevationData({ elevation_base_ft: "", elevation_summit_ft: "" }), false);
  assert.strictEqual(hasElevationData({}), false);
  assert.strictEqual(hasElevationData({ elevation_base_ft: "8360", elevation_summit_ft: "" }), false);
});

test("toResortMetadataRecord parses elevation strings into integers", () => {
  const record = toResortMetadataRecord("resort-uuid-123", {
    elevation_base_ft: "8360",
    elevation_summit_ft: "10860",
  });
  assert.deepStrictEqual(record, {
    resort_id: "resort-uuid-123",
    elevation_base_ft: 8360,
    elevation_summit_ft: 10860,
  });
});

// ── Resort rows ───────────────────────────────────────────────

/** The header data/resorts.csv has carried since the social-links import. */
function legacyRow(over = {}) {
  return {
    name: "Vail Mountain",
    slug: "vail",
    state: "CO",
    region: "Colorado Rockies",
    lat: "39.6433",
    lng: "-106.3781",
    website_url: "https://www.vail.com",
    cam_page_url: "",
    snotel_station_id: "842:CO:SNTL",
    is_active: "true",
    x_url: "",
    facebook_url: "",
    instagram_url: "",
    country: "",
    elevation_base_ft: "8120",
    elevation_summit_ft: "11570",
    ...over,
  };
}

test("toResortRecord: the legacy header produces exactly the legacy body plus elevations", () => {
  const record = toResortRecord(legacyRow(), quiet);
  assert.deepStrictEqual(record, {
    name: "Vail Mountain",
    slug: "vail",
    state: "CO",
    region: "Colorado Rockies",
    lat: 39.6433,
    lng: -106.3781,
    website_url: "https://www.vail.com",
    cam_page_url: null,
    snotel_station_id: "842:CO:SNTL",
    x_url: null,
    facebook_url: null,
    instagram_url: null,
    is_active: true,
    country: "US",
    elevation_base_ft: 8120,
    elevation_summit_ft: 11570,
  });
  // No profile key leaks in when the CSV has no profile columns.
  for (const key of ["runs_total", "aliases", "passes", "description", "description_source"]) {
    assert.ok(!(key in record), `${key} must be absent`);
  }
});

test("toResortRecord: blank elevations are not sent (never null out prod's backfilled values)", () => {
  const record = toResortRecord(legacyRow({ elevation_base_ft: "", elevation_summit_ft: "" }), quiet);
  assert.ok(!("elevation_base_ft" in record));
  assert.ok(!("elevation_summit_ft" in record));
});

test("toResortRecord: profile columns are parsed when present", () => {
  const record = toResortRecord(
    legacyRow({
      runs_total: "195",
      lifts_total: "31",
      skiable_acres: "5317",
      vertical_ft: "3450",
      annual_snowfall_in: "354",
      longest_run_mi: "4",
      description: "Back Bowls and all.",
      description_source: "Editor",
      trail_map_url: "https://www.vail.com/map.pdf",
      wikidata_id: "Q1234",
      aliases: "Vail | Vail Resort|",
      passes: "Epic|epic|ikon",
    }),
    quiet,
  );
  assert.strictEqual(record.runs_total, 195);
  assert.strictEqual(record.lifts_total, 31);
  assert.strictEqual(record.skiable_acres, 5317);
  assert.strictEqual(record.vertical_ft, 3450);
  assert.strictEqual(record.annual_snowfall_in, 354);
  assert.strictEqual(record.longest_run_mi, 4);
  assert.strictEqual(record.description, "Back Bowls and all.");
  assert.strictEqual(record.description_source, "editor");
  assert.strictEqual(record.trail_map_url, "https://www.vail.com/map.pdf");
  assert.strictEqual(record.wikidata_id, "Q1234");
  assert.deepStrictEqual(record.aliases, ["Vail", "Vail Resort"]);
  assert.deepStrictEqual(record.passes, ["epic", "ikon"]);
});

test("toResortRecord: present-but-blank profile columns are sent as null / empty", () => {
  const record = toResortRecord(
    legacyRow({ runs_total: "", skiable_acres: "n/a", description: "", aliases: "", passes: "" }),
    quiet,
  );
  assert.strictEqual(record.runs_total, null);
  assert.strictEqual(record.skiable_acres, null);
  assert.strictEqual(record.description, null);
  assert.deepStrictEqual(record.aliases, []);
  assert.deepStrictEqual(record.passes, []);
});

test("toResortRecord: unknown description_source is dropped with a warning; a source without a description is dropped", () => {
  const warnings = [];
  const warn = (m) => warnings.push(m);
  const bad = toResortRecord(legacyRow({ description: "x", description_source: "marketing" }), warn);
  assert.strictEqual(bad.description_source, null);
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0], /description_source/);

  const orphan = toResortRecord(legacyRow({ description: "", description_source: "operator" }), quiet);
  assert.strictEqual(orphan.description, null);
  assert.strictEqual(orphan.description_source, null);
});

// ── Lists and passes ──────────────────────────────────────────

test("parseList splits on | and trims", () => {
  assert.deepStrictEqual(parseList("A-Basin| Arapahoe Basin |"), ["A-Basin", "Arapahoe Basin"]);
  assert.deepStrictEqual(parseList(""), []);
  assert.deepStrictEqual(parseList(undefined), []);
});

test("parsePasses lower-cases, de-duplicates and drops unknown passes with a warning", () => {
  const warnings = [];
  const passes = parsePasses("Ikon|IKON|mountain-collective|Season Pass", (m) => warnings.push(m));
  assert.deepStrictEqual(passes, ["ikon", "mountain-collective"]);
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0], /Season Pass/);
  assert.deepStrictEqual(RESORT_PASSES, ["ikon", "epic", "mountain-collective", "indy", "power"]);
});

// ── Cam rows ──────────────────────────────────────────────────

function camRow(over = {}) {
  return {
    resort_slug: "vail",
    name: "Sun Up Bowl",
    elevation: "11250",
    embed_type: "iframe",
    embed_url: "https://player.brownrice.com/embed/vailch11",
    youtube_id: "",
    is_active: "true",
    ...over,
  };
}

test("toCamRecord: the legacy header produces the legacy body and never sends is_active", () => {
  const record = toCamRecord("resort-uuid-123", camRow(), quiet);
  assert.deepStrictEqual(record, {
    resort_id: "resort-uuid-123",
    name: "Sun Up Bowl",
    elevation: "11250",
    embed_type: "iframe",
    embed_url: "https://player.brownrice.com/embed/vailch11",
    youtube_id: null,
  });
});

test("toCamRecord: kind/credit/source_terms_url are sent only when their header is present", () => {
  const record = toCamRecord(
    "resort-uuid-123",
    camRow({ kind: "Snow-Stake", credit: "Courtesy Vail Resorts", source_terms_url: "" }),
    quiet,
  );
  assert.strictEqual(record.kind, "snow-stake");
  assert.strictEqual(record.credit, "Courtesy Vail Resorts");
  assert.strictEqual(record.source_terms_url, null);

  const warnings = [];
  const bad = toCamRecord("r", camRow({ kind: "drone" }), (m) => warnings.push(m));
  assert.strictEqual(bad.kind, null);
  assert.strictEqual(warnings.length, 1);
  assert.deepStrictEqual(CAM_KINDS, ["summit", "mid", "base", "snow-stake", "village", "approach"]);
});
