/**
 * bake-resort.ts
 * ──────────────
 * Offline bake of the Drop In v2 terrain assets: a 1024² quantised heightfield
 * plus delta-encoded trail/lift centrelines, per resort, committed to the repo.
 *
 * Nothing upstream is in the deploy path — neither AWS Terrain Tiles nor
 * Overpass carries an SLA, and terrain does not change. Run this by hand,
 * inspect the PNG, commit the output.
 *
 * Usage:
 *   npx tsx scripts/bake-resort.ts ski-portillo
 *   npx tsx scripts/bake-resort.ts all
 *   npx tsx scripts/bake-resort.ts all --verify          # re-bake, hash-compare
 *   npx tsx scripts/bake-resort.ts ski-portillo --source=copernicus
 *   npx tsx scripts/bake-resort.ts all --skip-trails     # DEM only
 *
 * Outputs (public/game/terrain/):
 *   <slug>.height.u16       raw little-endian uint16, row-major N→S, W→E
 *   <slug>.height.u16.br    the same bytes, brotli quality 11 (Vercel serves it)
 *   <slug>.height.png       16-bit grayscale PNG — inspection artifact only
 *   <slug>.meta.json        georeference + decode constants
 *   <slug>.trails.json(.br) delta-encoded run/lift centrelines
 *
 * Sources & licences: see public/game/terrain/LICENSE.md.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { PNG } from "pngjs";
import { fromUrl } from "geotiff";
import {
  HEIGHTFIELD_ORIENTATION,
  encodeDelta,
  quantizeHeight,
  type TerrainMeta,
  type TerrainSource,
  type TrailsFile,
  type RawRun,
  type RawLift,
} from "@/lib/game/terrain/formats";
import {
  GRID,
  M_PER_DEG_LAT,
  QUANTUM,
  RESORT_BAKE_CONFIGS,
  RESORT_SLUGS,
  SOURCE_ZOOM,
  mPerDegLon,
  type ResortBakeConfig,
} from "@/lib/game/terrain/resorts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
export const OUT_DIR = path.join(ROOT, "public", "game", "terrain");

const META_VERSION = 1;
const TRAILS_VERSION = 1;
/** Ramer–Douglas–Peucker tolerance, metres (terrain-report §3). */
const RDP_EPSILON_M = 6;
/** Trail coordinate unit, metres (decimetres). */
const TRAIL_UNIT = 0.1;

const TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
const COPERNICUS_URL = "https://copernicus-dem-30m.s3.amazonaws.com";
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
/** Courtesy pause between per-resort Overpass queries (terrain-report §2). */
const OVERPASS_SLEEP_MS = 8000;
const TILE_CONCURRENCY = 6;
const FETCH_RETRIES = 4;

// ─── Web Mercator ────────────────────────────────────────────

const DEG = Math.PI / 180;
const TILE_PX = 256;

/** Longitude → global pixel x at zoom z. */
export function lonToPixelX(lon: number, z: number): number {
  return ((lon + 180) / 360) * Math.pow(2, z) * TILE_PX;
}

/** Latitude → global pixel y at zoom z. */
export function latToPixelY(lat: number, z: number): number {
  const s = Math.sin(lat * DEG);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * Math.pow(2, z) * TILE_PX;
}

// ─── Fetch helpers ───────────────────────────────────────────

async function fetchWithRetry(url: string, label: string): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "peakcam-drop-in-bake/1.0" } });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastError = err;
      if (attempt < FETCH_RETRIES) {
        const backoff = 400 * Math.pow(2, attempt - 1);
        console.warn(`  ! ${label} attempt ${attempt} failed (${String(err)}); retrying in ${backoff}ms`);
        await sleep(backoff);
      }
    }
  }
  throw new Error(`${label} failed after ${FETCH_RETRIES} attempts: ${String(lastError)}`);
}

/** Run `tasks` with a bounded number in flight, preserving rejection. */
async function pooled<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= tasks.length) return;
      results[i] = await tasks[i]();
    }
  });
  await Promise.all(workers);
  return results;
}

// ─── Terrarium sampling (seam-safe) ──────────────────────────

interface TerrariumTiles {
  z: number;
  tiles: Map<string, Buffer>;
}

/**
 * Prefetch every z-level tile the box touches, plus a one-tile margin so
 * bilinear taps that fall in a neighbouring tile resolve without clamping
 * (terrain-report gotcha #4 — clamping at x=255 leaves a ridge every 256 px).
 */
async function prefetchTerrariumTiles(cfg: ResortBakeConfig, z: number): Promise<TerrariumTiles> {
  const [cLat, cLon] = cfg.center;
  const half = cfg.sizeM / 2;
  const latN = cLat + half / M_PER_DEG_LAT;
  const latS = cLat - half / M_PER_DEG_LAT;
  const lonW = cLon - half / mPerDegLon(cLat);
  const lonE = cLon + half / mPerDegLon(cLat);

  // Bilinear taps reach half a pixel beyond the grid extremes; the ±1 pixel
  // margin below covers that before we widen to whole tiles.
  const minPx = lonToPixelX(lonW, z) - 1;
  const maxPx = lonToPixelX(lonE, z) + 1;
  const minPy = latToPixelY(latN, z) - 1;
  const maxPy = latToPixelY(latS, z) + 1;

  const tx0 = Math.floor(minPx / TILE_PX);
  const tx1 = Math.floor(maxPx / TILE_PX);
  const ty0 = Math.floor(minPy / TILE_PX);
  const ty1 = Math.floor(maxPy / TILE_PX);

  const keys: Array<[number, number]> = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) keys.push([tx, ty]);

  const tiles = new Map<string, Buffer>();
  await pooled(
    keys.map(([tx, ty]) => async () => {
      const key = `${tx}/${ty}`;
      const buf = await fetchWithRetry(`${TERRARIUM_URL}/${z}/${key}.png`, `terrarium ${z}/${key}`);
      const png = PNG.sync.read(buf);
      if (png.width !== TILE_PX || png.height !== TILE_PX) {
        throw new Error(`terrarium ${z}/${key}: unexpected size ${png.width}x${png.height}`);
      }
      tiles.set(key, png.data);
    }),
    TILE_CONCURRENCY,
  );
  console.log(`  fetched ${tiles.size} terrarium tiles at z${z}`);
  return { z, tiles };
}

/** Decoded elevation at an integer global pixel. Terrarium: R*256 + G + B/256 - 32768. */
function terrariumPixel(t: TerrariumTiles, gx: number, gy: number): number {
  const tx = Math.floor(gx / TILE_PX);
  const ty = Math.floor(gy / TILE_PX);
  const data = t.tiles.get(`${tx}/${ty}`);
  if (!data) throw new Error(`tile ${t.z}/${tx}/${ty} was not prefetched`);
  const px = gx - tx * TILE_PX;
  const py = gy - ty * TILE_PX;
  const i = (py * TILE_PX + px) * 4;
  return data[i] * 256 + data[i + 1] + data[i + 2] / 256 - 32768;
}

/**
 * Bilinear terrarium sample. Pixel centres sit at +0.5, and taps are addressed
 * in *global* pixel space, so a tap that lands in the next tile simply reads
 * that tile — no seam.
 */
function sampleTerrarium(t: TerrariumTiles, lat: number, lon: number): number {
  const fx = lonToPixelX(lon, t.z) - 0.5;
  const fy = latToPixelY(lat, t.z) - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const ax = fx - x0;
  const ay = fy - y0;
  const h00 = terrariumPixel(t, x0, y0);
  const h10 = terrariumPixel(t, x0 + 1, y0);
  const h01 = terrariumPixel(t, x0, y0 + 1);
  const h11 = terrariumPixel(t, x0 + 1, y0 + 1);
  return (h00 * (1 - ax) + h10 * ax) * (1 - ay) + (h01 * (1 - ax) + h11 * ax) * ay;
}

// ─── Copernicus GLO-30 sampling (single windowed read) ───────

interface CopernicusWindow {
  values: Float32Array;
  width: number;
  height: number;
  /** Geographic bounds of the window `[west, south, east, north]`. */
  bbox: [number, number, number, number];
  resX: number;
  resY: number;
}

/**
 * One `readRasters({window})` for the whole box — per-sample reads are orders
 * of magnitude slower (terrain-report gotcha #3).
 */
async function readCopernicusWindow(cfg: ResortBakeConfig): Promise<CopernicusWindow> {
  if (!cfg.copernicusTile) throw new Error(`${cfg.slug} has no Copernicus tile configured`);
  const name = `Copernicus_DSM_COG_10_${cfg.copernicusTile}_DEM`;
  const url = `${COPERNICUS_URL}/${name}/${name}.tif`;
  const tiff = await fromUrl(url);
  const img = await tiff.getImage();
  const bb = img.getBoundingBox() as [number, number, number, number]; // west,south,east,north
  const W = img.getWidth();
  const H = img.getHeight();
  const resX = (bb[2] - bb[0]) / W;
  const resY = (bb[3] - bb[1]) / H;

  const [cLat, cLon] = cfg.center;
  const half = cfg.sizeM / 2;
  // Two extra pixels of margin so bilinear taps at the box edge stay inside.
  const marginDeg = 2 * Math.max(resX, resY);
  const lonW = cLon - half / mPerDegLon(cLat) - marginDeg;
  const lonE = cLon + half / mPerDegLon(cLat) + marginDeg;
  const latS = cLat - half / M_PER_DEG_LAT - marginDeg;
  const latN = cLat + half / M_PER_DEG_LAT + marginDeg;

  const x0 = Math.max(0, Math.floor((lonW - bb[0]) / resX));
  const x1 = Math.min(W, Math.ceil((lonE - bb[0]) / resX));
  const y0 = Math.max(0, Math.floor((bb[3] - latN) / resY));
  const y1 = Math.min(H, Math.ceil((bb[3] - latS) / resY));

  const rasters = await img.readRasters({ window: [x0, y0, x1, y1] });
  const values = Float32Array.from(rasters[0] as ArrayLike<number>);
  console.log(`  read Copernicus window ${rasters.width}x${rasters.height} from ${name}`);
  return {
    values,
    width: rasters.width,
    height: rasters.height,
    bbox: [bb[0] + x0 * resX, bb[3] - y1 * resY, bb[0] + x1 * resX, bb[3] - y0 * resY],
    resX,
    resY,
  };
}

function sampleCopernicus(w: CopernicusWindow, lat: number, lon: number): number {
  const fx = (lon - w.bbox[0]) / w.resX - 0.5;
  const fy = (w.bbox[3] - lat) / w.resY - 0.5;
  const x0 = Math.max(0, Math.min(w.width - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(w.height - 1, Math.floor(fy)));
  const x1 = Math.min(w.width - 1, x0 + 1);
  const y1 = Math.min(w.height - 1, y0 + 1);
  const ax = fx - x0;
  const ay = fy - y0;
  const g = (x: number, y: number) => w.values[y * w.width + x];
  return (
    (g(x0, y0) * (1 - ax) + g(x1, y0) * ax) * (1 - ay) + (g(x0, y1) * (1 - ax) + g(x1, y1) * ax) * ay
  );
}

// ─── Heightfield bake ────────────────────────────────────────

export interface BakedFile {
  name: string;
  data: Buffer;
}

async function bakeHeightfield(
  cfg: ResortBakeConfig,
  source: TerrainSource,
  zoom: number,
): Promise<BakedFile[]> {
  const [cLat, cLon] = cfg.center;
  const half = cfg.sizeM / 2;
  const cell = cfg.sizeM / (GRID - 1);
  const mLat = M_PER_DEG_LAT;
  const mLon = mPerDegLon(cLat);

  const sample =
    source === "terrarium"
      ? await (async () => {
          const tiles = await prefetchTerrariumTiles(cfg, zoom);
          return (lat: number, lon: number) => sampleTerrarium(tiles, lat, lon);
        })()
      : await (async () => {
          const win = await readCopernicusWindow(cfg);
          return (lat: number, lon: number) => sampleCopernicus(win, lat, lon);
        })();

  const raw = new Float64Array(GRID * GRID);
  for (let row = 0; row < GRID; row++) {
    // row 0 = north edge, col 0 = west edge (see formats.ts orientation contract)
    const lat = cLat + (half - row * cell) / mLat;
    for (let col = 0; col < GRID; col++) {
      const lon = cLon + (col * cell - half) / mLon;
      raw[row * GRID + col] = sample(lat, lon);
    }
  }

  let sampleMin = Infinity;
  let sampleMax = -Infinity;
  for (const v of raw) {
    if (!Number.isFinite(v)) throw new Error(`${cfg.slug}: non-finite elevation sampled`);
    if (v < sampleMin) sampleMin = v;
    if (v > sampleMax) sampleMax = v;
  }
  // Snap the datum to a quantum multiple so the encoding is reproducible and
  // code 0 means exactly minZ.
  const minZ = Number((Math.floor(sampleMin / QUANTUM) * QUANTUM).toFixed(3));
  const maxCode = quantizeHeight(sampleMax, minZ, QUANTUM);
  if (maxCode >= 65535) {
    throw new Error(`${cfg.slug}: relief ${(sampleMax - sampleMin).toFixed(0)} m exceeds uint16 range at ${QUANTUM} m`);
  }
  const maxZ = Number((minZ + maxCode * QUANTUM).toFixed(3));

  const u16 = Buffer.alloc(GRID * GRID * 2);
  for (let i = 0; i < raw.length; i++) {
    u16.writeUInt16LE(quantizeHeight(raw[i], minZ, QUANTUM), i * 2);
  }

  // pngjs takes 16-bit samples in host (little-endian) order and byte-swaps
  // them into the big-endian on-the-wire form itself — feeding it the u16
  // buffer verbatim is correct, feeding it big-endian bytes is not.
  const png = new PNG({ width: GRID, height: GRID, colorType: 0, bitDepth: 16, inputHasAlpha: false });
  png.data = u16;
  const pngBuf = PNG.sync.write(png, {
    colorType: 0,
    bitDepth: 16,
    inputColorType: 0,
    deflateLevel: 9,
  });

  const meta: TerrainMeta = {
    version: META_VERSION,
    slug: cfg.slug,
    center: [cLat, cLon],
    sizeM: cfg.sizeM,
    grid: GRID,
    minZ,
    maxZ,
    quantum: QUANTUM,
    source,
    sourceZoom: source === "terrarium" ? zoom : null,
    orientation: HEIGHTFIELD_ORIENTATION,
    bakedAt: new Date().toISOString(),
  };

  console.log(
    `  heightfield ${GRID}x${GRID} over ${cfg.sizeM} m (${cell.toFixed(2)} m/px) | ` +
      `elev ${meta.minZ.toFixed(1)}–${meta.maxZ.toFixed(1)} m (relief ${(meta.maxZ - meta.minZ).toFixed(0)} m)`,
  );

  return [
    { name: `${cfg.slug}.height.u16`, data: u16 },
    { name: `${cfg.slug}.height.u16.br`, data: brotli(u16) },
    { name: `${cfg.slug}.height.png`, data: pngBuf },
    { name: `${cfg.slug}.meta.json`, data: Buffer.from(JSON.stringify(meta, null, 2) + "\n") },
  ];
}

function brotli(input: Buffer): Buffer {
  return zlib.brotliCompressSync(input, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
      [zlib.constants.BROTLI_PARAM_LGWIN]: 24,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: input.length,
    },
  });
}

// ─── Trail geometry ──────────────────────────────────────────

export type Pt = [number, number];

/** Ramer–Douglas–Peucker simplification with a perpendicular-distance tolerance. */
export function rdp(points: Pt[], epsilon: number): Pt[] {
  if (points.length < 3) return points.slice();
  const a = points[0];
  const b = points[points.length - 1];
  let maxDist = 0;
  let maxIndex = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], a, b);
    if (d > maxDist) {
      maxDist = d;
      maxIndex = i;
    }
  }
  if (maxDist <= epsilon) return [a, b];
  const left = rdp(points.slice(0, maxIndex + 1), epsilon);
  const right = rdp(points.slice(maxIndex), epsilon);
  return [...left.slice(0, -1), ...right];
}

function perpendicularDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/**
 * Clip a polyline to the square `[-half, half]²` (Liang–Barsky per segment),
 * returning the pieces that survive. Splitting rather than point-filtering
 * matters: a run that leaves and re-enters the box must not gain a straight
 * shortcut across it.
 */
export function clipPolylineToBox(points: Pt[], half: number): Pt[][] {
  const pieces: Pt[][] = [];
  let current: Pt[] | null = null;
  const EPS = 1e-6;

  for (let i = 0; i + 1 < points.length; i++) {
    const seg = clipSegment(points[i], points[i + 1], half);
    if (!seg) {
      current = null;
      continue;
    }
    const [a, b] = seg;
    if (current && Math.abs(current[current.length - 1][0] - a[0]) < EPS && Math.abs(current[current.length - 1][1] - a[1]) < EPS) {
      current.push(b);
    } else {
      current = [a, b];
      pieces.push(current);
    }
  }
  // A single point inside the box carries no geometry; drop degenerate pieces.
  return pieces.filter((p) => p.length >= 2);
}

function clipSegment(a: Pt, b: Pt, half: number): [Pt, Pt] | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0; // parallel to this edge: inside iff q >= 0
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (!clip(-dx, a[0] + half)) return null;
  if (!clip(dx, half - a[0])) return null;
  if (!clip(-dy, a[1] + half)) return null;
  if (!clip(dy, half - a[1])) return null;
  if (t1 <= t0) return null;
  return [
    [a[0] + t0 * dx, a[1] + t0 * dy],
    [a[0] + t1 * dx, a[1] + t1 * dy],
  ];
}

// ─── Overpass ────────────────────────────────────────────────

const LIFT_TYPES =
  "^(chair_lift|gondola|cable_car|t-bar|platter|rope_tow|mixed_lift|drag_lift|magic_carpet)$";

export function overpassQuery(bbox: [number, number, number, number]): string {
  const b = bbox.join(",");
  return `[out:json][timeout:120];
(
  way["piste:type"="downhill"](${b});
  way["aerialway"~"${LIFT_TYPES}"](${b});
);
out geom;`;
}

interface OverpassWay {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

/** GET, never POST — overpass-api.de intermittently rejects POST (gotcha #1). */
async function fetchOverpass(cfg: ResortBakeConfig): Promise<OverpassWay[]> {
  const query = overpassQuery(cfg.bbox);
  let lastError: unknown;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const url = `${endpoint}?${new URLSearchParams({ data: query })}`;
      const buf = await fetchWithRetry(url, `overpass ${new URL(endpoint).host}`);
      const json = JSON.parse(buf.toString("utf8")) as { elements?: OverpassWay[] };
      if (!json.elements) throw new Error("no elements in response");
      console.log(`  overpass ${new URL(endpoint).host}: ${json.elements.length} ways (${(buf.length / 1024).toFixed(0)} KB)`);
      return json.elements;
    } catch (err) {
      lastError = err;
      console.warn(`  ! ${endpoint} failed: ${String(err)} — trying next endpoint`);
    }
  }
  throw new Error(`all Overpass endpoints failed: ${String(lastError)}`);
}

function bakeTrails(cfg: ResortBakeConfig, elements: OverpassWay[]): BakedFile[] {
  const [cLat, cLon] = cfg.center;
  const mLon = mPerDegLon(cLat);
  const half = cfg.sizeM / 2;
  const runs: RawRun[] = [];
  const lifts: RawLift[] = [];

  for (const el of elements) {
    if (!el.geometry || el.geometry.length < 2) continue;
    const tags = el.tags ?? {};
    const projected: Pt[] = el.geometry.map((g) => [(g.lon - cLon) * mLon, (g.lat - cLat) * M_PER_DEG_LAT]);
    const isRun = Boolean(tags["piste:type"]);

    for (const piece of clipPolylineToBox(projected, half)) {
      const simplified = rdp(piece, RDP_EPSILON_M);
      if (simplified.length < 2) continue;
      const quantized = simplified.map(
        (p) => [Math.round(p[0] / TRAIL_UNIT), Math.round(p[1] / TRAIL_UNIT)] as const,
      );
      const name = tags.name ?? tags["piste:name"] ?? null;
      const p = encodeDelta(quantized);
      if (isRun) {
        const run: RawRun = { n: name, p };
        run.d = tags["piste:difficulty"] ?? null;
        if (tags["piste:grooming"]) run.g = tags["piste:grooming"];
        if (tags.gladed === "yes") run.gl = 1;
        if (tags.oneway === "yes" || tags["piste:oneway"] === "yes") run.o = 1;
        runs.push(run);
      } else if (tags.aerialway) {
        lifts.push({ n: name, t: tags.aerialway, p });
      }
    }
  }

  const file: TrailsFile = {
    v: TRAILS_VERSION,
    center: [cLat, cLon],
    sizeM: cfg.sizeM,
    unit: TRAIL_UNIT,
    convention: cfg.convention,
    runs,
    lifts,
  };
  const json = Buffer.from(JSON.stringify(file));
  const nodes = [...runs, ...lifts].reduce((a, r) => a + r.p.length / 2, 0);
  console.log(
    `  trails: ${runs.length} runs, ${lifts.length} lifts, ${nodes} nodes | ` +
      `json ${(json.length / 1024).toFixed(1)} KB`,
  );
  return [
    { name: `${cfg.slug}.trails.json`, data: json },
    { name: `${cfg.slug}.trails.json.br`, data: brotli(json) },
  ];
}

// ─── Orchestration ───────────────────────────────────────────

export interface BakeOptions {
  source: TerrainSource;
  zoom: number;
  skipTrails: boolean;
}

export async function bakeResort(cfg: ResortBakeConfig, opts: BakeOptions): Promise<BakedFile[]> {
  console.log(`\n▸ ${cfg.name} (${cfg.slug}) — ${opts.source}`);
  const files = await bakeHeightfield(cfg, opts.source, opts.zoom);
  if (!opts.skipTrails) {
    files.push(...bakeTrails(cfg, await fetchOverpass(cfg)));
  }
  return files;
}

function writeFiles(files: BakedFile[]): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const f of files) {
    fs.writeFileSync(path.join(OUT_DIR, f.name), f.data);
    console.log(`  wrote ${f.name} (${(f.data.length / 1024).toFixed(1)} KB)`);
  }
}

const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

/**
 * Compare a fresh bake against the committed files. `bakedAt` is expected to
 * differ, so meta files are compared with that field normalised; everything
 * else must be byte-identical.
 */
function verifyFiles(files: BakedFile[]): { name: string; reason: string }[] {
  const diffs: { name: string; reason: string }[] = [];
  for (const f of files) {
    const p = path.join(OUT_DIR, f.name);
    if (!fs.existsSync(p)) {
      diffs.push({ name: f.name, reason: "missing on disk" });
      continue;
    }
    const onDisk = fs.readFileSync(p);
    if (f.name.endsWith(".meta.json")) {
      const strip = (b: Buffer) => {
        const j = JSON.parse(b.toString("utf8")) as Record<string, unknown>;
        delete j.bakedAt;
        return JSON.stringify(j);
      };
      if (strip(onDisk) !== strip(f.data)) diffs.push({ name: f.name, reason: "meta fields differ" });
      else console.log(`  ✓ ${f.name} (ignoring bakedAt)`);
      continue;
    }
    if (sha256(onDisk) === sha256(f.data)) {
      console.log(`  ✓ ${f.name} ${sha256(f.data).slice(0, 12)}`);
    } else {
      diffs.push({
        name: f.name,
        reason: `sha256 ${sha256(onDisk).slice(0, 12)} on disk vs ${sha256(f.data).slice(0, 12)} rebaked`,
      });
    }
  }
  return diffs;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith("--"));
  const verify = args.includes("--verify");
  const skipTrails = args.includes("--skip-trails");
  const sourceArg = args.find((a) => a.startsWith("--source="))?.split("=")[1] ?? "terrarium";

  if (!target || (target !== "all" && !RESORT_BAKE_CONFIGS[target])) {
    console.error(`Usage: npx tsx scripts/bake-resort.ts <${RESORT_SLUGS.join("|")}|all> [--verify] [--source=terrarium|copernicus] [--skip-trails]`);
    process.exit(1);
  }
  if (sourceArg !== "terrarium" && sourceArg !== "copernicus") {
    console.error(`Unknown --source=${sourceArg} (expected terrarium or copernicus)`);
    process.exit(1);
  }

  const slugs = target === "all" ? RESORT_SLUGS : [target];
  const allDiffs: { name: string; reason: string }[] = [];

  for (const [i, slug] of slugs.entries()) {
    const cfg = RESORT_BAKE_CONFIGS[slug];
    const source: TerrainSource =
      sourceArg === "copernicus" && cfg.copernicusTile ? "copernicus" : "terrarium";
    if (sourceArg === "copernicus" && !cfg.copernicusTile) {
      console.warn(`  ! ${slug} has no Copernicus tile configured; falling back to terrarium`);
    }
    const files = await bakeResort(cfg, { source, zoom: SOURCE_ZOOM, skipTrails });
    if (verify) allDiffs.push(...verifyFiles(files));
    else writeFiles(files);
    if (!skipTrails && i < slugs.length - 1) {
      console.log(`  sleeping ${OVERPASS_SLEEP_MS / 1000}s before the next Overpass query`);
      await sleep(OVERPASS_SLEEP_MS);
    }
  }

  if (verify) {
    if (allDiffs.length === 0) {
      console.log("\n✓ verify: re-bake is byte-identical to the committed assets");
    } else {
      console.error(`\n✗ verify: ${allDiffs.length} file(s) differ from the committed assets:`);
      for (const d of allDiffs) console.error(`  - ${d.name}: ${d.reason}`);
      console.error("  (upstream DEM tiles or OSM data changed, or the bake is not reproducible)");
      process.exit(1);
    }
  } else {
    console.log("\n✓ bake complete");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
