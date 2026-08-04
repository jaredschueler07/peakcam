import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FAR_FIELD_FORMAT_VERSION,
  FAR_FIELD_HEADER_BYTES,
  FAR_FIELD_MAGIC,
  FAR_FIELD_WEDGE_ENTRY_BYTES,
  FarFieldDecodeError,
  MAX_WEDGES,
  U16_CODES,
  U16_INDEX_LIMIT,
  WEDGE_FLAG_U16_INDICES,
  computeWedgeBounds,
  decodeFarField,
  encodeFarField,
  encodedFarFieldSize,
  validateFarFieldForResort,
  wedgeQuantisationErrorM,
  type FarFieldMeta,
  type FarFieldWedge,
} from "./far-field-format";

// ─── Fixtures ────────────────────────────────────────────────

const META: FarFieldMeta = {
  slug: "ski-portillo",
  radiusM: 30_000,
  wedgeCount: 2,
  centre: [-32.8355, -70.1287],
  demSource: "copernicus-glo30",
  bakedAt: "2026-08-02T12:00:00.000Z",
};

/**
 * A synthetic annular-sector wedge: `rings × spokes` vertices laid out on a
 * polar grid between `innerR` and `outerR`, with a wavy surface, triangulated
 * into a quad grid. Positions are game-world metres (x east, y up, z south).
 */
function makeWedge(
  index: number,
  azimuthStartRad: number,
  azimuthEndRad: number,
  opts: { rings?: number; spokes?: number; innerR?: number; outerR?: number } = {},
): FarFieldWedge {
  const rings = opts.rings ?? 5;
  const spokes = opts.spokes ?? 4;
  const innerR = opts.innerR ?? 500;
  const outerR = opts.outerR ?? 30_000;

  const positions = new Float32Array(rings * spokes * 3);
  for (let r = 0; r < rings; r++) {
    const radius = innerR + ((outerR - innerR) * r) / (rings - 1);
    for (let s = 0; s < spokes; s++) {
      const az =
        azimuthStartRad + ((azimuthEndRad - azimuthStartRad) * s) / (spokes - 1);
      const o = (r * spokes + s) * 3;
      positions[o] = radius * Math.sin(az); // x east
      positions[o + 1] = 2200 + 900 * Math.sin(radius / 4000) * Math.cos(az * 3); // y up
      positions[o + 2] = -radius * Math.cos(az); // z south (azimuth 0 = north = -z)
    }
  }

  const indices: number[] = [];
  for (let r = 0; r < rings - 1; r++) {
    for (let s = 0; s < spokes - 1; s++) {
      const a = r * spokes + s;
      const b = a + 1;
      const c = a + spokes;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const bounds = computeWedgeBounds(positions);
  return {
    index,
    azimuthStartRad,
    azimuthEndRad,
    positions,
    indices: new Uint32Array(indices),
    minY: bounds.minY,
    maxY: bounds.maxY,
  };
}

const WEDGES: FarFieldWedge[] = [
  makeWedge(0, 0, Math.PI / 8),
  makeWedge(1, Math.PI / 8, Math.PI / 4, { rings: 3, spokes: 6, innerR: 800 }),
];

/** Per-axis worst-case round-trip error, including the final float32 rounding. */
function tolerance(wedge: FarFieldWedge): { x: number; y: number; z: number } {
  const err = wedgeQuantisationErrorM(computeWedgeBounds(wedge.positions));
  const f32Slop = 30_000 * 2 ** -23; // float32 has 24 significand bits
  return { x: err.x + f32Slop, y: err.y + f32Slop, z: err.z + f32Slop };
}

function assertWedgesEqual(actual: FarFieldWedge[], expected: FarFieldWedge[]): void {
  assert.equal(actual.length, expected.length);
  for (let w = 0; w < expected.length; w++) {
    const got = actual[w];
    const want = expected[w];
    assert.equal(got.index, want.index, `wedge ${w} index`);
    assert.equal(got.azimuthStartRad, want.azimuthStartRad, `wedge ${w} azimuthStart`);
    assert.equal(got.azimuthEndRad, want.azimuthEndRad, `wedge ${w} azimuthEnd`);
    assert.equal(got.minY, want.minY, `wedge ${w} minY`);
    assert.equal(got.maxY, want.maxY, `wedge ${w} maxY`);
    assert.deepEqual(got.indices, want.indices, `wedge ${w} indices`);

    assert.equal(got.positions.length, want.positions.length, `wedge ${w} vertex count`);
    const tol = tolerance(want);
    const perAxis = [tol.x, tol.y, tol.z];
    for (let i = 0; i < want.positions.length; i++) {
      const delta = Math.abs(got.positions[i] - want.positions[i]);
      assert.ok(
        delta <= perAxis[i % 3],
        `wedge ${w} position[${i}] off by ${delta} m (tolerance ${perAxis[i % 3]} m)`,
      );
    }
  }
}

// ─── Round trip ──────────────────────────────────────────────

test("round-trips two wedges: meta exact, indices exact, positions within quantisation tolerance", () => {
  const bytes = encodeFarField(WEDGES, META);
  const decoded = decodeFarField(bytes);

  assert.deepEqual(decoded.meta, { ...META, formatVersion: FAR_FIELD_FORMAT_VERSION });
  assertWedgesEqual(decoded.wedges, WEDGES);
});

test("emits typed-array views ready for THREE.BufferAttribute", () => {
  const decoded = decodeFarField(encodeFarField(WEDGES, META));
  for (const wedge of decoded.wedges) {
    assert.ok(wedge.positions instanceof Float32Array);
    assert.ok(wedge.indices instanceof Uint32Array);
    assert.equal(wedge.positions.length % 3, 0);
    assert.equal(wedge.indices.length % 3, 0);
  }
});

test("decodes a buffer with a non-zero byteOffset", () => {
  const bytes = encodeFarField(WEDGES, META);
  // Simulate a payload sliced out of a larger buffer, which shifts byteOffset.
  const padded = new Uint8Array(bytes.byteLength + 3);
  padded.set(bytes, 3);
  const decoded = decodeFarField(padded.subarray(3));
  assert.deepEqual(decoded.meta, { ...META, formatVersion: FAR_FIELD_FORMAT_VERSION });
  assertWedgesEqual(decoded.wedges, WEDGES);
});

test("round-trips non-ASCII strings", () => {
  const meta: FarFieldMeta = {
    ...META,
    wedgeCount: 1,
    slug: "portillo-ñandú",
    demSource: "copernicus-glo30 (Ñ)",
  };
  const decoded = decodeFarField(encodeFarField([WEDGES[0]], meta));
  assert.equal(decoded.meta.slug, meta.slug);
  assert.equal(decoded.meta.demSource, meta.demSource);
});

test("round-trips an empty wedge (nothing survived culling in that azimuth range)", () => {
  const empty: FarFieldWedge = {
    index: 0,
    azimuthStartRad: 0,
    azimuthEndRad: Math.PI / 8,
    positions: new Float32Array(0),
    indices: new Uint32Array(0),
    minY: 0,
    maxY: 0,
  };
  const decoded = decodeFarField(encodeFarField([empty], { ...META, wedgeCount: 1 }));
  assert.equal(decoded.wedges.length, 1);
  assert.equal(decoded.wedges[0].positions.length, 0);
  assert.equal(decoded.wedges[0].indices.length, 0);
  assert.equal(decoded.wedges[0].minY, 0);
  assert.equal(decoded.wedges[0].maxY, 0);
});

test("a degenerate axis (all vertices coplanar) round-trips exactly", () => {
  const flat: FarFieldWedge = {
    index: 0,
    azimuthStartRad: 0,
    azimuthEndRad: Math.PI / 8,
    // Three vertices sharing one elevation: the Y range is zero.
    positions: new Float32Array([0, 2500, 0, 100, 2500, -50, 50, 2500, -100]),
    indices: new Uint32Array([0, 1, 2]),
    minY: 2500,
    maxY: 2500,
  };
  const decoded = decodeFarField(encodeFarField([flat], { ...META, wedgeCount: 1 }));
  const got = decoded.wedges[0];
  assert.equal(got.minY, 2500);
  assert.equal(got.maxY, 2500);
  for (let i = 1; i < got.positions.length; i += 3) {
    assert.equal(got.positions[i], 2500);
  }
});

// ─── Index width ─────────────────────────────────────────────

test("small wedges store u16 indices; the decoder still yields Uint32Array", () => {
  const bytes = encodeFarField(WEDGES, META);
  assert.equal(bytes.byteLength, encodedFarFieldSize(WEDGES, META));

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const stringBytes =
    view.getUint32(8, true) + view.getUint32(12, true) + view.getUint32(16, true);
  const tableOffset = align4(FAR_FIELD_HEADER_BYTES + stringBytes);
  for (let w = 0; w < WEDGES.length; w++) {
    const flags = view.getUint32(tableOffset + w * FAR_FIELD_WEDGE_ENTRY_BYTES + 12, true);
    assert.equal(flags, WEDGE_FLAG_U16_INDICES, `wedge ${w} should use u16 indices`);
  }

  const decoded = decodeFarField(bytes);
  assertWedgesEqual(decoded.wedges, WEDGES);
});

test("a wedge past the u16 vertex limit falls back to u32 indices", () => {
  const vertexCount = U16_INDEX_LIMIT + 1;
  const positions = new Float32Array(vertexCount * 3);
  for (let v = 0; v < vertexCount; v++) {
    positions[v * 3] = v; // a degenerate strip is enough; only the width matters
    positions[v * 3 + 1] = 2000 + (v % 97);
    positions[v * 3 + 2] = -v;
  }
  const bounds = computeWedgeBounds(positions);
  const wedge: FarFieldWedge = {
    index: 0,
    azimuthStartRad: 0,
    azimuthEndRad: Math.PI / 8,
    positions,
    indices: new Uint32Array([0, 1, vertexCount - 1]),
    minY: bounds.minY,
    maxY: bounds.maxY,
  };

  const bytes = encodeFarField([wedge], { ...META, wedgeCount: 1 });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const stringBytes =
    view.getUint32(8, true) + view.getUint32(12, true) + view.getUint32(16, true);
  const tableOffset = align4(FAR_FIELD_HEADER_BYTES + stringBytes);
  assert.equal(view.getUint32(tableOffset + 12, true), 0, "should not set the u16 flag");

  const decoded = decodeFarField(bytes);
  assert.deepEqual(decoded.wedges[0].indices, wedge.indices);
});

test("rejects an index width that disagrees with the vertex count", () => {
  assertRejects(
    corrupt((_b, view) => {
      const stringBytes =
        view.getUint32(8, true) + view.getUint32(12, true) + view.getUint32(16, true);
      view.setUint32(align4(FAR_FIELD_HEADER_BYTES + stringBytes) + 12, 0, true);
    }),
    "malformed",
  );
});

test("rejects unknown wedge flag bits", () => {
  assertRejects(
    corrupt((_b, view) => {
      const stringBytes =
        view.getUint32(8, true) + view.getUint32(12, true) + view.getUint32(16, true);
      const entry = align4(FAR_FIELD_HEADER_BYTES + stringBytes) + 12;
      view.setUint32(entry, WEDGE_FLAG_U16_INDICES | 0x80, true);
    }),
    "malformed",
  );
});

// ─── Quantisation budget ─────────────────────────────────────

test("worst-case quantisation error at a 30 km radius stays well under a metre", () => {
  // The largest possible per-wedge axis extent is the full radius: a 22.5°
  // wedge that straddles an axis spans [0, R] on it. Y is bounded by the
  // elevation range, which is far smaller.
  const worst = wedgeQuantisationErrorM({
    minX: 0,
    maxX: 30_000,
    minY: 0,
    maxY: 5_000,
    minZ: -30_000,
    maxZ: 0,
  });
  assert.equal(worst.x, 30_000 / U16_CODES / 2);
  assert.ok(worst.max < 0.25, `worst-case error ${worst.max} m`);
});

// ─── Resort validation ───────────────────────────────────────

test("validateFarFieldForResort accepts the resort the asset claims", () => {
  const { meta } = decodeFarField(encodeFarField(WEDGES, META));
  validateFarFieldForResort(meta, {
    slug: "ski-portillo",
    centre: [-32.8355, -70.1287],
    radiusM: 30_000,
  });
});

test("validateFarFieldForResort rejects a mismatched slug, centre or radius", () => {
  const { meta } = decodeFarField(encodeFarField(WEDGES, META));
  const expected = {
    slug: "ski-portillo",
    centre: [-32.8355, -70.1287] as [number, number],
    radiusM: 30_000,
  };

  for (const wrong of [
    { ...expected, slug: "heavenly" },
    { ...expected, centre: [38.9353, -119.9399] as [number, number] },
    { ...expected, radiusM: 20_000 },
  ]) {
    assert.throws(
      () => validateFarFieldForResort(meta, wrong),
      (e: unknown) =>
        e instanceof FarFieldDecodeError && e.code === "resort-mismatch",
      `expected a resort-mismatch for ${JSON.stringify(wrong)}`,
    );
  }
});

// ─── Rejection of malformed input ────────────────────────────

function corrupt(mutate: (bytes: Uint8Array, view: DataView) => void): Uint8Array {
  const bytes = encodeFarField(WEDGES, META);
  mutate(bytes, new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  return bytes;
}

function assertRejects(bytes: Uint8Array, code: string): void {
  assert.throws(
    () => decodeFarField(bytes),
    (e: unknown) => {
      assert.ok(e instanceof FarFieldDecodeError, `expected FarFieldDecodeError, got ${e}`);
      assert.equal(e.code, code);
      return true;
    },
  );
}

test("rejects a buffer shorter than the header", () => {
  assertRejects(new Uint8Array(FAR_FIELD_HEADER_BYTES - 1), "truncated");
});

test("rejects a bad magic number", () => {
  assertRejects(
    corrupt((_b, view) => view.setUint32(0, FAR_FIELD_MAGIC ^ 0xff, false)),
    "bad-magic",
  );
});

test("rejects an unsupported format version", () => {
  assertRejects(
    corrupt((_b, view) => view.setUint8(4, FAR_FIELD_FORMAT_VERSION + 1)),
    "unsupported-version",
  );
});

test("rejects a truncated payload", () => {
  const bytes = encodeFarField(WEDGES, META);
  assertRejects(bytes.subarray(0, bytes.byteLength - 8), "truncated");
});

test("rejects trailing bytes after the last wedge", () => {
  const bytes = encodeFarField(WEDGES, META);
  const padded = new Uint8Array(bytes.byteLength + 4);
  padded.set(bytes, 0);
  assertRejects(padded, "count-mismatch");
});

test("rejects a wedge_count that disagrees with meta.wedgeCount", () => {
  // wedge_count lives at offset 5; the meta copy is what the header records,
  // so bumping it alone must not silently reinterpret the table.
  assertRejects(
    corrupt((_b, view) => view.setUint8(5, MAX_WEDGES + 1)),
    "malformed",
  );
});

test("rejects a triangle index pointing past the wedge's vertices", () => {
  const bytes = encodeFarField(WEDGES, META);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Find wedge 0's index block: header + strings + table, then its positions.
  const stringBytes =
    view.getUint32(8, true) + view.getUint32(12, true) + view.getUint32(16, true);
  const tableOffset = align4(FAR_FIELD_HEADER_BYTES + stringBytes);
  const payloadOffset = tableOffset + WEDGES.length * FAR_FIELD_WEDGE_ENTRY_BYTES;
  const vertexCount = view.getUint32(tableOffset + 4, true);
  const indexOffset = align4(payloadOffset + vertexCount * 6);
  view.setUint16(indexOffset, vertexCount, true); // one past the last valid vertex
  assertRejects(bytes, "out-of-bounds");
});

function align4(n: number): number {
  return (n + 3) & ~3;
}

test("rejects an index count that is not a multiple of three", () => {
  const bytes = encodeFarField(WEDGES, META);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const stringBytes =
    view.getUint32(8, true) + view.getUint32(12, true) + view.getUint32(16, true);
  const tableOffset = align4(FAR_FIELD_HEADER_BYTES + stringBytes);
  view.setUint32(tableOffset + 8, 7, true);
  assertRejects(bytes, "malformed");
});

test("rejects an out-of-order wedge index", () => {
  const bytes = encodeFarField(WEDGES, META);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const stringBytes =
    view.getUint32(8, true) + view.getUint32(12, true) + view.getUint32(16, true);
  const tableOffset = align4(FAR_FIELD_HEADER_BYTES + stringBytes);
  view.setUint32(tableOffset, 9, true);
  assertRejects(bytes, "malformed");
});

test("rejects a non-finite azimuth", () => {
  const bytes = encodeFarField(WEDGES, META);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const stringBytes =
    view.getUint32(8, true) + view.getUint32(12, true) + view.getUint32(16, true);
  const tableOffset = align4(FAR_FIELD_HEADER_BYTES + stringBytes);
  view.setFloat64(tableOffset + 16, Number.NaN, true);
  assertRejects(bytes, "malformed");
});

// ─── Encoder input validation ────────────────────────────────

test("encoder rejects a positions array whose length is not a multiple of three", () => {
  const bad: FarFieldWedge = { ...WEDGES[0], positions: new Float32Array(7) };
  assert.throws(() => encodeFarField([bad], { ...META, wedgeCount: 1 }), /multiple of 3/);
});

test("encoder rejects an index count that is not a multiple of three", () => {
  const bad: FarFieldWedge = { ...WEDGES[0], indices: new Uint32Array([0, 1]) };
  assert.throws(() => encodeFarField([bad], { ...META, wedgeCount: 1 }), /multiple of 3/);
});

test("encoder rejects a triangle index past the end of the vertex array", () => {
  const bad: FarFieldWedge = {
    ...WEDGES[0],
    indices: new Uint32Array([0, 1, WEDGES[0].positions.length / 3]),
  };
  assert.throws(() => encodeFarField([bad], { ...META, wedgeCount: 1 }), /out of range/);
});

test("encoder rejects meta.wedgeCount disagreeing with the wedge array", () => {
  assert.throws(() => encodeFarField(WEDGES, { ...META, wedgeCount: 5 }), /wedgeCount/);
});

test("encoder rejects wedges that are not in index order", () => {
  assert.throws(
    () => encodeFarField([WEDGES[1], WEDGES[0]], META),
    /index/,
  );
});

test("encoder rejects non-finite geometry", () => {
  const positions = Float32Array.from(WEDGES[0].positions);
  positions[4] = Number.NaN;
  assert.throws(
    () => encodeFarField([{ ...WEDGES[0], positions }], { ...META, wedgeCount: 1 }),
    /finite/,
  );
});

test("encoder rejects supplied Y bounds that do not bracket the geometry", () => {
  const bad: FarFieldWedge = { ...WEDGES[0], minY: 3000, maxY: 3001 };
  assert.throws(() => encodeFarField([bad], { ...META, wedgeCount: 1 }), /bracket/);
});
