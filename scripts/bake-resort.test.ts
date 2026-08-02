import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertBakeableRelief,
  projectedRasterBounds,
  resolveNodata,
  sampleFromWarpedTiff,
  terrainProvenance,
} from "./bake-resort";
import { WARP_NODATA } from "./dem/nodata";

/** Write a Float32 GeoTIFF with `WARP_NODATA` tagged on band 1. */
function writeTaggedTiff(dir: string, name: string, values: Float32Array, width: number, height: number): string {
  const vrt = path.join(dir, `${name}.vrt`);
  const bin = path.join(dir, `${name}.bin`);
  const tif = path.join(dir, `${name}.tif`);
  fs.writeFileSync(
    vrt,
    `<VRTDataset rasterXSize="${width}" rasterYSize="${height}">
  <SRS dataAxisToSRSAxisMapping="1,2">EPSG:32611</SRS>
  <GeoTransform>0, 1, 0, ${height}, 0, -1</GeoTransform>
  <VRTRasterBand dataType="Float32" band="1" subClass="VRTRawRasterBand">
    <NoDataValue>${WARP_NODATA}</NoDataValue>
    <SourceFilename relativeToVRT="1">${name}.bin</SourceFilename>
    <ImageOffset>0</ImageOffset><PixelOffset>4</PixelOffset><LineOffset>${width * 4}</LineOffset>
    <ByteOrder>LSB</ByteOrder>
  </VRTRasterBand>
</VRTDataset>`,
  );
  fs.writeFileSync(bin, Buffer.from(values.buffer));
  execFileSync("gdal_translate", ["-a_nodata", String(WARP_NODATA), vrt, tif], { stdio: "ignore" });
  return tif;
}

test("projected raster pixel centres span exactly the configured square", () => {
  const grid = 1024;
  const sizeM = 6144;
  const cellSizeM = sizeM / (grid - 1);
  const bounds = projectedRasterBounds([425_000, 4_371_000], sizeM, grid);

  assert.ok(Math.abs(bounds.east - bounds.west - cellSizeM * grid) < 1e-6);
  assert.ok(Math.abs(bounds.north - bounds.south - cellSizeM * grid) < 1e-6);

  const westCentre = bounds.west + cellSizeM / 2;
  const eastCentre = bounds.east - cellSizeM / 2;
  const northCentre = bounds.north - cellSizeM / 2;
  const southCentre = bounds.south + cellSizeM / 2;
  assert.ok(Math.abs(eastCentre - westCentre - sizeM) < 1);
  assert.ok(Math.abs(northCentre - southCentre - sizeM) < 1);
});

test("warped TIFF sampler preserves north-west row-major orientation", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "peakcam-warped-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const vrt = path.join(dir, "fixture.vrt");
  const tif = path.join(dir, "fixture.tif");
  fs.writeFileSync(
    vrt,
    `<VRTDataset rasterXSize="3" rasterYSize="3">
  <SRS dataAxisToSRSAxisMapping="1,2">EPSG:32613</SRS>
  <GeoTransform>0, 2, 0, 6, 0, -2</GeoTransform>
  <VRTRasterBand dataType="Float32" band="1" subClass="VRTRawRasterBand">
    <SourceFilename relativeToVRT="1">fixture.bin</SourceFilename>
    <ImageOffset>0</ImageOffset><PixelOffset>4</PixelOffset><LineOffset>12</LineOffset>
    <ByteOrder>LSB</ByteOrder>
  </VRTRasterBand>
</VRTDataset>`,
  );
  const values = new Float32Array([101, 102, 103, 201, 202, 203, 301, 302, 303]);
  fs.writeFileSync(path.join(dir, "fixture.bin"), Buffer.from(values.buffer));
  execFileSync("gdal_translate", [vrt, tif], { stdio: "ignore" });

  const sample = await sampleFromWarpedTiff(tif);
  assert.equal(sample(0, 0), 101);
  assert.equal(sample(0, 2), 103);
  assert.equal(sample(2, 0), 301);
  assert.equal(sample(2, 2), 303);
  assert.throws(() => sample(-1, 0), /outside 3x3/i);
  assert.throws(() => sample(0, 3), /outside 3x3/i);
});

const BOUNDS = { west: 0, south: 0, east: 100, north: 100 };

test("a fully covered warp is sampled as-is", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "peakcam-nodata-clean-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const values = new Float32Array(100 * 100).fill(2500);
  const tif = writeTaggedTiff(dir, "clean", values, 100, 100);

  const raster = await resolveNodata("heavenly", tif, dir, BOUNDS, 32611, { projects: ["A"], tiles: 2 });
  assert.equal(raster.values[0], 2500);
});

test("a gap at the fill threshold is interpolated rather than failing the bake", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "peakcam-nodata-fill-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const values = new Float32Array(100 * 100).fill(2500);
  // 10 interior cells = 0.10% of the grid, exactly the fill budget.
  for (let i = 0; i < 10; i++) values[50 * 100 + 40 + i] = WARP_NODATA;
  const tif = writeTaggedTiff(dir, "small-hole", values, 100, 100);

  const raster = await resolveNodata("heavenly", tif, dir, BOUNDS, 32611, { projects: ["A"], tiles: 2 });
  for (let i = 0; i < 10; i++) {
    assert.equal(raster.values[50 * 100 + 40 + i], 2500, `cell ${i} should be interpolated from its edges`);
  }
});

test("a gap past the fill threshold fails with the coverage diagnosis and the offending corners", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "peakcam-nodata-fail-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const values = new Float32Array(100 * 100).fill(2500);
  for (let i = 0; i < 11; i++) values[50 * 100 + 40 + i] = WARP_NODATA;
  const tif = writeTaggedTiff(dir, "big-hole", values, 100, 100);

  await assert.rejects(
    resolveNodata("heavenly", tif, dir, BOUNDS, 32611, { projects: ["CA_SierraNevada_B22", "NV_Reno_Carson_QL1_2017"], tiles: 13 }),
    (error: Error) => {
      assert.match(error.message, /11 cells \(0\.11%\)/);
      assert.match(error.message, /had no data/i);
      assert.match(error.message, /do not cover the bake box/i);
      assert.match(error.message, /CA_SierraNevada_B22, NV_Reno_Carson_QL1_2017/);
      assert.match(error.message, /EPSG:32611/);
      assert.match(error.message, /NW 40\.5, 49\.5/);
      return true;
    },
  );
});

test("relief guards report an undeclared nodata sentinel as bad source data, not a uint16 range problem", () => {
  assert.doesNotThrow(() => assertBakeableRelief("breckenridge", 2869, 4024.5));
  // The Heavenly failure that started this: −999999 m reaching the quantiser.
  assert.throws(() => assertBakeableRelief("heavenly", -999999, 3066), (error: Error) => {
    assert.match(error.message, /source data/i);
    assert.doesNotMatch(error.message, /uint16/i);
    return true;
  });
  // Plausible endpoints, genuinely unquantisable relief: the uint16 message is right.
  assert.throws(() => assertBakeableRelief("x", 0, 8000), /uint16 range/i);
});

test("terrain metadata provenance records designed source and projected resolution", () => {
  assert.deepEqual(
    terrainProvenance({ kind: "3dep", projects: ["CO_Central_Western_2016"] }, 32613),
    {
      demSource: { kind: "3dep", projects: ["CO_Central_Western_2016"] },
      epsg: 32613,
      sourceResolutionM: 1,
    },
  );
  // The seamless product records its own kind and its own resolution.
  assert.deepEqual(terrainProvenance({ kind: "3dep-seamless" }, 32611), {
    demSource: { kind: "3dep-seamless" },
    epsg: 32611,
    sourceResolutionM: 10,
  });
  assert.deepEqual(
    terrainProvenance({ kind: "copernicus", tile: "S33_00_W071_00" }, 32719),
    {
      demSource: { kind: "copernicus", tile: "S33_00_W071_00" },
      epsg: 32719,
      sourceResolutionM: 30,
    },
  );
});
