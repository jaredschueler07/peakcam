import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NODATA_FILL_MAX_FRACTION,
  PLAUSIBLE_ELEVATION_M,
  WARP_NODATA,
  assertPlausibleElevations,
  auditNodata,
  classifyElevation,
  nodataExtentCorners,
  nodataFailureMessage,
} from "./nodata";

function grid(width: number, height: number, fill: number): Float32Array {
  return new Float32Array(width * height).fill(fill);
}

test("elevation classification separates the warp sentinel from implausible source values", () => {
  assert.equal(classifyElevation(2500), "ok");
  assert.equal(classifyElevation(PLAUSIBLE_ELEVATION_M.min), "ok");
  assert.equal(classifyElevation(PLAUSIBLE_ELEVATION_M.max), "ok");
  assert.equal(classifyElevation(WARP_NODATA), "uncovered");
  assert.equal(classifyElevation(NaN), "uncovered");
  assert.equal(classifyElevation(-Infinity), "uncovered");
  // The 3DEP sentinel that reached the quantiser as 1,003,065 m of relief.
  assert.equal(classifyElevation(-999999), "implausible");
  assert.equal(classifyElevation(PLAUSIBLE_ELEVATION_M.max + 1), "implausible");
});

test("a fully covered raster audits clean", () => {
  const audit = auditNodata(grid(32, 32, 2500), 32, 32);
  assert.equal(audit.count, 0);
  assert.equal(audit.fraction, 0);
  assert.equal(audit.decision, "clean");
  assert.equal(audit.extent, null);
});

test("nodata decision flips from fill to fail exactly at the fraction threshold", () => {
  const width = 100;
  const height = 100;
  const budget = Math.floor(width * height * NODATA_FILL_MAX_FRACTION); // 10 cells

  const atLimit = grid(width, height, 2500);
  for (let i = 0; i < budget; i++) atLimit[i] = WARP_NODATA;
  const filled = auditNodata(atLimit, width, height);
  assert.equal(filled.count, budget);
  assert.equal(filled.fraction, NODATA_FILL_MAX_FRACTION);
  assert.equal(filled.decision, "fill");

  const overLimit = grid(width, height, 2500);
  for (let i = 0; i <= budget; i++) overLimit[i] = WARP_NODATA;
  const failed = auditNodata(overLimit, width, height);
  assert.equal(failed.count, budget + 1);
  assert.ok(failed.fraction > NODATA_FILL_MAX_FRACTION);
  assert.equal(failed.decision, "fail");
});

test("audit counts uncovered and implausible cells separately and bounds their extent", () => {
  const width = 8;
  const height = 8;
  const values = grid(width, height, 2500);
  values[2 * width + 3] = WARP_NODATA; // row 2, col 3
  values[5 * width + 6] = -999999; //    row 5, col 6
  const audit = auditNodata(values, width, height);

  assert.equal(audit.uncovered, 1);
  assert.equal(audit.implausible, 1);
  assert.equal(audit.count, 2);
  assert.equal(audit.total, 64);
  assert.deepEqual(audit.extent, { minCol: 3, maxCol: 6, minRow: 2, maxRow: 5 });
});

test("audit rejects a values/dimension mismatch rather than reading past the raster", () => {
  assert.throws(() => auditNodata(grid(4, 4, 100), 5, 4), /16 values do not fill a 5x4 raster/i);
});

test("nodata extent corners are reported as projected cell-centre coordinates", () => {
  // 10 m cells: west 1000, north 2000, 4x4 grid.
  const bounds = { west: 1000, south: 1960, east: 1040, north: 2000 };
  const corners = nodataExtentCorners({ minCol: 1, maxCol: 2, minRow: 0, maxRow: 3 }, bounds, 4, 4);
  assert.deepEqual(
    corners.map((c) => [c.label, c.x, c.y]),
    [
      ["NW", 1015, 1995],
      ["NE", 1025, 1995],
      ["SE", 1025, 1965],
      ["SW", 1015, 1965],
    ],
  );
});

test("the nodata failure message names the count, the share, the projects, and the corners", () => {
  const width = 1000;
  const height = 1000;
  const values = grid(width, height, 2500);
  for (let i = 0; i < 5000; i++) values[i] = WARP_NODATA;
  const audit = auditNodata(values, width, height);
  assert.equal(audit.decision, "fail");

  const bounds = { west: 750_000, south: 4_300_000, east: 760_000, north: 4_310_000 };
  const message = nodataFailureMessage(
    "heavenly",
    { projects: ["CA_SierraNevada_B22", "NV_Reno_Carson_QL1_2017"], tiles: 13 },
    audit,
    nodataExtentCorners(audit.extent!, bounds, width, height),
    32611,
  );
  assert.match(message, /heavenly/);
  assert.match(message, /5000 cells/);
  assert.match(message, /0\.50%/);
  assert.match(message, /had no data/i);
  assert.match(message, /do not cover the bake box/i);
  assert.match(message, /invent terrain/i);
  assert.match(message, /CA_SierraNevada_B22, NV_Reno_Carson_QL1_2017/);
  // A staged tile existing is not coverage — the message must say so, because
  // that assumption is what sent the last investigation down the wrong path.
  assert.match(message, /Mosaicked 13 tile\(s\)/);
  assert.match(message, /staged tile existing is not coverage/i);
  assert.match(message, /STATISTICS_VALID_PERCENT/);
  assert.match(message, /EPSG:32611/);
  assert.match(message, /NW 750005\.0, 4309995\.0/);
});

test("the failure message distinguishes uncovered cells from implausible source values", () => {
  const values = grid(10, 10, 2500);
  values[0] = WARP_NODATA;
  values[1] = -999999;
  const audit = auditNodata(values, 10, 10);
  const message = nodataFailureMessage(
    "heavenly",
    { projects: ["P"], tiles: 2 },
    audit,
    nodataExtentCorners(audit.extent!, { west: 0, south: 0, east: 10, north: 10 }, 10, 10),
    32611,
  );
  assert.match(message, /1 uncovered/);
  assert.match(message, /1 implausible/);
});

test("implausible elevations are reported as bad source data, not as a quantisation-range problem", () => {
  assert.doesNotThrow(() => assertPlausibleElevations("breckenridge", 2869, 4024.5));
  assert.doesNotThrow(() => assertPlausibleElevations("x", PLAUSIBLE_ELEVATION_M.min, PLAUSIBLE_ELEVATION_M.max));

  assert.throws(
    () => assertPlausibleElevations("heavenly", -999999, 3066),
    (error: Error) => {
      assert.match(error.message, /heavenly/);
      assert.match(error.message, /-999999/);
      assert.match(error.message, /-500/);
      assert.match(error.message, /9000/);
      assert.match(error.message, /source data/i);
      assert.doesNotMatch(error.message, /uint16/i);
      return true;
    },
  );
  assert.throws(() => assertPlausibleElevations("x", 100, 9001), /implausible|source data/i);
});
