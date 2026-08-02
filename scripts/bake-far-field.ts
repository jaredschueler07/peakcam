/**
 * bake-far-field.ts
 * ─────────────────
 * Offline bake of the Drop In v2 far field: a radially-graded coarse mesh out
 * to 30 km, split into 16 angular wedges, written in the PCFF wire format
 * (`lib/game/terrain/far-field-format.ts`). VISUALS-DESIGN.md §3.
 *
 * The mesh construction is **pure** and takes an injected {@link ElevationSampler},
 * so the whole baker is unit-testable against synthetic relief with no network
 * and no DEM on disk. The CLI supplies a real sampler (see `--dem` below).
 *
 * ## Topology: a polar ring mesh, not a TIN
 *
 * §3's plan named `delatin`/`martini` for triangulation. **Neither is used, and
 * neither is needed**, so no dependency was added:
 *
 *  - Both consume a square power-of-two heightmap and emit an *irregular* TIN.
 *    Cutting 16 azimuthal wedges out of a TIN means splitting triangles across
 *    wedge boundaries — precisely the crack-prone step the wedge format exists
 *    to avoid. A polar mesh puts wedge boundaries on shared ring vertices, so
 *    adjacent wedges are watertight by construction.
 *  - The radial LOD §3 specifies (cell size by distance band) *is* the polar
 *    grid's radial spacing. An error-driven TIN would place vertices by relief
 *    instead, fighting the spec rather than implementing it.
 *  - Budget: the polar mesh comes in well under §3's ~158k vertex allowance
 *    (see the report), so the dependency would buy nothing.
 *
 * Rings step by their band's cell size; each ring carries its own angular
 * segment count so triangles stay roughly square as radius grows. Consecutive
 * rings with different segment counts are joined by a merge walk over
 * normalised angle, which is crack-free and T-junction-free for any pair of
 * counts — so no power-of-two subdivision levels are needed either.
 *
 * ## The inner hole
 *
 * The streamed near-field tiles own the middle. §3 assumed that hole was 500 m,
 * but the live tile grid (`TerrainRenderer`) is 5×5 tiles of 200 m biased
 * downhill — `dz` runs from -1 to +3 — so the coverage *guaranteed* for any
 * player position within its own tile is only one tile behind, 200 m. The far
 * field therefore starts at {@link NEAR_FIELD_GUARANTEED_RADIUS_M} minus one
 * cell of overlap, and the 16 m band from there out to 500 m is real geometry
 * rather than the dead band it would be under a 500 m hole. See the report.
 *
 * ## Usage
 *
 *   npx tsx scripts/bake-far-field.ts <slug|all> --dem=<path-to-geotiff>
 *   npx tsx scripts/bake-far-field.ts all --dem-dir=<dir>   # <slug>-far-dem.tif
 *   npx tsx scripts/bake-far-field.ts ski-portillo --dem=… --dry-run
 *
 * The GeoTIFF must be a single-band elevation raster in a metric projection
 * (the resort's UTM zone) covering the full 30 km radius — produce it with the
 * GDAL step in the report. Once Tasks 1–3 land, `scripts/dem/sources.ts` should
 * replace the `--dem` adapter; nothing here duplicates it.
 *
 * Outputs (public/game/terrain/):
 *   <slug>-far.bin.br   PCFF bytes, brotli quality 11 — the committed artefact
 *   <slug>-far.json     FarFieldMeta sidecar + bake statistics
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

import {
  computeWedgeBounds,
  encodeFarField,
  wedgeQuantisationErrorM,
  type FarFieldMeta,
  type FarFieldWedge,
} from "@/lib/game/terrain/far-field-format";
import { RESORT_BAKE_CONFIGS } from "@/lib/game/terrain/resorts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
export const OUT_DIR = path.join(ROOT, "public", "game", "terrain");

// ─── Constants ───────────────────────────────────────────────

/** §3: 16 angular wedges, for frustum culling. */
export const WEDGE_COUNT = 16;

/** §3: cell sizes 16/48/128/256 m at 0.5/2/6/15/30 km. */
export const FAR_FIELD_RING_BANDS: RingBand[] = [
  { untilM: 500, cellM: 16 },
  { untilM: 2000, cellM: 48 },
  { untilM: 6000, cellM: 128 },
  { untilM: 15_000, cellM: 256 },
  { untilM: 30_000, cellM: 256 },
];

/**
 * Radius around the player the near-field tiles are guaranteed to cover, for
 * *any* player position within its own tile. Mirrors `TILE_SIZE` and
 * `Z_TILES_BEHIND` in `TerrainRenderer`; a test asserts they agree.
 */
export const NEAR_FIELD_GUARANTEED_RADIUS_M = 200;

/**
 * How far the far field reaches back under the near field. One cell is enough:
 * the two meshes need not share vertices, only overlap, so that no sight line
 * can pass between them. Zero overlap leaks sky where the far field's coarse
 * triangles cut below the near field's fine ones.
 */
export const SEAM_OVERLAP_CELLS = 1;

/** Fail the bake above this, per the plan. Not a warning. */
export const MAX_COMPRESSED_BYTES = 400 * 1024;

/**
 * Angular spacing target, as a multiple of the ring's cell size. §3 grades the
 * mesh *radially* and says nothing about angular resolution, so this fills in
 * an unspecified parameter — and it is the only lever on asset size that does
 * not touch the wire format.
 *
 * Size is dominated by the u16 position codes, which brotli cannot compress at
 * all (measured: 387.8 KB of interleaved codes → 387.8 KB compressed, while
 * 737 KB of indices → 14.9 KB). Asset size is therefore ≈ 6 bytes × vertices,
 * and vertex count scales as 1/factor. At 1.0 a 30 km bake lands at ~403 KB,
 * over the gate; at 1.5 it is ~276 KB, a 31% margin, and the widest triangle —
 * 384 m at 30 km — still subtends 0.73°, roughly 24 px at 1080p/60° FOV.
 *
 * The real fix is a format that drops X/Z entirely (they are exactly
 * `r·sin(az)` / `−r·cos(az)` from the ring table, so they carry no information);
 * see the task report. That is a Task 5/7 decision, not one this baker can make.
 */
export const ARC_CELLS = 1.5;

/** Guard on the quantisation error the wire format promises (Task 5: 0.229 m). */
export const MAX_QUANTISATION_ERROR_M = 0.25;

// ─── Types ───────────────────────────────────────────────────

export interface RingBand {
  /** Outer radius of this band, metres (exclusive). */
  untilM: number;
  /** Radial and target arc spacing inside it, metres. */
  cellM: number;
}

/**
 * Elevation in metres above sea level at a local ENU offset from the resort
 * centre: `eastM` grows east, `northM` grows north — the same frame
 * `lib/game/terrain/formats.ts` uses. The baker converts to the game's Y-up
 * frame (x east, y elevation, z south) itself.
 */
export type ElevationSampler = (eastM: number, northM: number) => number;

export interface FarFieldBakeConfig {
  slug: string;
  /** Resort centre `[lat, lon]`, degrees. */
  centre: [number, number];
  /** Outer radius of the far field, metres. */
  radiusM: number;
  wedgeCount: number;
  bands: RingBand[];
  /** Recorded in the asset so the runtime knows which DEM it is looking at. */
  demSource: string;
}

export interface BakeResult {
  wedges: FarFieldWedge[];
  meta: FarFieldMeta;
  /** Uncompressed PCFF bytes. */
  bytes: Uint8Array;
  /** Brotli quality 11 — what ships. */
  compressed: Buffer;
  vertexCount: number;
  triangleCount: number;
  /** Worst per-wedge quantisation error, metres, computed from the geometry. */
  maxQuantisationErrorM: number;
  /** Mean vertices drawn when a 70° frustum selects its wedges. */
  drawnVertexEstimate: number;
}

// ─── Ring grading ────────────────────────────────────────────

/** Cell size at radius `r`. A band's `untilM` belongs to the *next* band. */
export function cellSizeAt(r: number, bands: RingBand[]): number {
  for (const band of bands) {
    if (r < band.untilM) return band.cellM;
  }
  return bands[bands.length - 1].cellM;
}

/** Where the far field starts: inside the near field by {@link SEAM_OVERLAP_CELLS}. */
export function innerRadiusFor(bands: RingBand[]): number {
  return NEAR_FIELD_GUARANTEED_RADIUS_M - SEAM_OVERLAP_CELLS * bands[0].cellM;
}

/**
 * Ring radii from `inner` to `outer`. Steps by the current band's cell size and
 * clamps to the band boundary, so every boundary is an exact ring — a band
 * change never lands mid-cell.
 */
export function buildRingRadii(inner: number, outer: number, bands: RingBand[]): number[] {
  const radii = [inner];
  let r = inner;
  let guard = 0;
  while (r < outer) {
    if (++guard > 100_000) throw new Error("buildRingRadii: runaway ring count");
    const cell = cellSizeAt(r, bands);
    const bandEnd = bands.find((b) => r < b.untilM)?.untilM ?? outer;
    r = Math.min(outer, bandEnd, r + cell);
    radii.push(r);
  }
  return radii;
}

/**
 * Angular segments per wedge at radius `r`: enough that the arc between
 * neighbours is no coarser than the cell size. Never decreases outward
 * (`atLeast` is the previous ring's count), which keeps the stitching simple
 * and avoids slivers where a band boundary would otherwise coarsen the mesh.
 */
export function segmentsForRing(
  r: number,
  bands: RingBand[],
  wedgeCount: number,
  atLeast = 0,
): number {
  const arcPerWedge = ((2 * Math.PI) / wedgeCount) * r;
  const wanted = Math.max(1, Math.ceil(arcPerWedge / (cellSizeAt(r, bands) * ARC_CELLS)));
  return Math.max(wanted, atLeast);
}

// ─── Mesh construction ───────────────────────────────────────

/**
 * Build every wedge for a resort. `innerOverride` exists for tests that need a
 * detached far field; production callers omit it.
 */
export function buildWedges(
  config: FarFieldBakeConfig,
  elevation: ElevationSampler,
  innerOverride?: number,
): FarFieldWedge[] {
  const inner = innerOverride ?? innerRadiusFor(config.bands);
  const radii = buildRingRadii(inner, config.radiusM, config.bands);

  // Segment counts depend only on radius, so every wedge shares them — which is
  // what makes the vertices on a shared wedge boundary identical.
  const segments: number[] = [];
  let prev = 0;
  for (const r of radii) {
    prev = segmentsForRing(r, config.bands, config.wedgeCount, prev);
    segments.push(prev);
  }

  const wedges: FarFieldWedge[] = [];
  for (let w = 0; w < config.wedgeCount; w++) {
    const azimuthStartRad = (w * 2 * Math.PI) / config.wedgeCount;
    const azimuthEndRad = ((w + 1) * 2 * Math.PI) / config.wedgeCount;
    wedges.push(buildWedge(w, azimuthStartRad, azimuthEndRad, radii, segments, elevation));
  }
  return wedges;
}

function buildWedge(
  index: number,
  azimuthStartRad: number,
  azimuthEndRad: number,
  radii: number[],
  segments: number[],
  elevation: ElevationSampler,
): FarFieldWedge {
  let vertexCount = 0;
  for (const s of segments) vertexCount += s + 1;

  const positions = new Float32Array(vertexCount * 3);
  const ringStart: number[] = [];
  let at = 0;

  for (let i = 0; i < radii.length; i++) {
    ringStart.push(at);
    const r = radii[i];
    const s = segments[i];
    for (let j = 0; j <= s; j++) {
      const az = azimuthStartRad + ((azimuthEndRad - azimuthStartRad) * j) / s;
      // Compass bearing: 0 = north = -z, increasing eastwards = +x.
      const east = r * Math.sin(az);
      const north = r * Math.cos(az);
      const o = at * 3;
      positions[o] = east;
      positions[o + 1] = elevation(east, north);
      positions[o + 2] = -north; // game z is south
      at++;
    }
  }

  // Stitch each pair of consecutive rings by a merge walk over normalised
  // angle. Works for any pair of segment counts, with no T-junctions.
  const indices: number[] = [];
  for (let i = 0; i < radii.length - 1; i++) {
    const innerBase = ringStart[i];
    const outerBase = ringStart[i + 1];
    const si = segments[i];
    const so = segments[i + 1];
    let a = 0;
    let b = 0;
    while (a < si || b < so) {
      const advanceInner = b >= so || (a < si && (a + 1) / si <= (b + 1) / so);
      if (advanceInner) {
        // (inner[a], inner[a+1], outer[b]) winds CCW seen from above (+y).
        indices.push(innerBase + a, innerBase + a + 1, outerBase + b);
        a++;
      } else {
        indices.push(innerBase + a, outerBase + b + 1, outerBase + b);
        b++;
      }
    }
  }

  // Bounds come from the stored float32s, not the float64 samples: the wire
  // format requires them to bracket the geometry it actually encodes.
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

// ─── Bake ────────────────────────────────────────────────────

export const FAR_FIELD_BAKE_CONFIGS: Record<string, FarFieldBakeConfig> = Object.fromEntries(
  Object.values(RESORT_BAKE_CONFIGS).map((r) => [
    r.slug,
    {
      slug: r.slug,
      centre: r.center,
      radiusM: 30_000,
      wedgeCount: WEDGE_COUNT,
      bands: FAR_FIELD_RING_BANDS,
      // Overwritten by the CLI from the DEM actually supplied.
      demSource: r.copernicusTile ? "copernicus-glo30" : "usgs-3dep-1m",
    } satisfies FarFieldBakeConfig,
  ]),
);

/**
 * Build, encode and compress a resort's far field. Throws if the result busts
 * the brotli budget or the quantisation budget — a bake that silently ships an
 * over-budget asset is worse than one that fails.
 */
export function bakeFarField(
  config: FarFieldBakeConfig,
  elevation: ElevationSampler,
  options: { bakedAt?: string; maxCompressedBytes?: number } = {},
): BakeResult {
  const bakedAt = options.bakedAt ?? new Date().toISOString();
  const budget = options.maxCompressedBytes ?? MAX_COMPRESSED_BYTES;
  const wedges = buildWedges(config, elevation);

  let vertexCount = 0;
  let triangleCount = 0;
  let maxQuantisationErrorM = 0;
  for (const wedge of wedges) {
    vertexCount += wedge.positions.length / 3;
    triangleCount += wedge.indices.length / 3;
    maxQuantisationErrorM = Math.max(
      maxQuantisationErrorM,
      wedgeQuantisationErrorM(computeWedgeBounds(wedge.positions)).max,
    );
  }

  if (maxQuantisationErrorM > MAX_QUANTISATION_ERROR_M) {
    throw new Error(
      `${config.slug}: worst-wedge quantisation error ${maxQuantisationErrorM.toFixed(4)} m ` +
        `exceeds the ${MAX_QUANTISATION_ERROR_M} m budget — the wire format needs per-ring bounds`,
    );
  }

  const meta: FarFieldMeta = {
    slug: config.slug,
    radiusM: config.radiusM,
    wedgeCount: config.wedgeCount,
    centre: config.centre,
    demSource: config.demSource,
    bakedAt,
  };

  const bytes = encodeFarField(wedges, meta);
  const compressed = brotli(Buffer.from(bytes));

  if (compressed.byteLength > budget) {
    throw new Error(
      `${config.slug}: ${compressed.byteLength} bytes exceeds the ${budget}-byte ` +
        `brotli budget (${vertexCount} vertices, ${triangleCount} triangles)`,
    );
  }

  return {
    wedges,
    meta,
    bytes,
    compressed,
    vertexCount,
    triangleCount,
    maxQuantisationErrorM,
    drawnVertexEstimate: drawnVertexEstimate(wedges, config.wedgeCount),
  };
}

/**
 * Vertices drawn once a 70°-horizontal-FOV frustum culls whole wedges. A 70°
 * frustum spans 70/(360/N) wedges, plus one for partial overlap at each edge.
 */
function drawnVertexEstimate(wedges: FarFieldWedge[], wedgeCount: number): number {
  const perWedge = wedges.reduce((n, w) => n + w.positions.length / 3, 0) / wedgeCount;
  const visible = Math.min(wedgeCount, Math.ceil(70 / (360 / wedgeCount)) + 1);
  return Math.round(perWedge * visible);
}

function brotli(input: Buffer): Buffer {
  return zlib.brotliCompressSync(input, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: input.byteLength,
    },
  });
}

// ─── Geometry queries (verification) ─────────────────────────

/**
 * Horizontal distance to the first ray/triangle intersection, or null. Brute
 * force over every triangle: this runs in tests and in the CLI's seam check,
 * never per frame.
 */
export function firstMeshHit(
  wedges: FarFieldWedge[],
  origin: [number, number, number],
  direction: [number, number, number],
): number | null {
  let best = Infinity;
  for (const wedge of wedges) {
    const p = wedge.positions;
    const idx = wedge.indices;
    for (let t = 0; t < idx.length; t += 3) {
      const hit = rayTriangle(origin, direction, p, idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3);
      if (hit !== null && hit < best) best = hit;
    }
  }
  if (!Number.isFinite(best)) return null;
  // Return the horizontal distance, to match how callers reason about radius.
  return best * Math.hypot(direction[0], direction[2]);
}

/** Möller–Trumbore, double sided (a downward ray may meet a back face at a seam). */
function rayTriangle(
  o: [number, number, number],
  d: [number, number, number],
  p: Float32Array,
  ia: number,
  ib: number,
  ic: number,
): number | null {
  const e1x = p[ib] - p[ia];
  const e1y = p[ib + 1] - p[ia + 1];
  const e1z = p[ib + 2] - p[ia + 2];
  const e2x = p[ic] - p[ia];
  const e2y = p[ic + 1] - p[ia + 1];
  const e2z = p[ic + 2] - p[ia + 2];

  const hx = d[1] * e2z - d[2] * e2y;
  const hy = d[2] * e2x - d[0] * e2z;
  const hz = d[0] * e2y - d[1] * e2x;
  const det = e1x * hx + e1y * hy + e1z * hz;
  if (Math.abs(det) < 1e-12) return null;

  const inv = 1 / det;
  const sx = o[0] - p[ia];
  const sy = o[1] - p[ia + 1];
  const sz = o[2] - p[ia + 2];
  const u = inv * (sx * hx + sy * hy + sz * hz);
  if (u < 0 || u > 1) return null;

  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;
  const v = inv * (d[0] * qx + d[1] * qy + d[2] * qz);
  if (v < 0 || u + v > 1) return null;

  const t = inv * (e2x * qx + e2y * qy + e2z * qz);
  return t > 1e-6 ? t : null;
}

export interface PeakHit {
  elevationM: number;
  distanceM: number;
  bearingRad: number;
  /** Rise above the horizontal from the resort centre, degrees. */
  elevationAngleDeg: number;
}

/**
 * Highest baked vertex within `toleranceM` of a given bearing and distance from
 * the resort centre. Used to confirm a known landmark actually made it into the
 * mesh — at Portillo, Aconcagua at ~23.7 km on a ~28° bearing.
 */
export function findPeakNear(
  wedges: FarFieldWedge[],
  bearingRad: number,
  distanceM: number,
  toleranceM: number,
  centreElevationM = 2900,
): PeakHit | null {
  const targetX = distanceM * Math.sin(bearingRad);
  const targetZ = -distanceM * Math.cos(bearingRad);
  let best: PeakHit | null = null;

  for (const wedge of wedges) {
    const p = wedge.positions;
    for (let i = 0; i < p.length; i += 3) {
      const dx = p[i] - targetX;
      const dz = p[i + 2] - targetZ;
      if (dx * dx + dz * dz > toleranceM * toleranceM) continue;
      const y = p[i + 1];
      if (best !== null && y <= best.elevationM) continue;
      const d = Math.hypot(p[i], p[i + 2]);
      best = {
        elevationM: y,
        distanceM: d,
        bearingRad: Math.atan2(p[i], -p[i + 2]),
        elevationAngleDeg: (Math.atan2(y - centreElevationM, d) * 180) / Math.PI,
      };
    }
  }
  return best;
}

// ─── CLI ─────────────────────────────────────────────────────

/**
 * Sampler over a single-band elevation GeoTIFF in a metric projection, read
 * whole into memory (a 30 km radius at 16 m is ~3750² samples — 56 MB as f32,
 * fine offline). Bilinear, edge-clamped.
 *
 * This is a deliberately thin stand-in for `scripts/dem/sources.ts` (Tasks 1–3,
 * on `feat/visuals-p1-dem`): it takes a file GDAL has already warped and
 * windowed, so it duplicates none of that module's source selection or UTM
 * logic and should be deleted when those land.
 */
export async function samplerFromGeoTiff(
  file: string,
  config: Pick<FarFieldBakeConfig, "slug" | "radiusM">,
): Promise<{ sample: ElevationSampler; description: string }> {
  const { fromFile } = await import("geotiff");
  const tiff = await fromFile(file);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const [resX, resY] = image.getResolution();
  const raster = (await image.readRasters({ interleave: true })) as ArrayLike<number>;
  const noData = image.getGDALNoData();

  // The contract with the GDAL step: the raster is in a metric CRS and windowed
  // symmetrically on the resort centre, so the centre is the raster's centre.
  // Verify it at least reaches the far field's outer radius — a short window is
  // exactly the failure the Aconcagua check exists to catch, and this names it.
  const halfWidthM = (width * Math.abs(resX)) / 2;
  const halfHeightM = (height * Math.abs(resY)) / 2;
  const covered = Math.min(halfWidthM, halfHeightM);
  if (covered < config.radiusM) {
    throw new Error(
      `${config.slug}: DEM covers only ${covered.toFixed(0)} m from the centre, ` +
        `but the far field needs ${config.radiusM} m — re-run the gdalwarp window`,
    );
  }

  // Pixel (i, j)'s centre sits half a pixel in from its corner, so the resort
  // centre maps to (width/2 - 0.5, height/2 - 0.5), not (width/2, height/2).
  const centrePxX = width / 2 - 0.5;
  const centrePxY = height / 2 - 0.5;

  const sample: ElevationSampler = (east, north) => {
    const fx = centrePxX + east / Math.abs(resX);
    const fy = centrePxY - north / Math.abs(resY); // north is up, rows go down
    const x0 = Math.min(width - 1, Math.max(0, Math.floor(fx)));
    const y0 = Math.min(height - 1, Math.max(0, Math.floor(fy)));
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const ax = Math.min(1, Math.max(0, fx - x0));
    const ay = Math.min(1, Math.max(0, fy - y0));
    const at = (x: number, y: number): number => {
      const v = raster[y * width + x];
      return noData !== null && v === noData ? 0 : v;
    };
    const h00 = at(x0, y0);
    const h10 = at(x1, y0);
    const h01 = at(x0, y1);
    const h11 = at(x1, y1);
    return (h00 * (1 - ax) + h10 * ax) * (1 - ay) + (h01 * (1 - ax) + h11 * ax) * ay;
  };

  return {
    sample,
    description: `${path.basename(file)} ${width}×${height} @ ${Math.abs(resX)} m`,
  };
}

async function main(argv: string[]): Promise<void> {
  const args = argv.slice(2);
  const target = args.find((a) => !a.startsWith("--"));
  const dem = args.find((a) => a.startsWith("--dem="))?.slice("--dem=".length);
  const demDir = args.find((a) => a.startsWith("--dem-dir="))?.slice("--dem-dir=".length);
  const dryRun = args.includes("--dry-run");

  if (!target) {
    console.error("usage: bake-far-field.ts <slug|all> --dem=<file> | --dem-dir=<dir> [--dry-run]");
    process.exitCode = 1;
    return;
  }
  const slugs =
    target === "all" ? Object.keys(FAR_FIELD_BAKE_CONFIGS) : [target];
  for (const slug of slugs) {
    if (!FAR_FIELD_BAKE_CONFIGS[slug]) {
      console.error(`unknown resort "${slug}"`);
      process.exitCode = 1;
      return;
    }
  }
  if (!dem && !demDir) {
    console.error("a DEM is required: pass --dem=<file> (one slug) or --dem-dir=<dir> (all)");
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const slug of slugs) {
    const config = FAR_FIELD_BAKE_CONFIGS[slug];
    const file = dem && slugs.length === 1 ? dem : path.join(demDir ?? ".", `${slug}-far-dem.tif`);
    if (!fs.existsSync(file)) throw new Error(`${slug}: DEM not found at ${file}`);

    const { sample, description } = await samplerFromGeoTiff(file, config);
    const result = bakeFarField(config, sample);

    console.log(`\n${slug}  (${description})`);
    console.log(`  vertices        ${result.vertexCount.toLocaleString()}`);
    console.log(`  triangles       ${result.triangleCount.toLocaleString()}`);
    console.log(`  drawn / frame   ~${result.drawnVertexEstimate.toLocaleString()} verts`);
    console.log(`  raw             ${(result.bytes.byteLength / 1024).toFixed(1)} KB`);
    console.log(
      `  brotli          ${(result.compressed.byteLength / 1024).toFixed(1)} KB ` +
        `(budget ${MAX_COMPRESSED_BYTES / 1024} KB)`,
    );
    console.log(`  quantisation    ${result.maxQuantisationErrorM.toFixed(4)} m worst wedge`);

    if (slug === "ski-portillo") {
      // Aconcagua: 6,961 m at -32.6533, -70.0109 — ~23.7 km out on a ~28°
      // bearing. If it is missing, the radius or the DEM window is wrong.
      const peak = findPeakNear(result.wedges, Math.atan2(11_054, 20_970), 23_700, 2500);
      if (!peak || peak.elevationM < 6000) {
        throw new Error(
          `ski-portillo: Aconcagua is not in the baked mesh (highest nearby: ` +
            `${peak ? peak.elevationM.toFixed(0) : "none"} m) — check the DEM window covers 30 km`,
        );
      }
      console.log(
        `  Aconcagua       ${peak.elevationM.toFixed(0)} m at ${(peak.distanceM / 1000).toFixed(1)} km, ` +
          `+${peak.elevationAngleDeg.toFixed(1)}°`,
      );
    }

    if (dryRun) {
      console.log("  (dry run — nothing written)");
      continue;
    }
    fs.writeFileSync(path.join(OUT_DIR, `${slug}-far.bin.br`), result.compressed);
    fs.writeFileSync(
      path.join(OUT_DIR, `${slug}-far.json`),
      JSON.stringify(
        {
          ...result.meta,
          innerRadiusM: innerRadiusFor(config.bands),
          bands: config.bands,
          vertexCount: result.vertexCount,
          triangleCount: result.triangleCount,
          drawnVertexEstimate: result.drawnVertexEstimate,
          rawBytes: result.bytes.byteLength,
          compressedBytes: result.compressed.byteLength,
          maxQuantisationErrorM: result.maxQuantisationErrorM,
          dem: description,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`  → ${slug}-far.bin.br, ${slug}-far.json`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main(process.argv).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
