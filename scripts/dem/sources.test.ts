import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RESORT_BAKE_CONFIGS } from "../../lib/game/terrain/resorts";
import {
  THREE_DEP_PROJECT_ROOT,
  attributionFor,
  fetch3depTiles,
  list3depProjectTiles,
  resolveDemSource,
  select3depTiles,
  threeDepListingUrl,
  threeDepTileUrl,
} from "./sources";

test("each pilot resort resolves to its designed source", () => {
  assert.deepEqual(resolveDemSource(RESORT_BAKE_CONFIGS["breckenridge"]), {
    kind: "3dep",
    project: "CO_Central_and_WesternCO_2016_A16",
  });
  assert.deepEqual(resolveDemSource(RESORT_BAKE_CONFIGS["heavenly"]), {
    kind: "3dep",
    project: "CA_SierraNevada_B22",
  });
  assert.deepEqual(resolveDemSource(RESORT_BAKE_CONFIGS["ski-portillo"]), {
    kind: "copernicus",
    tile: "S33_00_W071_00",
  });
});

test("3DEP tile selection keeps only the UTM tiles around the requested extent", () => {
  const prefix = "StagedProducts/Elevation/1m/Projects/P/TIFF/";
  const keys = [
    `${prefix}USGS_1M_13_x39y436_P.tif`,
    `${prefix}USGS_1M_13_x40y437_P.tif`,
    `${prefix}USGS_1M_13_x41y438_P.tif`,
    `${prefix}USGS_1M_13_x90y490_P.tif`,
  ];
  assert.deepEqual(
    select3depTiles(keys, { west: 405_000, south: 4_370_000, east: 411_200, north: 4_376_200 }),
    keys.slice(0, 3),
  );
});

test("3DEP fetch follows listings, downloads selected tiles, and reuses its cache", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "peakcam-3dep-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const key = "StagedProducts/Elevation/1m/Projects/P/TIFF/USGS_1M_13_x40y437_P.tif";
  let tileRequests = 0;
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("list-type=2")) {
      return new Response(`<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>${key}</Key></Contents></ListBucketResult>`);
    }
    tileRequests += 1;
    return new Response(new Uint8Array([1, 2, 3, 4]));
  }) as typeof fetch;

  const bounds = { west: 405_000, south: 4_370_000, east: 411_200, north: 4_376_200 };
  const first = await fetch3depTiles("P", bounds, dir, fakeFetch);
  const second = await fetch3depTiles("P", bounds, dir, fakeFetch);
  assert.deepEqual(first, [path.join(dir, path.basename(key))]);
  assert.deepEqual(second, first);
  assert.deepEqual(fs.readFileSync(first[0]), Buffer.from([1, 2, 3, 4]));
  assert.equal(tileRequests, 1);
});

test("3DEP listing fails loudly on HTTP errors and empty projects", async () => {
  await assert.rejects(
    list3depProjectTiles("P", (async () => new Response("denied", { status: 403 })) as typeof fetch),
    /3DEP P listing failed: HTTP 403/i,
  );
  await assert.rejects(
    list3depProjectTiles(
      "P",
      (async () => new Response("<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>")) as typeof fetch,
    ),
    /contained no GeoTIFF/i,
  );
});

test("terrarium fallback carries the attribution obligation it attaches", () => {
  const a = attributionFor({ kind: "terrarium" });
  assert.match(a.licence, /mixed/i);
  assert.ok(a.notice.length > 0, "fallback must state the obligation it creates");
});

test("3DEP and Copernicus carry their real licence terms", () => {
  assert.match(attributionFor({ kind: "3dep", project: "x" }).licence, /public domain/i);
  const cop = attributionFor({ kind: "copernicus", tile: "x" });
  // Article 6(c) requires a liability disclaimer, not merely a credit line.
  assert.ok(cop.notice.some((n) => /no warranty|liability/i.test(n)));
});

test("3DEP URLs use the USGS TNM staged 1m project layout", () => {
  assert.equal(
    THREE_DEP_PROJECT_ROOT,
    "https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects",
  );
  assert.equal(
    threeDepListingUrl("CO_Central_and_WesternCO_2016_A16"),
    "https://prd-tnm.s3.amazonaws.com/?list-type=2&prefix=StagedProducts%2FElevation%2F1m%2FProjects%2FCO_Central_and_WesternCO_2016_A16%2FTIFF%2F",
  );
  assert.equal(
    threeDepTileUrl(
      "StagedProducts/Elevation/1m/Projects/CA_SierraNevada_B22/TIFF/USGS_1M_11_x77y432_CA_SierraNevada_B22.tif",
    ),
    "https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/CA_SierraNevada_B22/TIFF/USGS_1M_11_x77y432_CA_SierraNevada_B22.tif",
  );
  assert.throws(() => threeDepListingUrl("../wrong"), /invalid 3DEP project/i);
  assert.throws(() => threeDepTileUrl("not-a-staged-tiff"), /invalid 3DEP tile key/i);
});
