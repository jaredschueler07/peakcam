import { test } from "node:test";
import assert from "node:assert";
import { hasElevationData, toResortMetadataRecord } from "./import-resorts-standalone.mjs";

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
