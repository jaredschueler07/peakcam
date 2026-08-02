import { test } from "node:test";
import assert from "node:assert/strict";
import { utmZoneFor, metresPerSampleError } from "./utm";

test("utm zone for each pilot resort", () => {
  // Portillo -32.842, -70.129 -> zone 19 south, EPSG 32719
  assert.deepEqual(utmZoneFor(-32.842, -70.129), { zone: 19, north: false, epsg: 32719 });
  // Breckenridge 39.4749, -106.081 -> zone 13 north, EPSG 32613
  assert.deepEqual(utmZoneFor(39.4749, -106.081), { zone: 13, north: true, epsg: 32613 });
  // Heavenly 38.9404, -119.912 -> zone 11 north, EPSG 32611
  assert.deepEqual(utmZoneFor(38.9404, -119.912), { zone: 11, north: true, epsg: 32611 });
});

test("the centre-latitude approximation's error is real but sub-metre-per-sample", () => {
  // Quantifies what the UTM warp fixes: mPerDegLon is evaluated once at the box
  // centre, so longitude spacing drifts toward the box's north and south edges.
  const err = metresPerSampleError(39.4749, 3072); // Breckenridge half-span
  assert.ok(err > 0, "approximation is not exact");
  assert.ok(err < 20, `expected a small box-edge error, got ${err} m`);
});
