/**
 * lib/descent/world/forest.ts
 * ───────────────────────────
 * Plant the mountain the way the trail map shows it: solid conifer forest
 * below treeline with the runs cut through it, thinning to nothing across the
 * treeline band, bare above.
 *
 * Density comes from the OSM forest polygons in the trails asset — dense
 * inside them, sparse outside (base areas, meadows, the town) — and every run
 * corridor and lift line is cleared, except gladed runs, which keep a few
 * trees. Placement is a jittered grid so nothing reads as a pattern, seeded
 * so a resort always grows the same forest.
 *
 * Pure and allocation-conscious: rasterises the polygons once into a coarse
 * mask, buckets the run/lift segments once, then walks the grid.
 */

import { createGridSample, sampleGridBicubic } from "@/lib/game/terrain/bicubic";
import type { Heightfield, ForestPolygon, TrailPoint } from "@/lib/game/terrain/formats";
import { mulberry32 } from "@/lib/game/core/rng";
import type { DrapedLift, DrapedRun } from "@/lib/game/terrain/real-heightfield";
import type { TreeSite } from "../types";

export interface ForestOptions {
  field: Heightfield;
  halfSizeM: number;
  forests: readonly ForestPolygon[];
  runs: readonly DrapedRun[];
  lifts: readonly DrapedLift[];
  lakes: readonly { elevationM: number; outer: readonly { x: number; z: number }[] }[];
  /** No trees above this elevation; 0 means the resort has no forest at all. */
  treeLineM: number;
  seed: number;
  /** Hard cap on the number of trees. */
  maxTrees?: number;
}

/** Grid pitch inside forest polygons, metres (≈ one tree per 56 m²). */
const PITCH_M = 8;
/** Acceptance probability outside a mapped forest but below treeline. */
const OPEN_DENSITY = 0.16;
/** Width of the band below treeline over which the forest thins out. */
const TREELINE_FADE_M = 160;
/** Runs are cleared this far beyond their half-width. */
const RUN_MARGIN_M = 3;
const LIFT_HALF_M = 5;
/** Gladed runs keep this fraction of their trees. */
const GLADE_KEEP = 0.3;
const MASK_CELL_M = 8;
const SEGMENT_CELL_M = 48;
const MAX_GRADE = 1.05;

export function plantForest(options: ForestOptions): TreeSite[] {
  const { field, halfSizeM, treeLineM, seed } = options;
  if (treeLineM <= 0) return [];
  const maxTrees = options.maxTrees ?? 200_000;
  const random = mulberry32(seed ^ 0x0f0e5);
  const mask = rasterise(options.forests, halfSizeM);
  const segments = bucketSegments(options.runs, options.lifts);
  const sample = createGridSample();
  const cell = field.cellSizeM;
  const lakeBoxes = options.lakes.map((lake) => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of lake.outer) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    return { lake, minX, maxX, minZ, maxZ };
  });

  const trees: TreeSite[] = [];
  const steps = Math.floor((halfSizeM * 2) / PITCH_M);
  for (let j = 0; j < steps; j++) {
    for (let i = 0; i < steps; i++) {
      const x = -halfSizeM + (i + 0.15 + random() * 0.7) * PITCH_M;
      const z = -halfSizeM + (j + 0.15 + random() * 0.7) * PITCH_M;
      const inForest = mask.get(x, z);
      const roll = random();
      if (!inForest && roll > OPEN_DENSITY) continue;

      sampleGridBicubic(field, (x + halfSizeM) / cell, (z + halfSizeM) / cell, sample);
      const y = sample.value;
      if (y > treeLineM) continue;
      const band = (treeLineM - y) / TREELINE_FADE_M;
      if (band < 1 && random() > band * band) continue;
      const grade = Math.hypot(sample.dCol, sample.dRow) / cell;
      if (grade > MAX_GRADE) continue;

      const clearance = segments.query(x, z);
      if (clearance === "clear") continue;
      if (clearance === "glade" && random() > GLADE_KEEP) continue;

      let inLake = false;
      for (const box of lakeBoxes) {
        if (x < box.minX || x > box.maxX || z < box.minZ || z > box.maxZ) continue;
        if (pointInPolygon(x, z, box.lake.outer)) { inLake = true; break; }
      }
      if (inLake) continue;

      const variant = random();
      // Mature stands inside the mapped forest; scrappier trees in the open and near treeline.
      const scale = (inForest ? 1 : 0.8) * (band < 1 ? 0.6 + 0.4 * band : 1);
      const heightM = (6 + variant * 10) * scale;
      trees.push({ x, y, z, radiusM: 0.4 + variant * 0.35, heightM, variant });
      if (trees.length >= maxTrees) return trees;
    }
  }
  return trees;
}

// ─── Forest polygon mask ────────────────────────────────────

interface Mask { get(x: number, z: number): boolean }

/** Even-odd scanline fill of every polygon into a coarse bitmap (game x/z). */
function rasterise(forests: readonly ForestPolygon[], halfSizeM: number): Mask {
  const size = Math.ceil((halfSizeM * 2) / MASK_CELL_M);
  const bits = new Uint8Array(size * size);
  const toCol = (x: number) => (x + halfSizeM) / MASK_CELL_M;
  const toRow = (z: number) => (z + halfSizeM) / MASK_CELL_M;
  for (const forest of forests) {
    const pts = forest.points;
    if (pts.length < 3) continue;
    // Asset y is north; game z = -y.
    let minRow = Infinity, maxRow = -Infinity;
    for (const p of pts) { const r = toRow(-p.y); minRow = Math.min(minRow, r); maxRow = Math.max(maxRow, r); }
    const r0 = Math.max(0, Math.floor(minRow)), r1 = Math.min(size - 1, Math.ceil(maxRow));
    const crossings: number[] = [];
    for (let row = r0; row <= r1; row++) {
      const zRow = row + 0.5;
      crossings.length = 0;
      for (let k = 0; k < pts.length; k++) {
        const a = pts[k], b = pts[(k + 1) % pts.length];
        const az = toRow(-a.y), bz = toRow(-b.y);
        if ((az <= zRow) === (bz <= zRow)) continue;
        const t = (zRow - az) / (bz - az);
        crossings.push(toCol(a.x) + (toCol(b.x) - toCol(a.x)) * t);
      }
      crossings.sort((p, q) => p - q);
      for (let c = 0; c + 1 < crossings.length; c += 2) {
        const c0 = Math.max(0, Math.round(crossings[c])), c1 = Math.min(size - 1, Math.round(crossings[c + 1]));
        for (let col = c0; col < c1; col++) bits[row * size + col] = 1;
      }
    }
  }
  return {
    get(x, z) {
      const col = Math.floor(toCol(x)), row = Math.floor(toRow(z));
      if (col < 0 || row < 0 || col >= size || row >= size) return false;
      return bits[row * size + col] === 1;
    },
  };
}

// ─── Run / lift clearance ───────────────────────────────────

type Clearance = "keep" | "glade" | "clear";

interface SegmentBuckets { query(x: number, z: number): Clearance }

function bucketSegments(runs: readonly DrapedRun[], lifts: readonly DrapedLift[]): SegmentBuckets {
  const ax: number[] = [], az: number[] = [], bx: number[] = [], bz: number[] = [], radius: number[] = [], glade: boolean[] = [];
  const add = (points: readonly { x: number; z: number }[], r: number, isGlade: boolean) => {
    for (let i = 1; i < points.length; i++) {
      ax.push(points[i - 1].x); az.push(points[i - 1].z); bx.push(points[i].x); bz.push(points[i].z);
      radius.push(r); glade.push(isGlade);
    }
  };
  for (const run of runs) add(run.points, Math.min(20, run.halfWidthM) + RUN_MARGIN_M, run.gladed);
  for (const lift of lifts) add(lift.points, LIFT_HALF_M, false);

  const buckets = new Map<number, number[]>();
  const key = (cx: number, cz: number) => (cx + 4096) * 8192 + (cz + 4096);
  const cellOf = (v: number) => Math.floor(v / SEGMENT_CELL_M);
  for (let s = 0; s < ax.length; s++) {
    const r = radius[s];
    const c0 = cellOf(Math.min(ax[s], bx[s]) - r), c1 = cellOf(Math.max(ax[s], bx[s]) + r);
    const d0 = cellOf(Math.min(az[s], bz[s]) - r), d1 = cellOf(Math.max(az[s], bz[s]) + r);
    for (let cx = c0; cx <= c1; cx++) for (let cz = d0; cz <= d1; cz++) {
      const k = key(cx, cz);
      const list = buckets.get(k);
      if (list) list.push(s); else buckets.set(k, [s]);
    }
  }
  return {
    query(x, z) {
      const list = buckets.get(key(cellOf(x), cellOf(z)));
      if (!list) return "keep";
      let result: Clearance = "keep";
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        const ex = bx[s] - ax[s], ez = bz[s] - az[s];
        const lengthSq = ex * ex + ez * ez;
        const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((x - ax[s]) * ex + (z - az[s]) * ez) / lengthSq)) : 0;
        const dx = x - (ax[s] + ex * t), dz = z - (az[s] + ez * t);
        if (dx * dx + dz * dz < radius[s] * radius[s]) {
          if (!glade[s]) return "clear";
          result = "glade";
        }
      }
      return result;
    },
  };
}

function pointInPolygon(x: number, z: number, polygon: readonly { x: number; z: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export type { TrailPoint };
