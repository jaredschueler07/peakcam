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
  seamlessCellId,
  seamlessCellUrl,
  seamlessCellsFor,
  select3depTiles,
  tileIndexFor,
  tileFootprint,
  threeDepListingUrl,
  threeDepTileUrl,
} from "./sources";

test("each pilot resort resolves to its designed source", () => {
  assert.deepEqual(resolveDemSource(RESORT_BAKE_CONFIGS["breckenridge"]), {
    kind: "3dep",
    projects: ["CO_Central_Western_2016"],
  });
  // No 1 m project covers Heavenly's ski area; it is on the seamless product.
  assert.deepEqual(resolveDemSource(RESORT_BAKE_CONFIGS["heavenly"]), { kind: "3dep-seamless" });
  assert.deepEqual(resolveDemSource(RESORT_BAKE_CONFIGS["ski-portillo"]), {
    kind: "copernicus",
    tile: "S33_00_W071_00",
  });
});

/**
 * Corner extents measured with `gdalinfo` on the staged rasters themselves.
 * Hardcoded so the index semantics cannot silently drift back: the staged
 * tiles carry a ~6 m overlap collar, so the nominal 10 km footprint sits
 * just inside these numbers.
 */
const MEASURED = [
  // Two tiles stacked in Y — pins the north-edge (ceil) semantics.
  { name: "x24y431", x: 24, y: 431, ul: [239_994, 4_310_006], lr: [250_006, 4_299_994] },
  { name: "x24y432", x: 24, y: 432, ul: [239_994, 4_320_006], lr: [250_006, 4_309_994] },
  // Adjacent in X — pins the west-edge (floor) semantics, measured rather than
  // assumed, because Y turned out not to work the way it looked.
  { name: "x25y432", x: 25, y: 432, ul: [249_994, 4_320_006], lr: [260_006, 4_309_994] },
] as const;
/** Half the overlap collar the staged rasters extend beyond the nominal grid. */
const COLLAR_M = 6;

test("the tile index names the north-west corner: x is a west edge, y is a NORTH edge", () => {
  for (const t of MEASURED) {
    const nominal = tileFootprint(t.x, t.y);
    assert.deepEqual(
      nominal,
      {
        west: t.x * 10_000,
        east: (t.x + 1) * 10_000,
        south: (t.y - 1) * 10_000,
        north: t.y * 10_000,
      },
      `${t.name} nominal footprint`,
    );
    // The nominal footprint must sit inside the raster GDAL actually reports.
    assert.equal(nominal.west - t.ul[0], COLLAR_M, `${t.name} west edge vs measured UL`);
    assert.equal(t.ul[1] - nominal.north, COLLAR_M, `${t.name} north edge vs measured UL`);
    assert.equal(t.lr[0] - nominal.east, COLLAR_M, `${t.name} east edge vs measured LR`);
    assert.equal(nominal.south - t.lr[1], COLLAR_M, `${t.name} south edge vs measured LR`);
  }

  // y431 spans 4300000–4310000 and y432 spans 4310000–4320000, so a point at
  // northing 4311316 (Heavenly's gap) is in y432 — never y431, which is what
  // floor(northing / 10000) would have picked.
  assert.deepEqual(tileIndexFor(247_457, 4_311_316), { x: 24, y: 432 });
  assert.equal(Math.floor(4_311_316 / 10_000), 431, "the floor answer is the wrong one");

  // Index and footprint are exact inverses, on both axes and at the seams.
  for (const t of MEASURED) {
    const f = tileFootprint(t.x, t.y);
    assert.deepEqual(tileIndexFor(f.west, f.north), { x: t.x, y: t.y }, `${t.name} NW corner`);
    assert.deepEqual(tileIndexFor(f.east - 1, f.south + 1), { x: t.x, y: t.y }, `${t.name} interior`);
  }
  // X really is floor: easting 250000 starts x25, it does not end x24.
  assert.equal(tileIndexFor(249_999, 4_311_316).x, 24);
  assert.equal(tileIndexFor(250_000, 4_311_316).x, 25);
});

test("a seamless cell id names its north-west corner, with floor on longitude", () => {
  // Measured with gdalinfo on the staged COGs:
  //   n39w120 -> UL (-120.0005556, 39.0005556), LR (-118.9994444, 37.9994444)
  //   n40w107 -> UL (-107.0005556, 40.0005556), LR (-105.9994444, 38.9994444)
  // So the cell covers [lat-1, lat] x [lon, lon+1]: ceil the latitude, FLOOR
  // the longitude. Both probes returned real elevations at these coordinates.
  assert.equal(seamlessCellId(38.9404, -119.912), "n39w120"); // Heavenly, 2790.23 m
  assert.equal(seamlessCellId(39.4749, -106.081), "n40w107"); // Breckenridge, 3319.66 m

  // The trap, and the reason this is tested at all: truncation toward zero
  // gives w119 for Heavenly, which is a real but wrong cell one degree east.
  assert.notEqual(seamlessCellId(38.9404, -119.912), "n39w119");
  assert.equal(Math.trunc(-119.912), -119, "truncation is the wrong answer");
  assert.equal(Math.floor(-119.912), -120, "flooring is the right one");

  // Latitude ceils, so a point just north of a boundary moves up a cell.
  assert.equal(seamlessCellId(38.0001, -119.5), "n39w120");
  assert.equal(seamlessCellId(39.0001, -119.5), "n40w120");
  // Exact boundaries land on the cell they bound: lat 39 is n39's north edge,
  // lon -120 is w120's west edge.
  assert.equal(seamlessCellId(39, -120), "n39w120");

  // Zero padding is fixed-width: 2 for latitude, 3 for longitude.
  assert.equal(seamlessCellId(5.2, -7.5), "n06w008");
  // The rule is the NW corner in every hemisphere, even where 3DEP has no data.
  assert.equal(seamlessCellId(-32.842, -70.129), "s32w071");
  assert.equal(seamlessCellId(46.5, 7.5), "n47e007");
});

test("seamless cells cover a box that straddles a degree boundary", () => {
  // Wholly inside one cell — the usual case for a 6 km bake box.
  assert.deepEqual(seamlessCellsFor({ south: 38.91, north: 38.97, west: -119.95, east: -119.88 }), [
    "n39w120",
  ]);
  // Straddling both a latitude and a longitude boundary needs all four.
  assert.deepEqual(seamlessCellsFor({ south: 38.98, north: 39.02, west: -120.02, east: -119.98 }), [
    "n39w121",
    "n39w120",
    "n40w121",
    "n40w120",
  ]);
});

test("seamless cell URLs use the staged 1/3 arc-second layout and reject junk ids", () => {
  assert.equal(
    seamlessCellUrl("n39w120"),
    "https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current/n39w120/USGS_13_n39w120.tif",
  );
  assert.throws(() => seamlessCellUrl("../escape"), /invalid 3DEP seamless cell/i);
  assert.throws(() => seamlessCellUrl("n39"), /invalid 3DEP seamless cell/i);
});

test("3DEP tile selection keeps only the tiles whose footprint meets the extent", () => {
  const prefix = "StagedProducts/Elevation/1m/Projects/P/TIFF/";
  const keys = [
    `${prefix}USGS_1M_13_x40y437_P.tif`, // E 400-410k, N 4360-4370k
    `${prefix}USGS_1M_13_x41y438_P.tif`, // E 410-420k, N 4370-4380k
    `${prefix}USGS_1M_13_x39y436_P.tif`, // E 390-400k, N 4350-4360k — misses
    `${prefix}USGS_1M_13_x90y490_P.tif`, // nowhere near
  ];
  assert.deepEqual(
    select3depTiles(keys, { west: 405_000, south: 4_365_000, east: 411_200, north: 4_376_200 }),
    keys.slice(0, 2),
  );
});

test("3DEP tile selection picks Heavenly's real tiles from both staged filename conventions", () => {
  // Real key names and the real warp extent from the Heavenly bake. The two
  // projects name tiles differently, so a pattern keyed on the product prefix
  // rather than on `_xNNyNNN_` would silently drop one project entirely.
  const ca = "StagedProducts/Elevation/1m/Projects/CA_SierraNevada_B22/TIFF/";
  const nv = "StagedProducts/Elevation/1m/Projects/NV_Reno_Carson_QL1_2017/TIFF/";
  const caKeys: string[] = [];
  for (const x of [23, 24, 25, 26]) {
    for (const y of [430, 431, 432]) caKeys.push(`${ca}USGS_1M_11_x${x}y${y}_CA_SierraNevada_B22.tif`);
  }
  const nvKeys = [24, 25].map((x) => `${nv}USGS_one_meter_x${x}y432_NV_Reno_Carson_QL1_2017.tif`);
  const heavenly = { west: 244_535.4, south: 4_311_120.8, east: 250_685.4, north: 4_317_270.8 };

  assert.deepEqual(select3depTiles(caKeys, heavenly), [
    `${ca}USGS_1M_11_x24y432_CA_SierraNevada_B22.tif`,
    `${ca}USGS_1M_11_x25y432_CA_SierraNevada_B22.tif`,
  ]);
  assert.deepEqual(select3depTiles(nvKeys, heavenly), nvKeys);
});

test("3DEP tile selection picks Breckenridge's real tiles, including the one its east edge just clips", () => {
  // Box east edge 410097 sits 91 m past x40's east edge, so x41 is genuinely
  // needed — the selection must not round it away.
  const p = "StagedProducts/Elevation/1m/Projects/CO_Central_Western_2016/TIFF/";
  const keys: string[] = [];
  for (const x of [39, 40, 41, 42]) {
    for (const y of [436, 437, 438]) keys.push(`${p}USGS_one_meter_x${x}y${y}_CO_Central_Western_2016.tif`);
  }
  assert.deepEqual(
    select3depTiles(keys, { west: 403_947, south: 4_366_962, east: 410_097, north: 4_373_112 }),
    [
      `${p}USGS_one_meter_x40y437_CO_Central_Western_2016.tif`,
      `${p}USGS_one_meter_x40y438_CO_Central_Western_2016.tif`,
      `${p}USGS_one_meter_x41y437_CO_Central_Western_2016.tif`,
      `${p}USGS_one_meter_x41y438_CO_Central_Western_2016.tif`,
    ],
  );
});

test("3DEP tile selection ignores GDAL sidecars that share a tile's index", () => {
  // Caught for real: `gdalinfo -stats` leaves `.tif.aux.xml` beside each tile,
  // and those were being selected and fed to gdalbuildvrt as inputs.
  const p = "StagedProducts/Elevation/1m/Projects/P/TIFF/";
  const tif = `${p}USGS_1M_11_x24y432_P.tif`;
  const keys = [tif, `${tif}.aux.xml`, `${p}USGS_1M_11_x24y432_P.tif.ovr`];
  assert.deepEqual(
    select3depTiles(keys, { west: 245_000, south: 4_312_000, east: 249_000, north: 4_318_000 }),
    [tif],
  );
});

test("3DEP tile selection takes the neighbour when the extent lands on a tile seam", () => {
  const p = "StagedProducts/Elevation/1m/Projects/P/TIFF/";
  const keys = [24, 25].map((x) => `${p}USGS_1M_11_x${x}y432_P.tif`);
  // A box ending exactly on the 250000 seam still needs bilinear taps from x25.
  assert.deepEqual(
    select3depTiles(keys, { west: 245_000, south: 4_312_000, east: 250_000, north: 4_318_000 }),
    keys,
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
  const first = await fetch3depTiles(["P"], bounds, dir, fakeFetch);
  const second = await fetch3depTiles(["P"], bounds, dir, fakeFetch);
  assert.deepEqual(first, [path.join(dir, "P", path.basename(key))]);
  assert.deepEqual(second, first);
  assert.deepEqual(fs.readFileSync(first[0]), Buffer.from([1, 2, 3, 4]));
  assert.equal(tileRequests, 1);
});

test("3DEP fetch mosaics every configured project, cached under its own directory", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "peakcam-3dep-multi-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const listings: Record<string, string[]> = {
    CA_SierraNevada_B22: [
      "StagedProducts/Elevation/1m/Projects/CA_SierraNevada_B22/TIFF/USGS_1M_11_x23y431_CA_SierraNevada_B22.tif",
      "StagedProducts/Elevation/1m/Projects/CA_SierraNevada_B22/TIFF/USGS_1M_11_x90y990_CA_SierraNevada_B22.tif",
    ],
    NV_Reno_Carson_QL1_2017: [
      "StagedProducts/Elevation/1m/Projects/NV_Reno_Carson_QL1_2017/TIFF/USGS_one_meter_x24y431_NV_Reno_Carson_QL1_2017.tif",
    ],
  };
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("list-type=2")) {
      const project = Object.keys(listings).find((p) => url.includes(encodeURIComponent(`Projects/${p}/TIFF/`)))!;
      const contents = listings[project].map((k) => `<Contents><Key>${k}</Key></Contents>`).join("");
      return new Response(`<ListBucketResult><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`);
    }
    return new Response(new Uint8Array([9]));
  }) as typeof fetch;

  const bounds = { west: 239_000, south: 4_310_000, east: 245_000, north: 4_316_000 };
  const files = await fetch3depTiles(
    ["CA_SierraNevada_B22", "NV_Reno_Carson_QL1_2017"],
    bounds,
    dir,
    fakeFetch,
  );
  assert.deepEqual(files, [
    path.join(dir, "CA_SierraNevada_B22", "USGS_1M_11_x23y431_CA_SierraNevada_B22.tif"),
    path.join(dir, "NV_Reno_Carson_QL1_2017", "USGS_one_meter_x24y431_NV_Reno_Carson_QL1_2017.tif"),
  ]);
});

test("3DEP fetch reports which project contributed nothing, and fails only when all do", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "peakcam-3dep-empty-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const key = "StagedProducts/Elevation/1m/Projects/A/TIFF/USGS_1M_11_x24y431_A.tif";
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("list-type=2")) {
      const contents = url.includes("Projects%2FA%2FTIFF") ? `<Contents><Key>${key}</Key></Contents>` : "";
      return new Response(`<ListBucketResult><IsTruncated>false</IsTruncated>${contents}<Contents><Key>StagedProducts/Elevation/1m/Projects/B/TIFF/USGS_1M_11_x90y990_B.tif</Key></Contents></ListBucketResult>`);
    }
    return new Response(new Uint8Array([9]));
  }) as typeof fetch;

  const bounds = { west: 239_000, south: 4_310_000, east: 245_000, north: 4_316_000 };
  const contributions: Array<{ project: string; tiles: number }> = [];
  const files = await fetch3depTiles(["A", "B"], bounds, dir, fakeFetch, (c) => contributions.push(c));
  assert.deepEqual(files, [path.join(dir, "A", path.basename(key))]);
  assert.deepEqual(contributions, [
    { project: "A", tiles: 1 },
    { project: "B", tiles: 0 },
  ]);

  await assert.rejects(
    fetch3depTiles(["B"], bounds, dir, fakeFetch),
    /no indexed GeoTIFF tiles covering the requested UTM extent/i,
  );
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
  assert.match(attributionFor({ kind: "3dep", projects: ["x", "y"] }).licence, /public domain/i);
  // Same terms, but the two 3DEP products must be named apart: an asset baked
  // from ~10 m seamless must never read as 1 m lidar.
  const seamless = attributionFor({ kind: "3dep-seamless" });
  assert.match(seamless.licence, /public domain/i);
  assert.match(seamless.name, /1\/3 arc-second/);
  assert.notEqual(seamless.name, attributionFor({ kind: "3dep", projects: ["x"] }).name);
  assert.ok(seamless.notice.some((n) => /10 m/.test(n)));
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
    threeDepListingUrl("CO_Central_Western_2016"),
    "https://prd-tnm.s3.amazonaws.com/?list-type=2&prefix=StagedProducts%2FElevation%2F1m%2FProjects%2FCO_Central_Western_2016%2FTIFF%2F",
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
