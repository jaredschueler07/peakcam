/**
 * validate-game-assets.ts
 * ───────────────────────
 * Decode round-trip checks on the committed Drop In v2 terrain assets. Run it
 * after every bake and in review — it is the cheap guard against a heightfield
 * that decodes to the wrong shape, wrong place, or wrong orientation.
 *
 * Usage:
 *   npx tsx scripts/validate-game-assets.ts            # all resorts
 *   npx tsx scripts/validate-game-assets.ts breckenridge
 *
 * The heightfield is read from the committed `.u16.br` sidecar: the raw `.u16`
 * is a gitignored bake intermediate, so the compressed file is the source of
 * truth. When a raw file does happen to be lying around from a local bake it is
 * cross-checked against the decompressed bytes as a bonus.
 *
 * Checks per resort:
 *   - meta.json matches the schema and the configured extents
 *   - .u16.br decompresses, byte length matches grid², decodes without throwing
 *   - decoded min/max are inside the elevation band the resort plausibly spans
 *   - corner and centre elevations are finite and inside [minZ, maxZ]
 *   - the PNG16 artifact decodes to the same uint16 codes
 *   - trails JSON parses, delta-decodes, and every point sits inside the box
 *   - the .br trails sidecar decompresses to exactly the .json bytes
 *
 * Exits non-zero on the first resort with failures (all failures are printed).
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import {
  HEIGHTFIELD_ORIENTATION,
  decodeDelta,
  decodeHeightfield,
  decodeTrails,
  quantizeHeight,
  type TerrainMeta,
  type TrailsFile,
} from "@/lib/game/terrain/formats";
import {
  GRID,
  QUANTUM,
  RESORT_BAKE_CONFIGS,
  RESORT_SLUGS,
  type ResortBakeConfig,
} from "@/lib/game/terrain/resorts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSET_DIR = path.join(path.resolve(__dirname, ".."), "public", "game", "terrain");

/**
 * How far outside the resort-polygon elevation band the bake box may reach.
 * The box is up to 6 km across and centred on the ski area, so it takes in
 * valley floors and neighbouring summits; this only catches gross errors
 * (wrong tile, wrong hemisphere, undecoded values).
 */
const BAND_SLACK_M = 900;
/** Per-resort brotli budget for the runtime pack (PLAN.md Phase 5 gate). */
const PACK_BUDGET_BYTES = 1.5 * 1024 * 1024;

class Report {
  readonly failures: string[] = [];
  constructor(readonly slug: string) {}
  check(ok: boolean, label: string, detail = ""): void {
    if (ok) console.log(`    ✓ ${label}${detail ? ` — ${detail}` : ""}`);
    else {
      console.log(`    ✗ ${label}${detail ? ` — ${detail}` : ""}`);
      this.failures.push(`${this.slug}: ${label}${detail ? ` (${detail})` : ""}`);
    }
  }
}

function readAsset(name: string): Buffer {
  const p = path.join(ASSET_DIR, name);
  if (!fs.existsSync(p)) throw new Error(`missing asset ${name}`);
  return fs.readFileSync(p);
}

/** Hand-rolled meta validation (zod is not a dependency until Phase 0 lands). */
function validateMeta(r: Report, meta: unknown, cfg: ResortBakeConfig): meta is TerrainMeta {
  const m = meta as Record<string, unknown>;
  const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const problems: string[] = [];
  if (m.version !== 1) problems.push(`version=${String(m.version)}`);
  if (m.slug !== cfg.slug) problems.push(`slug=${String(m.slug)}`);
  if (!Array.isArray(m.center) || m.center.length !== 2 || !m.center.every(isNum)) {
    problems.push("center");
  } else if (m.center[0] !== cfg.center[0] || m.center[1] !== cfg.center[1]) {
    problems.push(`center ${JSON.stringify(m.center)} != configured ${JSON.stringify(cfg.center)}`);
  }
  if (m.sizeM !== cfg.sizeM) problems.push(`sizeM=${String(m.sizeM)}`);
  if (m.grid !== GRID) problems.push(`grid=${String(m.grid)}`);
  if (m.quantum !== QUANTUM) problems.push(`quantum=${String(m.quantum)}`);
  if (!isNum(m.minZ) || !isNum(m.maxZ) || (m.minZ as number) >= (m.maxZ as number)) {
    problems.push(`minZ/maxZ ${String(m.minZ)}/${String(m.maxZ)}`);
  }
  if (m.source !== "terrarium" && m.source !== "copernicus") problems.push(`source=${String(m.source)}`);
  if (m.source === "terrarium" ? !isNum(m.sourceZoom) : m.sourceZoom !== null) {
    problems.push(`sourceZoom=${String(m.sourceZoom)}`);
  }
  if (m.orientation !== HEIGHTFIELD_ORIENTATION) problems.push("orientation string drifted");
  if (typeof m.bakedAt !== "string" || Number.isNaN(Date.parse(m.bakedAt as string))) {
    problems.push(`bakedAt=${String(m.bakedAt)}`);
  }
  r.check(problems.length === 0, "meta schema", problems.join("; "));
  return problems.length === 0;
}

function validateResort(cfg: ResortBakeConfig): Report {
  const r = new Report(cfg.slug);
  console.log(`\n▸ ${cfg.name} (${cfg.slug})`);

  const metaRaw = JSON.parse(readAsset(`${cfg.slug}.meta.json`).toString("utf8")) as unknown;
  if (!validateMeta(r, metaRaw, cfg)) return r;
  const meta = metaRaw as TerrainMeta;

  // ── heightfield ────────────────────────────────────────────
  const br = readAsset(`${cfg.slug}.height.u16.br`);
  const u16 = zlib.brotliDecompressSync(br);
  r.check(u16.length === meta.grid * meta.grid * 2, "u16.br decompresses to grid-sized data", `${u16.length} bytes`);
  if (u16.length !== meta.grid * meta.grid * 2) return r;

  const field = decodeHeightfield(
    u16.buffer.slice(u16.byteOffset, u16.byteOffset + u16.byteLength) as ArrayBuffer,
    meta,
  );
  const [bandLo, bandHi] = cfg.elevationBand;
  r.check(
    field.minZ < field.maxZ,
    "decoded minZ < maxZ",
    `${field.minZ.toFixed(1)}–${field.maxZ.toFixed(1)} m (relief ${(field.maxZ - field.minZ).toFixed(0)} m)`,
  );
  r.check(
    field.minZ >= bandLo - BAND_SLACK_M && field.maxZ <= bandHi + BAND_SLACK_M,
    "elevations inside the resort band ± slack",
    `band ${bandLo}–${bandHi} m, slack ${BAND_SLACK_M} m`,
  );
  r.check(
    field.maxZ - field.minZ > 200,
    "relief is mountain-sized",
    `${(field.maxZ - field.minZ).toFixed(0)} m`,
  );
  r.check(
    Math.abs(field.minZ - meta.minZ) < QUANTUM && Math.abs(field.maxZ - meta.maxZ) < QUANTUM,
    "decoded range agrees with meta minZ/maxZ",
  );

  const n = meta.grid;
  const probes: Array<[string, number]> = [
    ["NW corner", 0],
    ["NE corner", n - 1],
    ["SW corner", (n - 1) * n],
    ["SE corner", n * n - 1],
    ["centre", Math.floor(n / 2) * n + Math.floor(n / 2)],
  ];
  const bad = probes.filter(([, i]) => {
    const z = field.heights[i];
    return !Number.isFinite(z) || z < meta.minZ - QUANTUM || z > meta.maxZ + QUANTUM;
  });
  r.check(
    bad.length === 0,
    "probe elevations in range",
    probes.map(([label, i]) => `${label} ${field.heights[i].toFixed(1)}m`).join(", "),
  );

  // The raw .u16 is gitignored; check it only when a local bake left one behind.
  const rawPath = path.join(ASSET_DIR, `${cfg.slug}.height.u16`);
  if (fs.existsSync(rawPath)) {
    r.check(fs.readFileSync(rawPath).equals(u16), "local raw .u16 intermediate matches the committed .br");
  } else {
    console.log("    · no local raw .u16 intermediate (expected — it is gitignored)");
  }
  r.check(
    br.length <= PACK_BUDGET_BYTES,
    "u16.br inside the pack budget",
    `${(br.length / 1024).toFixed(0)} KB of ${(PACK_BUDGET_BYTES / 1024).toFixed(0)} KB`,
  );

  // skipRescale keeps the full 16-bit samples (pngjs otherwise squashes them to
  // 8-bit); the result is a Uint16Array expanded to RGBA, so read channel 0.
  const png = PNG.sync.read(readAsset(`${cfg.slug}.height.png`), { skipRescale: true });
  const pngSamples = png.data as unknown as Uint16Array;
  let pngMismatch = -1;
  if (png.width !== n || png.height !== n) pngMismatch = -2;
  else {
    for (let i = 0; i < n * n; i++) {
      if (pngSamples[i * 4] !== u16.readUInt16LE(i * 2)) {
        pngMismatch = i;
        break;
      }
    }
  }
  r.check(
    pngMismatch === -1,
    "PNG16 artifact holds the same codes",
    pngMismatch === -2 ? `size ${png.width}x${png.height}` : pngMismatch >= 0 ? `first mismatch at index ${pngMismatch}` : "",
  );

  // Round-trip the decoded elevations back through quantisation.
  let maxRoundTripError = 0;
  for (let i = 0; i < field.heights.length; i += 97) {
    const code = quantizeHeight(field.heights[i], meta.minZ, meta.quantum);
    maxRoundTripError = Math.max(
      maxRoundTripError,
      Math.abs(meta.minZ + code * meta.quantum - field.heights[i]),
    );
  }
  r.check(
    maxRoundTripError <= QUANTUM / 2 + 1e-6,
    "quantise round-trip within half a quantum",
    `max ${maxRoundTripError.toFixed(4)} m`,
  );

  // ── trails ─────────────────────────────────────────────────
  const trailsBuf = readAsset(`${cfg.slug}.trails.json`);
  const trailsJson = JSON.parse(trailsBuf.toString("utf8")) as TrailsFile;
  r.check(trailsJson.v === 1, "trails version");
  r.check(
    trailsJson.sizeM === cfg.sizeM &&
      trailsJson.center[0] === cfg.center[0] &&
      trailsJson.center[1] === cfg.center[1],
    "trails georeference matches the heightfield",
  );
  const trails = decodeTrails(trailsJson);
  r.check(trails.runs.length > 0 && trails.lifts.length > 0, "runs and lifts present", `${trails.runs.length} runs, ${trails.lifts.length} lifts`);

  const half = cfg.sizeM / 2 + 0.05; // half a decimetre of quantisation slack
  let outside = 0;
  let shortPolylines = 0;
  let nodes = 0;
  for (const poly of [...trails.runs, ...trails.lifts]) {
    if (poly.points.length < 2) shortPolylines++;
    for (const p of poly.points) {
      nodes++;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > half || Math.abs(p.y) > half) {
        outside++;
      }
    }
  }
  r.check(outside === 0, "all trail points inside the box", `${nodes} nodes checked`);
  r.check(shortPolylines === 0, "no degenerate polylines");

  // Delta round-trip: re-encode the decoded integers and compare to the file.
  let deltaMismatch = 0;
  for (const raw of [...trailsJson.runs, ...trailsJson.lifts]) {
    const abs = decodeDelta(raw.p);
    const reencoded: number[] = [];
    let px = 0;
    let py = 0;
    abs.forEach(([x, y], i) => {
      reencoded.push(i === 0 ? x : x - px, i === 0 ? y : y - py);
      px = x;
      py = y;
    });
    if (reencoded.length !== raw.p.length || reencoded.some((v, i) => v !== raw.p[i])) deltaMismatch++;
  }
  r.check(deltaMismatch === 0, "delta encoding round-trips exactly");

  const trailsBr = readAsset(`${cfg.slug}.trails.json.br`);
  r.check(zlib.brotliDecompressSync(trailsBr).equals(trailsBuf), "trails.json.br decompresses to the JSON bytes");

  const packBytes = br.length + trailsBr.length;
  r.check(
    packBytes <= PACK_BUDGET_BYTES,
    "runtime pack inside budget",
    `${(packBytes / 1024).toFixed(0)} KB (u16.br ${(br.length / 1024).toFixed(0)} + trails.br ${(trailsBr.length / 1024).toFixed(1)})`,
  );

  return r;
}

function main(): void {
  const target = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (target && !RESORT_BAKE_CONFIGS[target]) {
    console.error(`Unknown resort ${target}; expected one of ${RESORT_SLUGS.join(", ")}`);
    process.exit(1);
  }
  const slugs = target ? [target] : RESORT_SLUGS;
  const failures: string[] = [];
  for (const slug of slugs) failures.push(...validateResort(RESORT_BAKE_CONFIGS[slug]).failures);

  if (failures.length > 0) {
    console.error(`\n✗ ${failures.length} check(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`\n✓ all checks passed for ${slugs.length} resort(s)`);
}

main();
