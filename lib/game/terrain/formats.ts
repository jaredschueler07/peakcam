/**
 * lib/game/terrain/formats.ts
 * ───────────────────────────
 * Decoders for the baked terrain assets produced by `scripts/bake-resort.ts`.
 *
 * Pure TypeScript: no DOM, no three.js, no Node built-ins — this module is
 * imported by the game runtime, by the bake script, and (later) by the
 * server-side run validator, so it must run anywhere.
 *
 * ## Coordinate conventions (the single source of truth for orientation)
 *
 * The heightfield is a square grid of `grid × grid` samples covering a
 * `sizeM × sizeM` box centred on `meta.center` (`[lat, lon]`), sampled on a
 * local ENU frame:
 *
 *   mPerDegLat = 111132
 *   mPerDegLon = 111320 * cos(centerLat)
 *
 * Local metres: `x` grows east, `y` grows north, both relative to the centre,
 * spanning `[-sizeM/2, +sizeM/2]`.
 *
 * Samples are stored row-major, **north to south** (row 0 is the north edge)
 * and **west to east** within a row (column 0 is the west edge) — i.e. the
 * natural raster/PNG order, so `<slug>.height.png` and `<slug>.height.u16`
 * hold the same values in the same order. Therefore:
 *
 *   x(col) = -sizeM/2 + col * cellSizeM
 *   y(row) = +sizeM/2 - row * cellSizeM      // note the sign flip
 *   cellSizeM = sizeM / (grid - 1)           // endpoint-inclusive grid
 *
 * Elevations are quantised: `elevation = minZ + code * quantum`, where `code`
 * is the stored little-endian uint16.
 */

// ─── Meta ────────────────────────────────────────────────────

/** Orientation string stamped into every meta file; assert on it when decoding. */
export const HEIGHTFIELD_ORIENTATION =
  "row-major; row 0 = north edge, col 0 = west edge; x east, y north, both in metres from center";

export type TerrainSource = "terrarium" | "copernicus";

export interface TerrainMeta {
  /** Format version of this meta + .u16 pair. */
  version: number;
  slug: string;
  /** `[latitude, longitude]` of the box centre, degrees. */
  center: [number, number];
  /** Box edge length in metres. */
  sizeM: number;
  /** Samples per edge (grid × grid total). */
  grid: number;
  /** Elevation of code 0, metres. Multiple of `quantum`. */
  minZ: number;
  /** Elevation of the largest code actually present, metres. */
  maxZ: number;
  /** Vertical step per code, metres. */
  quantum: number;
  source: TerrainSource;
  /** Web-Mercator zoom level sampled (terrarium only; null for COG sources). */
  sourceZoom: number | null;
  /** Human-readable orientation contract — equals HEIGHTFIELD_ORIENTATION. */
  orientation: string;
  /** ISO-8601 timestamp of the bake. */
  bakedAt: string;
}

export interface Heightfield {
  width: number;
  height: number;
  /** Elevations in metres, row-major north-to-south / west-to-east. */
  heights: Float32Array;
  /** Metres between adjacent samples. */
  cellSizeM: number;
  /** Box edge length in metres. */
  sizeM: number;
  /** Lowest / highest elevation present, metres. */
  minZ: number;
  maxZ: number;
}

// ─── Quantisation ────────────────────────────────────────────

export const U16_MAX = 65535;

/** Elevation (m) → uint16 code, clamped to the representable range. */
export function quantizeHeight(z: number, minZ: number, quantum: number): number {
  const code = Math.round((z - minZ) / quantum);
  return code < 0 ? 0 : code > U16_MAX ? U16_MAX : code;
}

/** uint16 code → elevation (m). */
export function dequantizeHeight(code: number, minZ: number, quantum: number): number {
  return minZ + code * quantum;
}

// ─── Heightfield ─────────────────────────────────────────────

/**
 * Decode a `<slug>.height.u16` buffer into absolute elevations.
 * Throws if the buffer length disagrees with `meta.grid`.
 */
export function decodeHeightfield(buffer: ArrayBuffer, meta: TerrainMeta): Heightfield {
  const n = meta.grid * meta.grid;
  if (buffer.byteLength !== n * 2) {
    throw new Error(
      `heightfield size mismatch: expected ${n * 2} bytes for ${meta.grid}x${meta.grid}, got ${buffer.byteLength}`,
    );
  }
  // DataView rather than Uint16Array: the file is little-endian by contract,
  // not by whatever the host CPU happens to be.
  const view = new DataView(buffer);
  const heights = new Float32Array(n);
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const z = meta.minZ + view.getUint16(i * 2, true) * meta.quantum;
    heights[i] = z;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return {
    width: meta.grid,
    height: meta.grid,
    heights,
    cellSizeM: meta.sizeM / (meta.grid - 1),
    sizeM: meta.sizeM,
    minZ,
    maxZ,
  };
}

/** Grid column index (fractional) for a local-metre x, per the orientation contract. */
export function colForX(field: Pick<Heightfield, "sizeM" | "cellSizeM">, x: number): number {
  return (x + field.sizeM / 2) / field.cellSizeM;
}

/** Grid row index (fractional) for a local-metre y, per the orientation contract. */
export function rowForY(field: Pick<Heightfield, "sizeM" | "cellSizeM">, y: number): number {
  return (field.sizeM / 2 - y) / field.cellSizeM;
}

/**
 * Bilinear elevation lookup in local metres (x east, y north, from centre).
 * Samples outside the box clamp to the edge. Phase 5.2 replaces this with a
 * bicubic sampler + analytic normals; this is the reference implementation.
 */
export function sampleHeightBilinear(field: Heightfield, x: number, y: number): number {
  const { width, height, heights } = field;
  const fx = clamp(colForX(field, x), 0, width - 1);
  const fy = clamp(rowForY(field, y), 0, height - 1);
  const x0 = Math.min(width - 1, Math.floor(fx));
  const y0 = Math.min(height - 1, Math.floor(fy));
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const ax = fx - x0;
  const ay = fy - y0;
  const h00 = heights[y0 * width + x0];
  const h10 = heights[y0 * width + x1];
  const h01 = heights[y1 * width + x0];
  const h11 = heights[y1 * width + x1];
  return (h00 * (1 - ax) + h10 * ax) * (1 - ay) + (h01 * (1 - ax) + h11 * ax) * ay;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ─── Trails ──────────────────────────────────────────────────

/** On-disk shape of `<slug>.trails.json` (compact keys; see terrain-report §3). */
export interface TrailsFile {
  v: number;
  center: [number, number];
  sizeM: number;
  /** Metres per stored integer unit (0.1 = decimetres). */
  unit: number;
  /** OSM difficulty convention the `d` values follow. */
  convention?: "north_america" | "europe";
  runs: RawRun[];
  lifts: RawLift[];
}

export interface RawPolyline {
  /** Name, or null when OSM has none. */
  n: string | null;
  /** Flat delta-encoded coords: `[x0, y0, dx1, dy1, dx2, dy2, ...]` in `unit` metres. */
  p: number[];
}

export interface RawRun extends RawPolyline {
  /** `piste:difficulty`. */
  d?: string | null;
  /** `piste:grooming`. */
  g?: string;
  /** 1 when `gladed=yes`. */
  gl?: 1;
  /** 1 when the run is one-way. */
  o?: 1;
}

export interface RawLift extends RawPolyline {
  /** `aerialway` value (chair_lift, gondola, platter, …). */
  t: string;
}

export interface TrailPoint {
  /** Metres east of centre. */
  x: number;
  /** Metres north of centre. */
  y: number;
}

export interface Run {
  name: string | null;
  difficulty: string | null;
  grooming: string | null;
  gladed: boolean;
  oneway: boolean;
  points: TrailPoint[];
}

export interface Lift {
  name: string | null;
  type: string;
  points: TrailPoint[];
}

export interface Trails {
  version: number;
  center: [number, number];
  sizeM: number;
  convention: "north_america" | "europe" | null;
  runs: Run[];
  lifts: Lift[];
}

/** Delta-encode absolute integer coordinate pairs into the flat `p` array. */
export function encodeDelta(points: ReadonlyArray<readonly [number, number]>): number[] {
  const out: number[] = [];
  let px = 0;
  let py = 0;
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i];
    out.push(i === 0 ? x : x - px, i === 0 ? y : y - py);
    px = x;
    py = y;
  }
  return out;
}

/** Inverse of {@link encodeDelta}. Throws on an odd-length array. */
export function decodeDelta(flat: readonly number[]): Array<[number, number]> {
  if (flat.length % 2 !== 0) {
    throw new Error(`delta array must have an even length, got ${flat.length}`);
  }
  const out: Array<[number, number]> = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < flat.length; i += 2) {
    if (i === 0) {
      x = flat[0];
      y = flat[1];
    } else {
      x += flat[i];
      y += flat[i + 1];
    }
    out.push([x, y]);
  }
  return out;
}

function decodePolyline(p: readonly number[], unit: number): TrailPoint[] {
  return decodeDelta(p).map(([x, y]) => ({ x: x * unit, y: y * unit }));
}

/**
 * Decode `<slug>.trails.json` into absolute local-metre polylines.
 * Accepts the parsed JSON object (the file is small; callers own the fetch).
 */
export function decodeTrails(json: TrailsFile): Trails {
  const unit = json.unit;
  return {
    version: json.v,
    center: json.center,
    sizeM: json.sizeM,
    convention: json.convention ?? null,
    runs: json.runs.map((r) => ({
      name: r.n,
      difficulty: r.d ?? null,
      grooming: r.g ?? null,
      gladed: r.gl === 1,
      oneway: r.o === 1,
      points: decodePolyline(r.p, unit),
    })),
    lifts: json.lifts.map((l) => ({
      name: l.n,
      type: l.t,
      points: decodePolyline(l.p, unit),
    })),
  };
}
