import { test } from "node:test";
import assert from "node:assert/strict";
import { warpArgs, vrtArgs } from "./gdal";

test("warp targets the resort's UTM zone at an exact resolution", () => {
  const args = warpArgs("in.vrt", "out.tif", 32613, 4);
  assert.ok(args.includes("-t_srs"), "must set target SRS");
  assert.ok(args.includes("EPSG:32613"));
  // -tr sets exact square ground resolution; without it gdalwarp picks its own.
  const tr = args.indexOf("-tr");
  assert.ok(tr >= 0, "must set target resolution");
  assert.deepEqual(args.slice(tr + 1, tr + 3), ["4", "4"]);
  assert.ok(args.includes("-r") && args.includes("bilinear"), "resampling must be explicit");
});

test("vrt build lists every input after the output", () => {
  assert.deepEqual(vrtArgs(["a.tif", "b.tif"], "m.vrt"), ["m.vrt", "a.tif", "b.tif"]);
});
