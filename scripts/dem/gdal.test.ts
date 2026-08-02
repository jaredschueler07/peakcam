import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fillNodata, fillNodataArgs, readRaster, transformPoint, warpArgs, vrtArgs } from "./gdal";
import { WARP_NODATA } from "./nodata";

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

test("warp marks uncovered destination cells with the known nodata sentinel", () => {
  const args = warpArgs("in.vrt", "out.tif", 32611, 6, undefined, WARP_NODATA);
  const at = args.indexOf("-dstnodata");
  assert.ok(at >= 0, "uncovered cells must be tagged, not left as an arbitrary init value");
  assert.equal(args[at + 1], String(WARP_NODATA));
});

test("nodata fill interpolates from hole edges without smoothing real terrain", () => {
  const args = fillNodataArgs("in.tif", "out.tif", 32);
  assert.deepEqual(args.slice(args.indexOf("-md"), args.indexOf("-md") + 2), ["-md", "32"]);
  assert.ok(args.includes("-q"));
  assert.deepEqual(args.slice(-2), ["in.tif", "out.tif"]);
});

test("gdal_fillnodata replaces a tagged interior hole with interpolated terrain", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "peakcam-fill-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const vrt = path.join(dir, "hole.vrt");
  const tif = path.join(dir, "hole.tif");
  const filled = path.join(dir, "filled.tif");
  fs.writeFileSync(
    vrt,
    `<VRTDataset rasterXSize="5" rasterYSize="5">
  <SRS dataAxisToSRSAxisMapping="1,2">EPSG:32611</SRS>
  <GeoTransform>0, 1, 0, 5, 0, -1</GeoTransform>
  <VRTRasterBand dataType="Float32" band="1" subClass="VRTRawRasterBand">
    <NoDataValue>${WARP_NODATA}</NoDataValue>
    <SourceFilename relativeToVRT="1">hole.bin</SourceFilename>
    <ImageOffset>0</ImageOffset><PixelOffset>4</PixelOffset><LineOffset>20</LineOffset>
    <ByteOrder>LSB</ByteOrder>
  </VRTRasterBand>
</VRTDataset>`,
  );
  const values = new Float32Array(25).fill(2000);
  values[2 * 5 + 2] = WARP_NODATA; // one interior cell
  fs.writeFileSync(path.join(dir, "hole.bin"), Buffer.from(values.buffer));
  execFileSync("gdal_translate", ["-a_nodata", String(WARP_NODATA), vrt, tif], { stdio: "ignore" });

  const before = await readRaster(tif);
  assert.equal(before.width, 5);
  assert.equal(before.height, 5);
  assert.equal(before.values[12], WARP_NODATA);

  await fillNodata(tif, filled, 32);
  const after = await readRaster(filled);
  assert.equal(after.values[12], 2000);
});

test("coordinate transform places Breckenridge in its UTM metre grid", async () => {
  const [east, north] = await transformPoint(-106.081, 39.4749, 4326, 32613);
  assert.ok(east > 400_000 && east < 410_000, `unexpected easting ${east}`);
  assert.ok(north > 4_365_000 && north < 4_375_000, `unexpected northing ${north}`);
});
