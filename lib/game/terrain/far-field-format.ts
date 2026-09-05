/**
 * lib/game/terrain/far-field-format.ts
 * ────────────────────────────────────
 * "PCFF" — the Drop In v2 binary far-field format (VISUALS-DESIGN.md §3).
 *
 * One file per resort holds the pre-baked coarse horizon mesh out to
 * `radiusM` (30 km), split into angular wedges so the renderer can frustum-cull
 * whole sectors. `scripts/bake-resort.ts` writes it; the runtime far-field
 * renderer reads it and hands the arrays straight to `THREE.BufferAttribute`.
 *
 * Pure TypeScript over `DataView`: no DOM, no three.js, no Node built-ins, so
 * the Node bake script and the browser runtime share this one implementation.
 * (`TextEncoder`/`TextDecoder` are WHATWG globals present in both.)
 *
 * ## Coordinate conventions (the single source of truth for orientation)
 *
 * Positions are **game-world metres relative to the resort centre**, in the
 * three.js Y-up frame the engine already uses (see `real-heightfield.ts`, which
 * maps the asset's north-up frame onto it):
 *
 *   x → east          y → up (elevation above sea level)          z → south
 *
 * Note that `z` is *south*, not north: asset y (north) becomes game z = -north.
 * `y` is absolute elevation in metres, not a height above the centre.
 *
 * Azimuth is a **compass bearing in radians**: 0 = north, increasing eastwards,
 * so a direction at azimuth `a` is `(sin a, ·, -cos a)`. Each wedge covers
 * `[azimuthStartRad, azimuthEndRad)`; the baker emits them in index order,
 * partitioning `[0, 2π)`.
 *
 * ## Layout (little-endian throughout, except the magic)
 *
 * Header — 52 bytes:
 * ```text
 * off  size  field
 *   0     4  magic             "PCFF" (big-endian, so it reads as ASCII)
 *   4     1  format_version    u8
 *   5     1  wedge_count       u8    1..MAX_WEDGES
 *   6     2  flags             u16   reserved; 0 today
 *   8     4  slug_bytes        u32   UTF-8 length
 *  12     4  dem_source_bytes  u32   UTF-8 length
 *  16     4  baked_at_bytes    u32   UTF-8 length
 *  20     4  total_vertices    u32   cross-check against the wedge table
 *  24     4  total_indices     u32   cross-check against the wedge table
 *  28     8  radius_m          f64
 *  36     8  centre_lat_deg    f64
 *  44     8  centre_lon_deg    f64
 * ```
 *
 * Then the three UTF-8 strings back to back (slug, dem_source, baked_at),
 * padded with zero bytes to the next 4-byte boundary.
 *
 * Then the wedge table — `wedge_count` entries of 80 bytes:
 * ```text
 *   0     4  index             u32   equals the entry's own slot
 *   4     4  vertex_count      u32
 *   8     4  index_count       u32   multiple of 3
 *  12     4  wedge_flags       u32   bit 0 = WEDGE_FLAG_U16_INDICES
 *  16     8  azimuth_start_rad f64   compass bearing, 0 = north
 *  24     8  azimuth_end_rad   f64
 *  32     8  min_x_m           f64   quantisation bounds, game-world metres
 *  40     8  max_x_m           f64
 *  48     8  min_y_m           f64
 *  56     8  max_y_m           f64
 *  64     8  min_z_m           f64
 *  72     8  max_z_m           f64
 * ```
 *
 * Then, per wedge in index order:
 * ```text
 *   vertex_count × 3 × u16      position codes, x/y/z interleaved
 *   (zero padding to the next 4-byte boundary)
 *   index_count × u16 or u32    triangle indices, CCW front faces
 *   (zero padding to the next 4-byte boundary)
 * ```
 *
 * Indices are u16 whenever the wedge has ≤ 65536 vertices, which at the §3
 * budget (~158k vertices over 16 wedges) is every wedge — and indices are the
 * bulk of the file, 6 bytes per vertex of positions against roughly 24 bytes of
 * u32 indices at 2 triangles per vertex. The decoder handles both widths and
 * always returns a `Uint32Array`, so the choice never reaches the renderer.
 *
 * Bounds are f64 so that a decode reproduces them bit-for-bit on any host and
 * the dequantisation is not itself a source of drift.
 *
 * ## Quantisation
 *
 * Each position axis is stored as a u16 code against **that wedge's own**
 * bounds: `code = round((v - min) / (max - min) * 65535)`, decoded as
 * `v = min + code * (max - min) / 65535`. Worst-case error is therefore half a
 * code, `(max - min) / 131070` metres.
 *
 * The largest extent a wedge can have is the full radius — a wedge straddling
 * an axis spans `[0, R]` on it — so at R = 30 km the worst case is
 *
 *   30000 / 65535 / 2 = **0.2289 m**
 *
 * on the horizontal axes, and much less vertically (a 5 km elevation range
 * gives 0.038 m). At 30 km that 0.229 m subtends 7.6 µrad ≈ 1.6 arcsec, some
 * two orders of magnitude below one pixel of a 1080p 60°-FOV frame — comfortably
 * under a metre, so per-wedge bounds are sufficient and per-ring bounds (which
 * would shrink the radial extent to one ring's width) are not needed.
 * {@link wedgeQuantisationErrorM} computes the real figure for a baked wedge;
 * the baker should assert on it rather than trusting this comment.
 *
 * ## Sizing
 *
 * At the §3 budget of ~158k stored vertices and ~2 triangles per vertex the
 * file is ~158k × 6 + ~948k × 2 ≈ 2.8 MB raw, well inside the ~250 KB brotli
 * target. {@link encodedFarFieldSize} reports the exact figure for a bake.
 */

// ─── Constants ───────────────────────────────────────────────

/** ASCII "PCFF". */
export const FAR_FIELD_MAGIC = 0x50434646;
/** Bumped whenever the byte layout changes; decoders reject anything else. */
export const FAR_FIELD_FORMAT_VERSION = 1;
/** Alias kept for callers that follow the brief's naming. */
export const FAR_FIELD_VERSION = FAR_FIELD_FORMAT_VERSION;

export const FAR_FIELD_HEADER_BYTES = 52;
export const FAR_FIELD_WEDGE_ENTRY_BYTES = 80;

/** Number of distinct u16 codes minus one — the top of the quantisation range. */
export const U16_CODES = 65535;

/** `wedge_flags` bit 0: this wedge's triangle indices are u16, not u32. */
export const WEDGE_FLAG_U16_INDICES = 1 << 0;
/** Above this vertex count a wedge must use u32 indices. */
export const U16_INDEX_LIMIT = 65536;

/** §3 bakes 16; the cap leaves room to experiment without widening the field. */
export const MAX_WEDGES = 64;
/** Corruption guards, not budgets: §3 targets ~158k vertices per resort total. */
export const MAX_VERTICES_PER_WEDGE = 1 << 21;
export const MAX_TOTAL_VERTICES = 8 << 20;
export const MAX_TOTAL_INDICES = 32 << 20;
/** UTF-8 byte cap for `slug` / `demSource` / `bakedAt`. */
export const MAX_STRING_BYTES = 256;
/** A far field beyond this is not a resort horizon; it is a corrupt header. */
export const MAX_RADIUS_M = 500_000;

// ─── Asset naming ────────────────────────────────────────────
//
// The baker writes these names and the runtime loader fetches them. They lived
// as separate string literals in `scripts/bake-far-field.ts` and
// `loaders/FarFieldAssetLoader.ts` and silently drifted apart — the baker emitted
// `<slug>-far.bin.br` while the loader requested `<slug>.far.bin.br`, a guaranteed
// 404 that degraded quietly to the procedural ridge bands and so looked, from a
// browser, exactly like a working fallback. One definition, imported by both.

/** Suffix of the baked asset. Also the tail of the `Content-Encoding: br` route in next.config. */
export const FAR_FIELD_FILE_SUFFIX = ".far.bin.br";
/** Suffix of the human-readable sidecar written beside it. */
export const FAR_FIELD_SIDECAR_SUFFIX = ".far.json";
/** Public directory the assets are served from, relative to the site root. */
export const FAR_FIELD_ASSET_DIR = "/game/terrain";

/** Filename the baker must emit for `slug`. */
export function farFieldAssetFile(slug: string): string {
  return `${slug}${FAR_FIELD_FILE_SUFFIX}`;
}

/** URL the runtime loader must fetch for `slug`. */
export function farFieldAssetUrl(slug: string): string {
  return `${FAR_FIELD_ASSET_DIR}/${farFieldAssetFile(slug)}`;
}

// ─── Types ───────────────────────────────────────────────────

/**
 * One angular sector of the far-field mesh.
 *
 * `positions` is x/y/z interleaved in game-world metres from the resort centre
 * (x east, y up, z south). `indices` are triangle indices into it, three per
 * face, wound counter-clockwise when viewed from the front.
 */
export interface FarFieldWedge {
  /** Slot in the wedge table; equals the array position. */
  index: number;
  /** Inclusive start of the sector, compass-bearing radians (0 = north). */
  azimuthStartRad: number;
  /** Exclusive end of the sector, compass-bearing radians. */
  azimuthEndRad: number;
  /** Interleaved x/y/z, metres, `3 × vertexCount` long. */
  positions: Float32Array;
  /** Triangle indices into `positions`, `3 × triangleCount` long. */
  indices: Uint32Array;
  /** Lowest elevation in the wedge, metres above sea level. */
  minY: number;
  /** Highest elevation in the wedge, metres above sea level. */
  maxY: number;
}

/** Everything the header carries about the asset as a whole. */
export interface FarFieldMeta {
  /** Resort slug this asset belongs to; the runtime must check it. */
  slug: string;
  /** Outer radius of the baked mesh, metres. */
  radiusM: number;
  /** Number of wedges; equals the wedge array's length. */
  wedgeCount: number;
  /** `[latitude, longitude]` of the resort centre, degrees. */
  centre: [number, number];
  /** DEM the mesh was derived from, e.g. `"3dep-1m"` or `"copernicus-glo30"`. */
  demSource: string;
  /** ISO-8601 timestamp of the bake. */
  bakedAt: string;
}

/** Meta as returned by {@link decodeFarField}, with the on-disk version. */
export interface DecodedFarFieldMeta extends FarFieldMeta {
  formatVersion: number;
}

export interface DecodedFarField {
  /** Optional validated topology-only visual LOD, referencing the same positions. */
  lodIndices?: Uint32Array[];
  meta: DecodedFarFieldMeta;
  wedges: FarFieldWedge[];
}

/** Axis-aligned bounds of a wedge's geometry, game-world metres. */
export interface WedgeBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export type FarFieldErrorCode =
  | "bad-magic"
  | "unsupported-version"
  | "truncated"
  | "malformed"
  | "count-mismatch"
  | "out-of-bounds"
  | "resort-mismatch";

/**
 * Thrown by {@link decodeFarField} and {@link validateFarFieldForResort}.
 * `code` is stable and safe to surface in a load-failure telemetry event.
 */
export class FarFieldDecodeError extends Error {
  readonly code: FarFieldErrorCode;

  constructor(code: FarFieldErrorCode, message: string) {
    super(message);
    this.name = "FarFieldDecodeError";
    this.code = code;
  }
}

// ─── Quantisation ────────────────────────────────────────────

/** Metres per u16 code for one axis; 0 when the axis is degenerate. */
function axisScale(min: number, max: number): number {
  const range = max - min;
  return range > 0 ? range / U16_CODES : 0;
}

/** Metres → u16 code against `[min, max]`. Clamped; a zero range yields 0. */
export function quantizeAxis(value: number, min: number, max: number): number {
  const range = max - min;
  if (!(range > 0)) return 0;
  const code = Math.round(((value - min) / range) * U16_CODES);
  return code < 0 ? 0 : code > U16_CODES ? U16_CODES : code;
}

/** Inverse of {@link quantizeAxis}. */
export function dequantizeAxis(code: number, min: number, max: number): number {
  return min + code * axisScale(min, max);
}

/** Tight axis-aligned bounds of an interleaved x/y/z position array. */
export function computeWedgeBounds(positions: Float32Array): WedgeBounds {
  if (positions.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

/**
 * Worst-case round-trip error per axis for these bounds, in metres — half a
 * quantisation step. `max` is the figure to assert against a budget.
 */
export function wedgeQuantisationErrorM(bounds: WedgeBounds): {
  x: number;
  y: number;
  z: number;
  max: number;
} {
  const x = axisScale(bounds.minX, bounds.maxX) / 2;
  const y = axisScale(bounds.minY, bounds.maxY) / 2;
  const z = axisScale(bounds.minZ, bounds.maxZ) / 2;
  return { x, y, z, max: Math.max(x, y, z) };
}

// ─── Resort validation ───────────────────────────────────────

/** Centre tolerance: ~0.1 m of latitude — far tighter than any bake jitter. */
const CENTRE_TOLERANCE_DEG = 1e-6;
/** Radius tolerance in metres. */
const RADIUS_TOLERANCE_M = 1;

/**
 * Assert that a decoded asset belongs to the resort about to render it, so the
 * runtime can never draw Heavenly's horizon at Portillo. Throws a
 * {@link FarFieldDecodeError} with code `resort-mismatch`.
 */
export function validateFarFieldForResort(
  meta: FarFieldMeta,
  expected: { slug: string; centre: [number, number]; radiusM: number },
): void {
  if (meta.slug !== expected.slug) {
    throw new FarFieldDecodeError(
      "resort-mismatch",
      `far field is baked for "${meta.slug}", not "${expected.slug}"`,
    );
  }
  const dLat = Math.abs(meta.centre[0] - expected.centre[0]);
  const dLon = Math.abs(meta.centre[1] - expected.centre[1]);
  if (dLat > CENTRE_TOLERANCE_DEG || dLon > CENTRE_TOLERANCE_DEG) {
    throw new FarFieldDecodeError(
      "resort-mismatch",
      `far field centre ${meta.centre[0]},${meta.centre[1]} does not match ` +
        `${expected.centre[0]},${expected.centre[1]} for "${expected.slug}"`,
    );
  }
  if (Math.abs(meta.radiusM - expected.radiusM) > RADIUS_TOLERANCE_M) {
    throw new FarFieldDecodeError(
      "resort-mismatch",
      `far field radius ${meta.radiusM} m does not match the expected ${expected.radiusM} m`,
    );
  }
}

// ─── Layout helpers ──────────────────────────────────────────

function align4(n: number): number {
  return (n + 3) & ~3;
}

const HOST_IS_LITTLE_ENDIAN =
  new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

// ─── Encode ──────────────────────────────────────────────────

/**
 * Byte length {@link encodeFarField} will produce. Exported so the baker can
 * report the asset size without encoding twice.
 */
export function encodedFarFieldSize(
  wedges: readonly FarFieldWedge[],
  meta: FarFieldMeta,
): number {
  const enc = new TextEncoder();
  const stringBytes =
    enc.encode(meta.slug).length +
    enc.encode(meta.demSource).length +
    enc.encode(meta.bakedAt).length;
  let size =
    align4(FAR_FIELD_HEADER_BYTES + stringBytes) +
    wedges.length * FAR_FIELD_WEDGE_ENTRY_BYTES;
  for (const wedge of wedges) {
    const indexWidth = usesU16Indices(wedge.positions.length / 3) ? 2 : 4;
    size +=
      align4(wedge.positions.length * 2) + align4(wedge.indices.length * indexWidth);
  }
  return size;
}

/** Whether a wedge with this many vertices stores its indices as u16. */
function usesU16Indices(vertexCount: number): boolean {
  return vertexCount <= U16_INDEX_LIMIT;
}

/**
 * Encode baked wedges into a PCFF buffer.
 *
 * Throws a plain `Error` on invalid input: the encoder's caller is the bake
 * script, so a failure here is a programmer error, not untrusted data. The
 * decoder, which does face untrusted data, throws {@link FarFieldDecodeError}.
 */
export function encodeFarField(
  wedges: readonly FarFieldWedge[],
  meta: FarFieldMeta,
): Uint8Array {
  if (wedges.length === 0) {
    throw new Error("encodeFarField: at least one wedge is required");
  }
  if (wedges.length > MAX_WEDGES) {
    throw new Error(
      `encodeFarField: ${wedges.length} wedges exceeds the ${MAX_WEDGES} limit`,
    );
  }
  if (meta.wedgeCount !== wedges.length) {
    throw new Error(
      `encodeFarField: meta.wedgeCount ${meta.wedgeCount} disagrees with ${wedges.length} wedges`,
    );
  }
  if (!Number.isFinite(meta.radiusM) || meta.radiusM <= 0 || meta.radiusM > MAX_RADIUS_M) {
    throw new Error(`encodeFarField: radiusM ${meta.radiusM} is outside (0, ${MAX_RADIUS_M}]`);
  }
  if (!Number.isFinite(meta.centre[0]) || !Number.isFinite(meta.centre[1])) {
    throw new Error("encodeFarField: centre must be finite [lat, lon]");
  }

  const enc = new TextEncoder();
  const slugBytes = encodeString(enc, meta.slug, "slug");
  const demBytes = encodeString(enc, meta.demSource, "demSource");
  const bakedAtBytes = encodeString(enc, meta.bakedAt, "bakedAt");

  // Validate every wedge up front so a malformed one cannot leave a
  // half-written buffer behind.
  const bounds: WedgeBounds[] = [];
  let totalVertices = 0;
  let totalIndices = 0;
  for (let w = 0; w < wedges.length; w++) {
    const wedge = wedges[w];
    if (wedge.index !== w) {
      throw new Error(
        `encodeFarField: wedge at slot ${w} carries index ${wedge.index}; wedges must be in index order`,
      );
    }
    if (wedge.positions.length % 3 !== 0) {
      throw new Error(
        `encodeFarField: wedge ${w} positions length ${wedge.positions.length} is not a multiple of 3`,
      );
    }
    if (wedge.indices.length % 3 !== 0) {
      throw new Error(
        `encodeFarField: wedge ${w} indices length ${wedge.indices.length} is not a multiple of 3`,
      );
    }
    const vertexCount = wedge.positions.length / 3;
    if (vertexCount > MAX_VERTICES_PER_WEDGE) {
      throw new Error(
        `encodeFarField: wedge ${w} has ${vertexCount} vertices, over the ${MAX_VERTICES_PER_WEDGE} limit`,
      );
    }
    if (!Number.isFinite(wedge.azimuthStartRad) || !Number.isFinite(wedge.azimuthEndRad)) {
      throw new Error(`encodeFarField: wedge ${w} has a non-finite azimuth`);
    }
    if (wedge.azimuthEndRad <= wedge.azimuthStartRad) {
      throw new Error(
        `encodeFarField: wedge ${w} azimuth range [${wedge.azimuthStartRad}, ${wedge.azimuthEndRad}) is empty or inverted`,
      );
    }
    for (let i = 0; i < wedge.positions.length; i++) {
      if (!Number.isFinite(wedge.positions[i])) {
        throw new Error(`encodeFarField: wedge ${w} position[${i}] is not finite`);
      }
    }
    for (let i = 0; i < wedge.indices.length; i++) {
      if (wedge.indices[i] >= vertexCount) {
        throw new Error(
          `encodeFarField: wedge ${w} index[${i}] = ${wedge.indices[i]} is out of range for ${vertexCount} vertices`,
        );
      }
    }

    // Bounds come from the geometry, so decode is self-consistent; the caller's
    // minY/maxY must agree, which catches a baker that computed them elsewhere.
    const b = computeWedgeBounds(wedge.positions);
    if (vertexCount === 0) {
      if (!Number.isFinite(wedge.minY) || !Number.isFinite(wedge.maxY)) {
        throw new Error(`encodeFarField: wedge ${w} has non-finite Y bounds`);
      }
      b.minY = wedge.minY;
      b.maxY = wedge.maxY;
    } else if (wedge.minY > b.minY || wedge.maxY < b.maxY) {
      throw new Error(
        `encodeFarField: wedge ${w} Y bounds [${wedge.minY}, ${wedge.maxY}] do not bracket ` +
          `the geometry's [${b.minY}, ${b.maxY}]`,
      );
    } else {
      // Honour a padded range so the round trip returns what the caller passed.
      b.minY = wedge.minY;
      b.maxY = wedge.maxY;
    }
    bounds.push(b);

    totalVertices += vertexCount;
    totalIndices += wedge.indices.length;
  }
  if (totalVertices > MAX_TOTAL_VERTICES) {
    throw new Error(
      `encodeFarField: ${totalVertices} vertices exceeds the ${MAX_TOTAL_VERTICES} limit`,
    );
  }
  if (totalIndices > MAX_TOTAL_INDICES) {
    throw new Error(
      `encodeFarField: ${totalIndices} indices exceeds the ${MAX_TOTAL_INDICES} limit`,
    );
  }

  const bytes = new Uint8Array(encodedFarFieldSize(wedges, meta));
  const view = new DataView(bytes.buffer);

  view.setUint32(0, FAR_FIELD_MAGIC, false); // reads as "PCFF" in a hex dump
  view.setUint8(4, FAR_FIELD_FORMAT_VERSION);
  view.setUint8(5, wedges.length);
  view.setUint16(6, 0, true); // flags
  view.setUint32(8, slugBytes.length, true);
  view.setUint32(12, demBytes.length, true);
  view.setUint32(16, bakedAtBytes.length, true);
  view.setUint32(20, totalVertices, true);
  view.setUint32(24, totalIndices, true);
  view.setFloat64(28, meta.radiusM, true);
  view.setFloat64(36, meta.centre[0], true);
  view.setFloat64(44, meta.centre[1], true);

  let offset = FAR_FIELD_HEADER_BYTES;
  bytes.set(slugBytes, offset);
  offset += slugBytes.length;
  bytes.set(demBytes, offset);
  offset += demBytes.length;
  bytes.set(bakedAtBytes, offset);
  offset += bakedAtBytes.length;
  offset = align4(offset); // the pad bytes are already zero

  const tableOffset = offset;
  let payloadOffset = tableOffset + wedges.length * FAR_FIELD_WEDGE_ENTRY_BYTES;

  for (let w = 0; w < wedges.length; w++) {
    const wedge = wedges[w];
    const b = bounds[w];
    const entry = tableOffset + w * FAR_FIELD_WEDGE_ENTRY_BYTES;
    const vertexCount = wedge.positions.length / 3;
    const u16Indices = usesU16Indices(vertexCount);

    view.setUint32(entry, w, true);
    view.setUint32(entry + 4, vertexCount, true);
    view.setUint32(entry + 8, wedge.indices.length, true);
    view.setUint32(entry + 12, u16Indices ? WEDGE_FLAG_U16_INDICES : 0, true);
    view.setFloat64(entry + 16, wedge.azimuthStartRad, true);
    view.setFloat64(entry + 24, wedge.azimuthEndRad, true);
    view.setFloat64(entry + 32, b.minX, true);
    view.setFloat64(entry + 40, b.maxX, true);
    view.setFloat64(entry + 48, b.minY, true);
    view.setFloat64(entry + 56, b.maxY, true);
    view.setFloat64(entry + 64, b.minZ, true);
    view.setFloat64(entry + 72, b.maxZ, true);

    for (let i = 0; i < wedge.positions.length; i += 3) {
      view.setUint16(payloadOffset + i * 2, quantizeAxis(wedge.positions[i], b.minX, b.maxX), true);
      view.setUint16(payloadOffset + i * 2 + 2, quantizeAxis(wedge.positions[i + 1], b.minY, b.maxY), true);
      view.setUint16(payloadOffset + i * 2 + 4, quantizeAxis(wedge.positions[i + 2], b.minZ, b.maxZ), true);
    }
    payloadOffset = align4(payloadOffset + wedge.positions.length * 2);

    if (u16Indices) {
      for (let i = 0; i < wedge.indices.length; i++) {
        view.setUint16(payloadOffset + i * 2, wedge.indices[i], true);
      }
      payloadOffset = align4(payloadOffset + wedge.indices.length * 2);
    } else {
      for (let i = 0; i < wedge.indices.length; i++) {
        view.setUint32(payloadOffset + i * 4, wedge.indices[i], true);
      }
      payloadOffset += wedge.indices.length * 4;
    }
  }

  return bytes;
}

function encodeString(enc: TextEncoder, value: string, field: string): Uint8Array {
  const out = enc.encode(value);
  if (out.length === 0) {
    throw new Error(`encodeFarField: ${field} must not be empty`);
  }
  if (out.length > MAX_STRING_BYTES) {
    throw new Error(
      `encodeFarField: ${field} is ${out.length} UTF-8 bytes, over the ${MAX_STRING_BYTES} limit`,
    );
  }
  return out;
}

// ─── Decode ──────────────────────────────────────────────────

/**
 * Decode and validate a PCFF buffer.
 *
 * Every failure raises a {@link FarFieldDecodeError} with a stable `code`; the
 * decoder never trusts a count, offset or index from the payload, so a corrupt
 * asset produces a rejection rather than a bad array read or a GPU-side crash.
 *
 * `positions` and `indices` come back as fresh `Float32Array` / `Uint32Array`
 * ready to hand to `THREE.BufferAttribute`.
 */
export function decodeFarField(bytes: Uint8Array): DecodedFarField {
  if (bytes.byteLength < FAR_FIELD_HEADER_BYTES) {
    throw new FarFieldDecodeError(
      "truncated",
      `far field is ${bytes.byteLength} bytes, shorter than the ${FAR_FIELD_HEADER_BYTES}-byte header`,
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (view.getUint32(0, false) !== FAR_FIELD_MAGIC) {
    throw new FarFieldDecodeError(
      "bad-magic",
      "far field does not start with the PCFF magic",
    );
  }

  const formatVersion = view.getUint8(4);
  if (formatVersion !== FAR_FIELD_FORMAT_VERSION) {
    throw new FarFieldDecodeError(
      "unsupported-version",
      `far field format version ${formatVersion} is not supported (expected ${FAR_FIELD_FORMAT_VERSION})`,
    );
  }

  const wedgeCount = view.getUint8(5);
  if (wedgeCount < 1 || wedgeCount > MAX_WEDGES) {
    throw new FarFieldDecodeError(
      "malformed",
      `wedge_count ${wedgeCount} is outside 1..${MAX_WEDGES}`,
    );
  }

  const slugBytes = view.getUint32(8, true);
  const demBytes = view.getUint32(12, true);
  const bakedAtBytes = view.getUint32(16, true);
  for (const [field, len] of [
    ["slug", slugBytes],
    ["dem_source", demBytes],
    ["baked_at", bakedAtBytes],
  ] as const) {
    if (len < 1 || len > MAX_STRING_BYTES) {
      throw new FarFieldDecodeError(
        "malformed",
        `${field} length ${len} is outside 1..${MAX_STRING_BYTES}`,
      );
    }
  }

  const totalVertices = view.getUint32(20, true);
  const totalIndices = view.getUint32(24, true);
  if (totalVertices > MAX_TOTAL_VERTICES || totalIndices > MAX_TOTAL_INDICES) {
    throw new FarFieldDecodeError(
      "out-of-bounds",
      `far field claims ${totalVertices} vertices / ${totalIndices} indices, over the limits`,
    );
  }

  const radiusM = view.getFloat64(28, true);
  if (!Number.isFinite(radiusM) || radiusM <= 0 || radiusM > MAX_RADIUS_M) {
    throw new FarFieldDecodeError(
      "malformed",
      `radius_m ${radiusM} is outside (0, ${MAX_RADIUS_M}]`,
    );
  }
  const centreLat = view.getFloat64(36, true);
  const centreLon = view.getFloat64(44, true);
  if (
    !Number.isFinite(centreLat) ||
    !Number.isFinite(centreLon) ||
    Math.abs(centreLat) > 90 ||
    Math.abs(centreLon) > 180
  ) {
    throw new FarFieldDecodeError(
      "malformed",
      `centre ${centreLat},${centreLon} is not a valid lat/lon`,
    );
  }

  const stringsEnd = FAR_FIELD_HEADER_BYTES + slugBytes + demBytes + bakedAtBytes;
  const tableOffset = align4(stringsEnd);
  const payloadStart = tableOffset + wedgeCount * FAR_FIELD_WEDGE_ENTRY_BYTES;
  if (payloadStart > bytes.byteLength) {
    throw new FarFieldDecodeError(
      "truncated",
      `far field ends inside the ${wedgeCount}-entry wedge table`,
    );
  }

  const dec = new TextDecoder("utf-8", { fatal: true });
  let stringOffset = bytes.byteOffset + FAR_FIELD_HEADER_BYTES;
  const readString = (len: number, field: string): string => {
    try {
      const s = dec.decode(new Uint8Array(bytes.buffer, stringOffset, len));
      stringOffset += len;
      return s;
    } catch {
      throw new FarFieldDecodeError("malformed", `${field} is not valid UTF-8`);
    }
  };
  const slug = readString(slugBytes, "slug");
  const demSource = readString(demBytes, "dem_source");
  const bakedAt = readString(bakedAtBytes, "baked_at");

  const meta: DecodedFarFieldMeta = {
    formatVersion,
    slug,
    radiusM,
    wedgeCount,
    centre: [centreLat, centreLon],
    demSource,
    bakedAt,
  };

  const wedges: FarFieldWedge[] = [];
  let offset = payloadStart;
  let seenVertices = 0;
  let seenIndices = 0;

  for (let w = 0; w < wedgeCount; w++) {
    const entry = tableOffset + w * FAR_FIELD_WEDGE_ENTRY_BYTES;

    if (view.getUint32(entry, true) !== w) {
      throw new FarFieldDecodeError(
        "malformed",
        `wedge table slot ${w} carries index ${view.getUint32(entry, true)}`,
      );
    }

    const vertexCount = view.getUint32(entry + 4, true);
    const indexCount = view.getUint32(entry + 8, true);
    if (vertexCount > MAX_VERTICES_PER_WEDGE) {
      throw new FarFieldDecodeError(
        "out-of-bounds",
        `wedge ${w} claims ${vertexCount} vertices, over the ${MAX_VERTICES_PER_WEDGE} limit`,
      );
    }
    if (indexCount % 3 !== 0) {
      throw new FarFieldDecodeError(
        "malformed",
        `wedge ${w} index_count ${indexCount} is not a multiple of 3`,
      );
    }

    const wedgeFlags = view.getUint32(entry + 12, true);
    if ((wedgeFlags & ~WEDGE_FLAG_U16_INDICES) !== 0) {
      throw new FarFieldDecodeError(
        "malformed",
        `wedge ${w} sets unknown flag bits 0x${wedgeFlags.toString(16)}`,
      );
    }
    const u16Indices = (wedgeFlags & WEDGE_FLAG_U16_INDICES) !== 0;
    if (u16Indices !== usesU16Indices(vertexCount)) {
      // The width is a function of vertex_count, so a disagreement means the
      // table was tampered with — reject rather than trust the flag.
      throw new FarFieldDecodeError(
        "malformed",
        `wedge ${w} index width disagrees with its ${vertexCount} vertices`,
      );
    }
    seenVertices += vertexCount;
    seenIndices += indexCount;
    if (seenVertices > MAX_TOTAL_VERTICES || seenIndices > MAX_TOTAL_INDICES) {
      throw new FarFieldDecodeError("out-of-bounds", "far field exceeds the total size limits");
    }

    const azimuthStartRad = view.getFloat64(entry + 16, true);
    const azimuthEndRad = view.getFloat64(entry + 24, true);
    if (!Number.isFinite(azimuthStartRad) || !Number.isFinite(azimuthEndRad)) {
      throw new FarFieldDecodeError("malformed", `wedge ${w} has a non-finite azimuth`);
    }
    if (azimuthEndRad <= azimuthStartRad || azimuthEndRad - azimuthStartRad > 2 * Math.PI) {
      throw new FarFieldDecodeError(
        "malformed",
        `wedge ${w} azimuth range [${azimuthStartRad}, ${azimuthEndRad}) is empty, inverted or over a full turn`,
      );
    }

    const bounds: WedgeBounds = {
      minX: view.getFloat64(entry + 32, true),
      maxX: view.getFloat64(entry + 40, true),
      minY: view.getFloat64(entry + 48, true),
      maxY: view.getFloat64(entry + 56, true),
      minZ: view.getFloat64(entry + 64, true),
      maxZ: view.getFloat64(entry + 72, true),
    };
    for (const [lo, hi, axis] of [
      [bounds.minX, bounds.maxX, "X"],
      [bounds.minY, bounds.maxY, "Y"],
      [bounds.minZ, bounds.maxZ, "Z"],
    ] as const) {
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) {
        throw new FarFieldDecodeError(
          "malformed",
          `wedge ${w} has invalid ${axis} bounds [${lo}, ${hi}]`,
        );
      }
    }

    const positionBytes = vertexCount * 6;
    const indexOffset = align4(offset + positionBytes);
    const wedgeEnd = align4(indexOffset + indexCount * (u16Indices ? 2 : 4));
    if (wedgeEnd > bytes.byteLength) {
      throw new FarFieldDecodeError(
        "truncated",
        `far field ends inside wedge ${w} of ${wedgeCount}`,
      );
    }

    const codes = readUint16Block(view, bytes, offset, vertexCount * 3);
    const positions = new Float32Array(vertexCount * 3);
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = dequantizeAxis(codes[i], bounds.minX, bounds.maxX);
      positions[i + 1] = dequantizeAxis(codes[i + 1], bounds.minY, bounds.maxY);
      positions[i + 2] = dequantizeAxis(codes[i + 2], bounds.minZ, bounds.maxZ);
    }

    const indices = u16Indices
      ? Uint32Array.from(readUint16Block(view, bytes, indexOffset, indexCount))
      : readUint32Block(view, bytes, indexOffset, indexCount);
    for (let i = 0; i < indices.length; i++) {
      if (indices[i] >= vertexCount) {
        throw new FarFieldDecodeError(
          "out-of-bounds",
          `wedge ${w} index[${i}] = ${indices[i]} is out of range for ${vertexCount} vertices`,
        );
      }
    }

    wedges.push({
      index: w,
      azimuthStartRad,
      azimuthEndRad,
      positions,
      indices,
      minY: bounds.minY,
      maxY: bounds.maxY,
    });

    offset = wedgeEnd;
  }

  if (seenVertices !== totalVertices || seenIndices !== totalIndices) {
    throw new FarFieldDecodeError(
      "count-mismatch",
      `header claims ${totalVertices} vertices / ${totalIndices} indices, ` +
        `wedge table sums to ${seenVertices} / ${seenIndices}`,
    );
  }
  if (offset !== bytes.byteLength) {
    throw new FarFieldDecodeError(
      "count-mismatch",
      `${bytes.byteLength - offset} trailing bytes after ${wedgeCount} wedges`,
    );
  }

  return { meta, wedges };
}

/**
 * Read `count` little-endian u16s. On a little-endian host with an aligned
 * offset this is a zero-copy view; otherwise it is a per-element `DataView`
 * read, because the file is little-endian by contract, not by host CPU.
 */
function readUint16Block(
  view: DataView,
  bytes: Uint8Array,
  offset: number,
  count: number,
): Uint16Array {
  const absolute = bytes.byteOffset + offset;
  if (HOST_IS_LITTLE_ENDIAN && absolute % 2 === 0) {
    return new Uint16Array(bytes.buffer, absolute, count);
  }
  const out = new Uint16Array(count);
  for (let i = 0; i < count; i++) out[i] = view.getUint16(offset + i * 2, true);
  return out;
}

/** As {@link readUint16Block}, but always returns a fresh owned array. */
function readUint32Block(
  view: DataView,
  bytes: Uint8Array,
  offset: number,
  count: number,
): Uint32Array {
  const out = new Uint32Array(count);
  const absolute = bytes.byteOffset + offset;
  if (HOST_IS_LITTLE_ENDIAN && absolute % 4 === 0) {
    out.set(new Uint32Array(bytes.buffer, absolute, count));
    return out;
  }
  for (let i = 0; i < count; i++) out[i] = view.getUint32(offset + i * 4, true);
  return out;
}
