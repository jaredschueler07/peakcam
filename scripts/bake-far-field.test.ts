import assert from "node:assert/strict";
import { test } from "node:test";

import { GRID_SIZE, TILE_SIZE, Z_TILES_BEHIND } from "@/lib/game/rendering/TerrainRenderer";
import {
  ARC_CELLS,
  FAR_FIELD_RING_BANDS,
  FAR_FIELD_BAKE_CONFIGS,
  MAX_COMPRESSED_BYTES,
  NEAR_FIELD_GUARANTEED_RADIUS_M,
  SEAM_OVERLAP_CELLS,
  WEDGE_COUNT,
  bakeFarField,
  buildRingRadii,
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
  for (let w = 0; w < wedges.length; w++) {
    const next = wedges[(w + 1) % wedges.length];
    // Every vertex of `w` on its end azimuth must exist verbatim in `next`.
    const edge = verticesOnAzimuth(wedges[w], wedges[w].azimuthEndRad);
    const neighbour = verticesOnAzimuth(next, next.azimuthStartRad);
    assert.ok(edge.length > 10, `wedge ${w} should have a populated boundary column`);
    assert.equal(edge.length, neighbour.length, `wedge ${w}/${w + 1} boundary column lengths differ`);
    for (let i = 0; i < edge.length; i++) {
      for (let k = 0; k < 3; k++) {
        assert.ok(
          Math.abs(edge[i][k] - neighbour[i][k]) < 1e-6,
          `wedge ${w}/${w + 1} boundary vertex ${i} component ${k} differs`,
        );
      }
    }
  }
});

/** Vertices whose azimuth equals `az`, sorted by radius. */
function verticesOnAzimuth(
  wedge: { positions: Float32Array },
  az: number,
): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  const wantX = Math.sin(az);
  const wantZ = -Math.cos(az);
  for (let i = 0; i < wedge.positions.length; i += 3) {
    const x = wedge.positions[i];
    const z = wedge.positions[i + 2];
    const r = Math.hypot(x, z);
    if (r < 1e-9) continue;
    if (Math.abs(x / r - wantX) < 1e-6 && Math.abs(z / r - wantZ) < 1e-6) {
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

test("the inner hole sits inside the near-field extent by the seam overlap", () => {
  const inner = innerRadiusFor(FAR_FIELD_RING_BANDS);
  assert.equal(
    inner,
    NEAR_FIELD_GUARANTEED_RADIUS_M - SEAM_OVERLAP_CELLS * FAR_FIELD_RING_BANDS[0].cellM,
  );
  assert.ok(
    inner < NEAR_FIELD_GUARANTEED_RADIUS_M,
    "the far field must start inside the near field's guaranteed coverage",
  );
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
    const result = bakeFarField(config, synthElevation());

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
  const result = bakeFarField(config, synthElevation());
  const decoded = decodeFarField(result.bytes);

  assert.equal(decoded.meta.slug, config.slug);
  assert.equal(decoded.meta.radiusM, config.radiusM);
  assert.equal(decoded.meta.wedgeCount, WEDGE_COUNT);
  assert.deepEqual(decoded.meta.centre, config.centre);
  assert.equal(decoded.meta.demSource, config.demSource);
  assert.equal(decoded.wedges.length, WEDGE_COUNT);
  assert.equal(decoded.meta.bakedAt, result.meta.bakedAt);
});

test("the size gate fails loudly rather than warning", () => {
  assert.throws(
    () => bakeFarField(SMALL, synthElevation(), { maxCompressedBytes: 1024 }),
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

  const peak = findPeakNear(wedges, Math.atan2(east, north), Math.hypot(east, north), 2500);
  assert.ok(peak !== null, "the peak should be present in the baked geometry");
  assert.ok(peak.elevationM > 6500, `peak is only ${peak.elevationM} m`);
  assert.ok(Math.abs(peak.distanceM - 23_700) < 2000, `peak at ${peak.distanceM} m`);
  assert.ok(peak.elevationAngleDeg > 8 && peak.elevationAngleDeg < 12,
    `peak rises ${peak.elevationAngleDeg}° above the horizon`);
});

test("findPeakNear reports nothing when the mesh has no peak there", () => {
  const config = FAR_FIELD_BAKE_CONFIGS["ski-portillo"];
  const wedges = buildWedges(config, synthElevation());
  const peak = findPeakNear(wedges, Math.atan2(11_054, 20_970), 23_700, 2500);
  assert.ok(peak === null || peak.elevationM < 6000, "flat relief must not report a 7 km peak");
});
