import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  projectedRasterBounds,
  sampleFromWarpedTiff,
  terrainProvenance,
} from "./bake-resort";

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

test("terrain metadata provenance records designed source and projected resolution", () => {
  assert.deepEqual(
    terrainProvenance({ kind: "3dep", project: "CO_Central_and_WesternCO_2016_A16" }, 32613),
    {
      demSource: { kind: "3dep", project: "CO_Central_and_WesternCO_2016_A16" },
      epsg: 32613,
      sourceResolutionM: 1,
    },
  );
  assert.deepEqual(
    terrainProvenance({ kind: "copernicus", tile: "S33_00_W071_00" }, 32719),
    {
      demSource: { kind: "copernicus", tile: "S33_00_W071_00" },
      epsg: 32719,
      sourceResolutionM: 30,
    },
  );
});
