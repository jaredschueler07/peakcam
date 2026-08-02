import { test } from "node:test";
import assert from "node:assert/strict";
import { transformPoint, warpArgs, vrtArgs } from "./gdal";

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

test("bounded warp pins the exact projected extent and raster dimensions", () => {
  const args = warpArgs("in.vrt", "out.tif", 32613, 6, {
    bounds: { west: 100, south: 200, east: 300, north: 400 },
    width: 1024,
    height: 1024,
  });
  assert.deepEqual(args.slice(args.indexOf("-te"), args.indexOf("-te") + 5), [
    "-te", "100", "200", "300", "400",
  ]);
  assert.deepEqual(args.slice(args.indexOf("-ts"), args.indexOf("-ts") + 3), ["-ts", "1024", "1024"]);
});

test("coordinate transform places Breckenridge in its UTM metre grid", async () => {
  const [east, north] = await transformPoint(-106.081, 39.4749, 4326, 32613);
  assert.ok(east > 400_000 && east < 410_000, `unexpected easting ${east}`);
  assert.ok(north > 4_365_000 && north < 4_375_000, `unexpected northing ${north}`);
});
