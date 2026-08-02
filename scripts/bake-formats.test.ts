/**
 * bake-formats.test.ts
 * ────────────────────
 * Unit tests for the terrain bake's encode side (scripts/bake-resort.ts) and
 * the runtime decode side (lib/game/terrain/formats.ts). Nothing here touches
 * the network — the committed assets are checked by
 * `npx tsx scripts/validate-game-assets.ts` instead.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  HEIGHTFIELD_ORIENTATION,
  colForX,
  decodeDelta,
  decodeHeightfield,
  decodeTrails,
  dequantizeHeight,
  encodeDelta,
  quantizeHeight,
  rowForY,
  sampleHeightBilinear,
  type TerrainMeta,
  type TrailsFile,
} from "@/lib/game/terrain/formats";
import { clipPolylineToBox, emitKtx2Texture, latToPixelY, lonToPixelX, overpassQuery, rdp, type Pt } from "@/scripts/bake-resort";
import { RESORT_BAKE_CONFIGS } from "@/lib/game/terrain/resorts";

const QUANTUM = 0.1;

test("runtime raster outputs keep valid KTX2 bytes and use the KTX2 extension", () => {
  const identifier = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
  const encoded = Buffer.concat([identifier, Buffer.from("payload")]);

  const output = emitKtx2Texture("snow-albedo.png", encoded);

  assert.equal(output.name, "snow-albedo.ktx2");
  assert.equal(output.data, encoded);
});

test("runtime raster outputs reject bytes that are not KTX2", () => {
  assert.throws(() => emitKtx2Texture("snow-albedo.png", Buffer.from("not ktx2")), /invalid KTX2/i);
});

function metaFor(grid: number, sizeM: number, minZ: number, maxZ: number): TerrainMeta {
  return {
    version: 1,
    slug: "test",
    center: [0, 0],
    sizeM,
    grid,
    minZ,
    maxZ,
    quantum: QUANTUM,
    source: "terrarium",
    sourceZoom: 14,
    orientation: HEIGHTFIELD_ORIENTATION,
    bakedAt: "2026-08-01T00:00:00.000Z",
  };
}

/** Pack uint16 codes into a little-endian buffer the way the bake does. */
function packCodes(codes: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(codes.length * 2);
  const view = new DataView(buf);
  codes.forEach((c, i) => view.setUint16(i * 2, c, true));
  return buf;
}

// ─── Quantisation ────────────────────────────────────────────

test("quantize/dequantize round-trips within half a quantum", () => {
  const minZ = 2327.4;
  let worst = 0;
  for (let i = 0; i < 20000; i++) {
    const z = minZ + (i / 20000) * 1800 + (i % 7) * 0.0137;
    const back = dequantizeHeight(quantizeHeight(z, minZ, QUANTUM), minZ, QUANTUM);
    worst = Math.max(worst, Math.abs(back - z));
  }
  assert.ok(worst <= QUANTUM / 2 + 1e-9, `worst error ${worst} exceeds ${QUANTUM / 2}`);
});

test("quantize clamps to the uint16 range instead of wrapping", () => {
  assert.equal(quantizeHeight(-50, 0, QUANTUM), 0);
  assert.equal(quantizeHeight(1e9, 0, QUANTUM), 65535);
});

// ─── Heightfield decode + orientation ────────────────────────

test("decodeHeightfield rejects a buffer whose size disagrees with the grid", () => {
  assert.throws(() => decodeHeightfield(packCodes([1, 2, 3]), metaFor(4, 12, 0, 10)), /size mismatch/);
});

test("orientation invariant: row 0 is north, col 0 is west", () => {
  // A 4×4 grid over a 30 m box. Codes encode elevation = code * 0.1 m above
  // minZ = 1000: north-west low, south-east high, so both axes are unambiguous.
  const grid = 4;
  const sizeM = 30;
  const codes: number[] = [];
  for (let row = 0; row < grid; row++) {
    for (let col = 0; col < grid; col++) codes.push((row * 10 + col) * 10); // 1 m steps
  }
  const meta = metaFor(grid, sizeM, 1000, 1000 + 33);
  const field = decodeHeightfield(packCodes(codes), meta);

  assert.equal(field.cellSizeM, 10); // 30 m / (4 - 1)
  assert.equal(field.heights[0], 1000); // NW corner
  assert.equal(field.heights[grid - 1], 1003); // NE corner
  assert.equal(field.heights[(grid - 1) * grid], 1030); // SW corner
  assert.equal(field.heights[grid * grid - 1], 1033); // SE corner

  // Index math: the NW corner of the box is (x = -15, y = +15).
  assert.equal(colForX(field, -15), 0);
  assert.equal(rowForY(field, 15), 0);
  assert.equal(colForX(field, 15), 3);
  assert.equal(rowForY(field, -15), 3);

  // Sampling agrees with the corners, and moving east/south both raise height.
  assert.equal(sampleHeightBilinear(field, -15, 15), 1000);
  assert.equal(sampleHeightBilinear(field, 15, -15), 1033);
  assert.ok(sampleHeightBilinear(field, 5, 15) > sampleHeightBilinear(field, -5, 15), "east is +x");
  assert.ok(sampleHeightBilinear(field, -15, -5) > sampleHeightBilinear(field, -15, 5), "north is +y");

  // Midpoint of the box: bilinear average of the four central samples.
  assert.ok(Math.abs(sampleHeightBilinear(field, 0, 0) - 1016.5) < 1e-6);

  // Out-of-box samples clamp to the edge rather than throwing or wrapping.
  assert.equal(sampleHeightBilinear(field, -1000, 1000), 1000);
  assert.equal(sampleHeightBilinear(field, 1000, -1000), 1033);
});

// ─── Delta encoding ──────────────────────────────────────────

test("delta encode/decode round-trips exactly", () => {
  const points: Array<[number, number]> = [
    [-32100, 88400],
    [-32059, 88305],
    [-32021, 88203],
    [-32021, 88203], // repeated node
    [40000, -40000], // large jump
  ];
  const flat = encodeDelta(points);
  assert.deepEqual(flat.slice(0, 2), [-32100, 88400], "first pair is absolute");
  assert.deepEqual(decodeDelta(flat), points);
  assert.deepEqual(encodeDelta(decodeDelta(flat)), flat);
});

test("delta decode rejects an odd-length array", () => {
  assert.throws(() => decodeDelta([1, 2, 3]), /even length/);
});

test("decodeTrails yields absolute local metres and typed fields", () => {
  const file: TrailsFile = {
    v: 1,
    center: [-32.842, -70.129],
    sizeM: 4096,
    unit: 0.1,
    convention: "europe",
    runs: [{ n: "Roca Jack", d: "expert", g: "backcountry", gl: 1, o: 1, p: [-3210, 8840, 41, -95] }],
    lifts: [{ n: "Roca Jack", t: "platter", p: [0, 0, 100, 200] }],
  };
  const trails = decodeTrails(file);
  assert.equal(trails.convention, "europe");
  const run = trails.runs[0];
  assert.equal(run.name, "Roca Jack");
  assert.equal(run.difficulty, "expert");
  assert.equal(run.grooming, "backcountry");
  assert.equal(run.gladed, true);
  assert.equal(run.oneway, true);
  assert.deepEqual(run.points[0], { x: -321, y: 884 });
  assert.ok(Math.abs(run.points[1].x - -316.9) < 1e-9 && Math.abs(run.points[1].y - 874.5) < 1e-9);
  assert.equal(trails.lifts[0].type, "platter");
  assert.deepEqual(trails.lifts[0].points[1], { x: 10, y: 20 });

  // Absent optional keys decode to explicit nulls/false, not undefined.
  const bare = decodeTrails({ ...file, runs: [{ n: null, p: [0, 0] }] });
  assert.equal(bare.runs[0].difficulty, null);
  assert.equal(bare.runs[0].grooming, null);
  assert.equal(bare.runs[0].gladed, false);
});

// ─── Trail clipping + simplification ─────────────────────────

test("clipPolylineToBox keeps interior geometry untouched", () => {
  const pts: Pt[] = [
    [0, 0],
    [10, 10],
    [20, -5],
  ];
  assert.deepEqual(clipPolylineToBox(pts, 100), [pts]);
});

test("clipPolylineToBox trims to the boundary and splits re-entrant lines", () => {
  const half = 100;
  // In → out (west) → back in 50 m further north → out (east). Naive
  // point-filtering would join the two interior stretches with a shortcut.
  const pts: Pt[] = [
    [0, 0],
    [-500, 0],
    [-500, 50],
    [0, 50],
    [300, 50],
  ];
  const pieces = clipPolylineToBox(pts, half);
  assert.equal(pieces.length, 2, "the excursion outside the box must break the line");
  for (const piece of pieces) {
    for (const [x, y] of piece) {
      assert.ok(Math.abs(x) <= half + 1e-9 && Math.abs(y) <= half + 1e-9, `point ${x},${y} escaped the box`);
    }
  }
  assert.deepEqual(pieces[0], [
    [0, 0],
    [-100, 0], // trimmed to the west edge
  ]);
  assert.deepEqual(pieces[1][0], [-100, 50], "re-entry sits exactly on the west edge");
  assert.deepEqual(pieces[1][pieces[1].length - 1], [100, 50], "exit sits exactly on the east edge");
});

test("clipPolylineToBox handles segments that cross the box entirely and misses", () => {
  const crossing = clipPolylineToBox(
    [
      [-500, 0],
      [500, 0],
    ],
    100,
  );
  assert.deepEqual(crossing, [
    [
      [-100, 0],
      [100, 0],
    ],
  ]);
  assert.deepEqual(
    clipPolylineToBox(
      [
        [-500, 500],
        [500, 500],
      ],
      100,
    ),
    [],
  );
});

test("rdp drops collinear detail and keeps the endpoints", () => {
  const line: Pt[] = Array.from({ length: 20 }, (_, i) => [i * 5, 0] as Pt);
  assert.deepEqual(rdp(line, 6), [
    [0, 0],
    [95, 0],
  ]);

  // A 10 m bump survives a 6 m tolerance; a 2 m bump does not.
  const bump = (h: number): Pt[] => [
    [0, 0],
    [50, h],
    [100, 0],
  ];
  assert.equal(rdp(bump(10), 6).length, 3);
  assert.equal(rdp(bump(2), 6).length, 2);
  assert.equal(rdp([[0, 0]], 6).length, 1, "degenerate input passes through");
});

// ─── Config / query shape ────────────────────────────────────

test("overpass query uses the report's shape and the resort bbox", () => {
  const cfg = RESORT_BAKE_CONFIGS["ski-portillo"];
  const q = overpassQuery(cfg.bbox);
  assert.match(q, /\[out:json\]\[timeout:120\];/);
  assert.match(q, /way\["piste:type"="downhill"\]\(-32\.9,-70\.22,-32\.76,-70\.04\);/);
  assert.match(q, /way\["aerialway"~"\^\(chair_lift\|gondola/);
  assert.match(q, /out geom;$/);
});

test("web mercator helpers agree with known tile coordinates", () => {
  // Portillo's centre at z14 falls in tile 5000/9775 (fetched live during the bake).
  assert.equal(Math.floor(lonToPixelX(-70.129, 14) / 256), 5000);
  assert.equal(Math.floor(latToPixelY(-32.842, 14) / 256), 9775);
  // Longitude is linear; latitude is not, but both must be monotonic.
  assert.ok(lonToPixelX(-70, 14) > lonToPixelX(-71, 14), "x grows eastward");
  assert.ok(latToPixelY(-33, 14) > latToPixelY(-32, 14), "y grows southward");
});

test("resort bake configs cover the three pilot resorts with the report's boxes", () => {
  assert.deepEqual(Object.keys(RESORT_BAKE_CONFIGS).sort(), ["breckenridge", "heavenly", "ski-portillo"]);
  assert.equal(RESORT_BAKE_CONFIGS["ski-portillo"].sizeM, 4096);
  assert.equal(RESORT_BAKE_CONFIGS.breckenridge.sizeM, 6144);
  assert.equal(RESORT_BAKE_CONFIGS.heavenly.sizeM, 6144);
});
