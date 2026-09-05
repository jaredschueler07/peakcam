import { COURSE_VERSION } from "../lib/game/config/versions";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { GRID_SIZE, TILE_SIZE, Z_TILES_BEHIND } from "@/lib/game/rendering/TerrainRenderer";
import { FarFieldAssetLoader } from "@/lib/game/rendering/loaders/FarFieldAssetLoader";
import type { FarFieldWedge } from "@/lib/game/terrain/far-field-format";
import {
  ARC_CELLS,
  FAR_FIELD_INNER_RADIUS_M,
  FAR_FIELD_RING_BANDS,
  FAR_FIELD_BAKE_CONFIGS,
  MAX_COMPRESSED_BYTES,
  UNSPECIFIED_DEM_SOURCE,
  resolveDemSource,
  NEAR_FIELD_GUARANTEED_RADIUS_M,
  WEDGE_COUNT,
  ROOT,
  bakeFarField,
  buildRingRadii,
  writeFarFieldOutputs,
  buildWedges,
  cellSizeAt,
  findPeakNear,
  firstMeshHit,
  innerRadiusFor,
  segmentsForRing,
  type ElevationSampler,
  type FarFieldBakeConfig,
} from "./bake-far-field";
import {
  computeWedgeBounds,
  decodeFarField,
  farFieldAssetUrl,
  wedgeQuantisationErrorM,
} from "@/lib/game/terrain/far-field-format";

// ─── Fixtures ────────────────────────────────────────────────

/** Synthetic relief: a valley floor, a ridge, and one sharp distant peak. */
function synthElevation(peak?: { east: number; north: number; height: number }): ElevationSampler {
  return (east, north) => {
    const d = Math.hypot(east, north);
    let z =
      2600 +
      420 * Math.sin(east / 900) * Math.cos(north / 1100) +
      900 * Math.exp(-((d - 7000) ** 2) / (2 * 4000 ** 2));
    if (peak) {
      const pd = Math.hypot(east - peak.east, north - peak.north);
      z += (peak.height - 2600) * Math.exp(-(pd ** 2) / (2 * 1800 ** 2));
    }
    return z;
  };
}

/** A small config so ray-intersection tests can brute-force every triangle. */
const SMALL: FarFieldBakeConfig = {
  slug: "test-resort",
  centre: [-32.842, -70.129],
  radiusM: 3000,
  wedgeCount: 4,
  demSource: "synthetic",
  bands: [
    { untilM: 300, cellM: 16 },
    { untilM: 1000, cellM: 48 },
    { untilM: 3000, cellM: 128 },
  ],
};

// ─── Ring grading ────────────────────────────────────────────

test("the ring band table matches VISUALS-DESIGN §3: 16/48/128/256 m at 0.5/2/6/15/30 km", () => {
  assert.deepEqual(
    FAR_FIELD_RING_BANDS,
    [
      { untilM: 500, cellM: 16 },
      { untilM: 2000, cellM: 48 },
      { untilM: 6000, cellM: 128 },
      { untilM: 15000, cellM: 256 },
      { untilM: 30000, cellM: 256 },
    ],
  );
});

test("cellSizeAt reads the band table at and across every boundary", () => {
  assert.equal(cellSizeAt(0, FAR_FIELD_RING_BANDS), 16);
  assert.equal(cellSizeAt(499, FAR_FIELD_RING_BANDS), 16);
  assert.equal(cellSizeAt(500, FAR_FIELD_RING_BANDS), 48, "the band end belongs to the next band");
  assert.equal(cellSizeAt(1999, FAR_FIELD_RING_BANDS), 48);
  assert.equal(cellSizeAt(2000, FAR_FIELD_RING_BANDS), 128);
  assert.equal(cellSizeAt(5999, FAR_FIELD_RING_BANDS), 128);
  assert.equal(cellSizeAt(6000, FAR_FIELD_RING_BANDS), 256);
  assert.equal(cellSizeAt(29999, FAR_FIELD_RING_BANDS), 256);
});

test("ring radii step by the band cell size and land exactly on band boundaries", () => {
  const inner = innerRadiusFor(FAR_FIELD_RING_BANDS);
  const radii = buildRingRadii(inner, 30_000, FAR_FIELD_RING_BANDS);

  assert.equal(radii[0], inner);
  assert.equal(radii[radii.length - 1], 30_000);
  for (const boundary of [500, 2000, 6000, 15_000]) {
    assert.ok(radii.includes(boundary), `ring radii should include the ${boundary} m band boundary`);
  }
  for (let i = 1; i < radii.length; i++) {
    const step = radii[i] - radii[i - 1];
    assert.ok(step > 0, `radii must strictly increase at ${i}`);
    // The step never exceeds the cell size of the band it starts in.
    assert.ok(
      step <= cellSizeAt(radii[i - 1], FAR_FIELD_RING_BANDS) + 1e-9,
      `step ${step} at r=${radii[i - 1]} exceeds its ${cellSizeAt(radii[i - 1], FAR_FIELD_RING_BANDS)} m cell`,
    );
  }
});

test("angular segments keep arc length near the cell size and never decrease outward", () => {
  const inner = innerRadiusFor(FAR_FIELD_RING_BANDS);
  const radii = buildRingRadii(inner, 30_000, FAR_FIELD_RING_BANDS);
  let prev = 0;
  for (const r of radii) {
    const segments = segmentsForRing(r, FAR_FIELD_RING_BANDS, WEDGE_COUNT, prev);
    assert.ok(segments >= prev, `segments must not decrease outward at r=${r}`);
    if (r === 0) {
      assert.equal(segments, 0, "the centre ring is one shared vertex, not a segment");
      continue;
    }
    assert.ok(segments >= 1);
    const arc = ((2 * Math.PI) / WEDGE_COUNT) * r / segments;
    assert.ok(
      arc <= cellSizeAt(r, FAR_FIELD_RING_BANDS) * ARC_CELLS + 1e-9,
      `arc ${arc} m at r=${r} exceeds ${ARC_CELLS}× its cell size`,
    );
    prev = segments;
  }
});

// ─── Wedge tiling ────────────────────────────────────────────

test("wedge azimuths tile 2π exactly, with no gap and no overlap", () => {
  const wedges = buildWedges(SMALL, synthElevation());
  assert.equal(wedges.length, SMALL.wedgeCount);
  assert.equal(wedges[0].azimuthStartRad, 0);
  assert.equal(wedges[wedges.length - 1].azimuthEndRad, 2 * Math.PI);
  for (let w = 0; w < wedges.length; w++) {
    assert.equal(wedges[w].index, w);
    if (w > 0) {
      assert.equal(
        wedges[w].azimuthStartRad,
        wedges[w - 1].azimuthEndRad,
        `wedge ${w} must start exactly where wedge ${w - 1} ends`,
      );
    }
  }
});

test("adjacent wedges share their boundary vertices exactly, so the seams are watertight", () => {
  const wedges = buildWedges(SMALL, synthElevation());
  assertWatertight(wedges, 1e-6);
});

test("the seams survive the wire format — the shipped asset is what has to be watertight", () => {
  // buildWedges output is exact; what ships is u16-quantised against each wedge's own bounds, and
  // neighbouring wedges have different bounds, so a shared edge is rounded twice, independently.
  // That is the seam error a player can actually see, so it is the one worth a budget.
  const built = bakeFarField(SMALL, synthElevation(), { demSource: "synthetic" });
  const decoded = decodeFarField(built.bytes);
  const worst = assertWatertight(decoded.wedges, 0.5);
  assert.ok(worst > 0, "a quantised round trip cannot be bit-exact; the test is measuring nothing");
});

/** Largest gap between the shared boundary columns of adjacent wedges, metres. */
function assertWatertight(wedges: FarFieldWedge[], toleranceM: number): number {
  let worst = 0;
  for (let w = 0; w < wedges.length; w++) {
    const next = wedges[(w + 1) % wedges.length];
    // Every vertex of `w` on its end azimuth must line up with one in `next`.
    const edge = verticesOnAzimuth(wedges[w], wedges[w].azimuthEndRad, toleranceM);
    const neighbour = verticesOnAzimuth(next, next.azimuthStartRad, toleranceM);
    assert.ok(edge.length > 10, `wedge ${w} should have a populated boundary column`);
    assert.equal(edge.length, neighbour.length, `wedge ${w}/${w + 1} boundary column lengths differ`);
    for (let i = 0; i < edge.length; i++) {
      for (let k = 0; k < 3; k++) {
        const gap = Math.abs(edge[i][k] - neighbour[i][k]);
        worst = Math.max(worst, gap);
        assert.ok(
          gap <= toleranceM,
          `wedge ${w}/${w + 1} boundary vertex ${i} component ${k} differs by ${gap} m`,
        );
      }
    }
  }
  return worst;
}

/** Vertices whose azimuth equals `az`, sorted by radius. */
function verticesOnAzimuth(
  wedge: { positions: Float32Array },
  az: number,
  toleranceM: number,
): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  const wantX = Math.sin(az);
  const wantZ = -Math.cos(az);
  for (let i = 0; i < wedge.positions.length; i += 3) {
    const x = wedge.positions[i];
    const z = wedge.positions[i + 2];
    const r = Math.hypot(x, z);
    if (r < 1) continue; // the shared centre vertex has no azimuth
    // Quantisation nudges a boundary vertex off its exact bearing by up to `toleranceM`.
    const slack = Math.max(1e-6, toleranceM / r);
    if (Math.abs(x / r - wantX) < slack && Math.abs(z / r - wantZ) < slack) {
      out.push([x, wedge.positions[i + 1], z]);
    }
  }
  out.sort((a, b) => Math.hypot(a[0], a[2]) - Math.hypot(b[0], b[2]));
  return out;
}

test("every triangle faces upward, so the mesh is not inside out", () => {
  const wedges = buildWedges(SMALL, synthElevation());
  for (const wedge of wedges) {
    for (let t = 0; t < wedge.indices.length; t += 3) {
      const n = triangleNormal(wedge.positions, wedge.indices, t);
      assert.ok(n > 0, `triangle ${t / 3} has a downward normal (${n})`);
    }
  }
});

/** Y component of the (unnormalised) face normal, positive when facing up. */
function triangleNormal(positions: Float32Array, indices: Uint32Array, t: number): number {
  const a = indices[t] * 3;
  const b = indices[t + 1] * 3;
  const c = indices[t + 2] * 3;
  const abx = positions[b] - positions[a];
  const abz = positions[b + 2] - positions[a + 2];
  const acx = positions[c] - positions[a];
  const acz = positions[c + 2] - positions[a + 2];
  // (ab × ac).y = abz*acx - abx*acz
  return abz * acx - abx * acz;
}

test("no triangle is degenerate", () => {
  const wedges = buildWedges(SMALL, synthElevation());
  for (const wedge of wedges) {
    for (let t = 0; t < wedge.indices.length; t += 3) {
      const [a, b, c] = [wedge.indices[t], wedge.indices[t + 1], wedge.indices[t + 2]];
      assert.ok(a !== b && b !== c && a !== c, `triangle ${t / 3} repeats a vertex`);
    }
  }
});

// ─── The inner hole and the near-field seam ──────────────────

test("the near-field extent is derived from the live TerrainRenderer tile grid", () => {
  // The tile grid is asymmetric in z (`dz` runs from -Z_TILES_BEHIND upward), so
  // the guaranteed coverage behind the player is the binding constraint.
  assert.equal(TILE_SIZE, 200);
  assert.equal(GRID_SIZE, 5);
  assert.equal(Z_TILES_BEHIND, 1);
  assert.equal(NEAR_FIELD_GUARANTEED_RADIUS_M, Z_TILES_BEHIND * TILE_SIZE);
});

test("there is no inner hole: the far field is baked from the resort centre outwards", () => {
  assert.equal(innerRadiusFor(FAR_FIELD_RING_BANDS), 0);
  assert.equal(FAR_FIELD_INNER_RADIUS_M, 0);
  const radii = buildRingRadii(innerRadiusFor(SMALL.bands), SMALL.radiusM, SMALL.bands);
  assert.equal(radii[0], 0, "the first ring must be the centre itself");
});

test("no point the near field can cover is left uncovered by the far field", () => {
  // The near-field tile grid follows the PLAYER while the asset is anchored to the RESORT, so a
  // resort-centred hole is uncovered as soon as the player moves. The property that has to hold
  // is that the far field's surface exists directly beneath every point the player can stand.
  const elevation = synthElevation();
  const wedges = buildWedges(SMALL, elevation);
  const down: [number, number, number] = [0, -1, 0];
  for (let ai = 0; ai < 32; ai += 1) {
    const az = (ai / 32) * 2 * Math.PI;
    // Sweep from the exact centre out past the near field's guaranteed reach.
    for (const r of [0, 1, 5, 25, 80, 150, NEAR_FIELD_GUARANTEED_RADIUS_M, 400, 600]) {
      const x = r * Math.sin(az);
      const z = -r * Math.cos(az);
      const hit = firstMeshHit(wedges, [x, 12_000, z], down);
      assert.ok(hit !== null, `no far-field surface under (r=${r}, az=${az.toFixed(2)})`);
    }
  }
});

test("no ray from eye height escapes to the sky through the near/far seam", () => {
  const elevation = synthElevation();
  const wedges = buildWedges(SMALL, elevation);
  const inner = innerRadiusFor(SMALL.bands);
  const escapes = seamEscapes(wedges, elevation, inner, NEAR_FIELD_GUARANTEED_RADIUS_M, SMALL.radiusM);
  assert.deepEqual(escapes, [], `${escapes.length} rays escaped through the seam`);
});

test("the seam test bites: removing the overlap opens a hole a ray escapes through", () => {
  const elevation = synthElevation();
  // Rebuild with the far field starting exactly at the near-field rim and
  // coarsened, which is what the one-cell overlap exists to prevent.
  const flush: FarFieldBakeConfig = {
    ...SMALL,
    bands: [{ untilM: 800, cellM: 200 }, ...SMALL.bands.slice(1)],
  };
  const wedges = buildWedges(flush, elevation, NEAR_FIELD_GUARANTEED_RADIUS_M + 40);
  const escapes = seamEscapes(
    wedges,
    elevation,
    NEAR_FIELD_GUARANTEED_RADIUS_M + 40,
    NEAR_FIELD_GUARANTEED_RADIUS_M,
    flush.radiusM,
  );
  assert.ok(escapes.length > 0, "a detached far field should leak sky at the seam");
});

/**
 * Rays that reach the sky without hitting either mesh. The near field is modelled
 * as the exact elevation function inside `nearRadius` (it is far denser than the
 * far field, so treating it as exact is the conservative choice); the far field is
 * tested by true ray/triangle intersection against the baked geometry.
 */
function seamEscapes(
  wedges: ReturnType<typeof buildWedges>,
  elevation: ElevationSampler,
  innerRadius: number,
  nearRadius: number,
  outerRadius: number,
): string[] {
  const escapes: string[] = [];
  const eyeHeight = 1.7; // a standing skier; the camera presets sit higher
  for (let ai = 0; ai < 24; ai++) {
    const az = (ai / 24) * 2 * Math.PI;
    const dirX = Math.sin(az);
    const dirZ = -Math.cos(az);
    const originY = elevation(0, 0) + eyeHeight;
    for (let pi = 1; pi <= 40; pi++) {
      // Shallow downward pitches are the ones that graze the seam.
      const pitch = -(pi / 40) * (12 * Math.PI) / 180;
      const dy = Math.sin(pitch);
      const horiz = Math.cos(pitch);
      // Where the true surface stops this ray, if anywhere inside the far field.
      const trueHit = marchTrueSurface(elevation, originY, dirX, dirZ, dy, horiz, outerRadius);
      if (trueHit === null) continue; // legitimately above the horizon
      if (trueHit <= nearRadius) continue; // the near field owns it
      const meshHit = firstMeshHit(wedges, [0, originY, 0], [dirX * horiz, dy, dirZ * horiz]);
      if (meshHit === null) {
        escapes.push(`az=${az.toFixed(3)} pitch=${pitch.toFixed(4)} trueHit=${trueHit.toFixed(1)}m`);
      }
    }
  }
  void innerRadius;
  return escapes;
}

/** Horizontal distance at which the ray first goes under the true surface. */
function marchTrueSurface(
  elevation: ElevationSampler,
  originY: number,
  dirX: number,
  dirZ: number,
  dy: number,
  horiz: number,
  outerRadius: number,
): number | null {
  for (let d = 1; d <= outerRadius; d += 2) {
    const y = originY + (d / horiz) * dy;
    // Sampler is ENU: east = x, north = -z.
    if (y <= elevation(dirX * d, -dirZ * d)) return d;
  }
  return null;
}

// ─── Full bake ───────────────────────────────────────────────

test("bakes every pilot resort inside the size budget and the quantisation budget", () => {
  for (const slug of Object.keys(FAR_FIELD_BAKE_CONFIGS)) {
    const config = FAR_FIELD_BAKE_CONFIGS[slug];
    const result = bakeFarField(config, synthElevation(), { demSource: "synthetic" });

    // Not just "under the gate": u16 position codes are incompressible, so the
    // size is ~6 bytes × vertices and real relief will not shrink it. Keep a
    // real margin, or the gate first fires on the orchestrator's live bake.
    assert.ok(
      result.compressed.byteLength <= MAX_COMPRESSED_BYTES * 0.85,
      `${slug}: ${result.compressed.byteLength} brotli bytes leaves too little margin ` +
        `under the ${MAX_COMPRESSED_BYTES}-byte gate`,
    );
    assert.ok(result.maxQuantisationErrorM < 0.25, `${slug}: ${result.maxQuantisationErrorM} m error`);

    // The asserted figure must be the real one, computed from the baked geometry.
    let worst = 0;
    for (const wedge of result.wedges) {
      worst = Math.max(worst, wedgeQuantisationErrorM(computeWedgeBounds(wedge.positions)).max);
    }
    assert.equal(result.maxQuantisationErrorM, worst);
  }
});

test("a bake round-trips through the wire format with its meta intact", () => {
  const config = FAR_FIELD_BAKE_CONFIGS["ski-portillo"];
  const result = bakeFarField(config, synthElevation(), { demSource: "synthetic" });
  const decoded = decodeFarField(result.bytes);

  assert.equal(decoded.meta.slug, config.slug);
  assert.equal(decoded.meta.radiusM, config.radiusM);
  assert.equal(decoded.meta.wedgeCount, WEDGE_COUNT);
  assert.deepEqual(decoded.meta.centre, config.centre);
  assert.equal(decoded.meta.demSource, "synthetic", "meta records the DEM actually read");
  assert.equal(decoded.wedges.length, WEDGE_COUNT);
  assert.equal(decoded.meta.bakedAt, result.meta.bakedAt);
});

test("the size gate fails loudly rather than warning", () => {
  assert.throws(
    () => bakeFarField(SMALL, synthElevation(), { maxCompressedBytes: 1024, demSource: "synthetic" }),
    /exceeds the 1024-byte brotli budget/,
    "an over-budget bake must throw, not warn",
  );
});

test("the real budget is the plan's 400 KB", () => {
  assert.equal(MAX_COMPRESSED_BYTES, 400 * 1024);
});

// ─── Landmark verification ───────────────────────────────────

test("finds Aconcagua in a Portillo-shaped mesh at the right bearing and distance", () => {
  // Aconcagua: 6,961 m at -32.6533, -70.0109 — from Portillo's centre that is
  // ~23.7 km out on a bearing of ~28°, rising ~10° above the horizontal.
  const config = FAR_FIELD_BAKE_CONFIGS["ski-portillo"];
  const east = 11_054;
  const north = 20_970;
  const wedges = buildWedges(config, synthElevation({ east, north, height: 6961 }));

  const peak = findPeakNear(wedges, Math.atan2(east, north), Math.hypot(east, north), 2500, 2900);
  assert.ok(peak !== null, "the peak should be present in the baked geometry");
  assert.ok(peak.elevationM > 6500, `peak is only ${peak.elevationM} m`);
  assert.ok(Math.abs(peak.distanceM - 23_700) < 2000, `peak at ${peak.distanceM} m`);
  assert.ok(peak.elevationAngleDeg > 8 && peak.elevationAngleDeg < 12,
    `peak rises ${peak.elevationAngleDeg}° above the horizon`);
});

test("findPeakNear reports nothing when the mesh has no peak there", () => {
  const config = FAR_FIELD_BAKE_CONFIGS["ski-portillo"];
  const wedges = buildWedges(config, synthElevation());
  const peak = findPeakNear(wedges, Math.atan2(11_054, 20_970), 23_700, 2500, 2900);
  assert.ok(peak === null || peak.elevationM < 6000, "flat relief must not report a 7 km peak");
});

// ─── The bake output and the runtime fetch must name the same file ──

test("the baked filename, the loader's URL and the next.config brotli route all agree", async () => {
  const slug = "ski-portillo";

  // 1. What the baker writes. Captured from the real write path, not a restated literal.
  const written: string[] = [];
  const realWriteFileSync = fs.writeFileSync;
  const result = bakeFarField(SMALL, synthElevation(), { demSource: "synthetic" });
  (fs as { writeFileSync: typeof fs.writeFileSync }).writeFileSync = ((file: string) => {
    written.push(path.basename(String(file)));
  }) as typeof fs.writeFileSync;
  try {
    writeFarFieldOutputs(slug, SMALL, result);
  } finally {
    (fs as { writeFileSync: typeof fs.writeFileSync }).writeFileSync = realWriteFileSync;
  }
  assert.ok(written.includes(`${slug}.far.bin.br`), `baker wrote ${written.join(", ")}`);

  // 2. What the runtime asks for.
  const requested: string[] = [];
  await new FarFieldAssetLoader(async (input) => {
    requested.push(String(input));
    return { ok: false, status: 404 } as unknown as Response;
  }).load(slug, { expect: { centre: SMALL.centre, radiusM: SMALL.radiusM }, onWarn: () => {} });

  // The defect this pins: the baker emitted `<slug>-far.bin.br` while the loader
  // fetched `<slug>.far.bin.br`. A 404 degrades silently to the ridge bands, so
  // the drift was invisible from a browser — it looked like a working fallback.
  const url = new URL(requested[0], "https://peakcam.local");
  assert.equal(url.pathname, farFieldAssetUrl(slug));
  assert.equal(url.searchParams.get("course"), String(COURSE_VERSION));
  assert.equal(path.basename(url.pathname), written.find((f) => f.endsWith(".br")));

  // 3. What Next serves it as. Without the `Content-Encoding: br` header the browser
  // hands the loader compressed bytes and `decodeFarField` rejects them as bad magic.
  const config = fs.readFileSync(path.join(ROOT, "next.config.ts"), "utf8");
  const sources = [...config.matchAll(/source:\s*"([^"]+)"/g)].map((m) => m[1]);
  const matching = sources.filter((source) => source.replace(":slug", slug) === farFieldAssetUrl(slug));
  assert.equal(matching.length, 1, `no next.config route serves ${farFieldAssetUrl(slug)}; saw ${sources.join(", ")}`);
  const rule = config.slice(config.indexOf(`source: "${matching[0]}"`));
  assert.match(rule.slice(0, 400), /Content-Encoding", value: "br"/);
});

// ─── Provenance ──────────────────────────────────────────────

test("a bake refuses to ship without naming the DEM it actually read", () => {
  // meta.demSource is the asset's provenance and feeds attributionFor's licence notice, so a
  // plausible-looking wrong value is worse than a loud failure. Every static config carries the
  // sentinel; only the CLI, which has seen the raster, can replace it.
  assert.equal(FAR_FIELD_BAKE_CONFIGS["ski-portillo"].demSource, UNSPECIFIED_DEM_SOURCE);
  assert.equal(FAR_FIELD_BAKE_CONFIGS["breckenridge"].demSource, UNSPECIFIED_DEM_SOURCE);
  assert.throws(
    () => bakeFarField(SMALL, synthElevation(), { demSource: UNSPECIFIED_DEM_SOURCE }),
    /provenance/,
  );
  assert.throws(
    () => bakeFarField({ ...SMALL, demSource: UNSPECIFIED_DEM_SOURCE }, synthElevation()),
    /provenance/,
  );
});

test("resolveDemSource prefers an explicit id and otherwise describes the raster read", () => {
  const raster = { file: "/tmp/ski-portillo-far-dem.tif", resolutionM: 10 };
  assert.equal(resolveDemSource("usgs-3dep-13arcsec", raster), "usgs-3dep-13arcsec");
  assert.equal(resolveDemSource("  usgs-3dep-13arcsec  ", raster), "usgs-3dep-13arcsec");
  // No guessing: with no id, describe what was on disk rather than name a catalogue product.
  assert.equal(resolveDemSource(undefined, raster), "ski-portillo-far-dem@10m");
  assert.equal(resolveDemSource("", raster), "ski-portillo-far-dem@10m");
  assert.equal(
    resolveDemSource(undefined, { file: "a/b/glo30.tif", resolutionM: 30.922 }),
    "glo30@30.922m",
  );
});
