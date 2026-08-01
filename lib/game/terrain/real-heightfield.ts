/**
 * lib/game/terrain/real-heightfield.ts
 * ────────────────────────────────────
 * The real-terrain sampler (Drop In v2, Phase 5.2). Implements DESIGN §3.3:
 *
 *   height(x, z) = bicubic(heightfield, x, z) + microDetail(x, z)
 *
 * The baked DEM gives the mountain its true macro shape at ~4–6 m/px; the
 * seeded fbm layer restores the gameplay-scale texture that resolution can't
 * carry, at wavelengths strictly below one DEM cell so it never fights the real
 * morphology, and damped to ~15% inside groomed corridors so pistes stay
 * skiable.
 *
 * This is a *new* code path. `heightfield.ts` (the v1-parity procedural terrain)
 * is untouched and still selected for resorts without baked assets — see
 * `terrain-source.ts`.
 *
 * Pure and IO-free: callers hand in an already-loaded `ArrayBuffer` and parsed
 * JSON. No DOM, no three.js, no fetch, no Node built-ins.
 *
 * ## Coordinates
 *
 * The baked assets use the ENU frame documented in `formats.ts`
 * ({@link HEIGHTFIELD_ORIENTATION}): `x` east, `y` north, metres from
 * `meta.center`. The game uses the three.js-style frame: `x` east, `y` up,
 * `z` south. So:
 *
 *   gameX = assetX          gameZ = -assetY          gameY = elevation
 *
 * which makes the grid mapping pleasingly direct — both indices grow with the
 * coordinate:
 *
 *   col = (x + sizeM/2) / cellSizeM
 *   row = (z + sizeM/2) / cellSizeM
 *
 * See `docs/drop-in-v2/TERRAIN-SAMPLING.md` for the full contract.
 */

import type { ResortGameProfile } from "../config/schema";
import { clamp01, normalize, smoothstep } from "../core/math";
import { mulberry32 } from "../core/rng";
import type { NearestTrail, TerrainSampler, Vec3 } from "../core/types";
import { createGridSample, sampleGridBicubic } from "./bicubic";
import {
  decodeHeightfield, decodeTrails, HEIGHTFIELD_ORIENTATION,
  type Heightfield, type TerrainMeta, type Trails, type TrailsFile,
} from "./formats";
import { fbmWithGradient, type NoiseGradient } from "./noise-grad";
import { buildRealCourse, nearestPointOnRun } from "./real-course";
import { RAMP_H, RAMP_LEN, RAMP_W } from "./heightfield";

// ─── Options ─────────────────────────────────────────────────

/** Fraction of full micro-detail amplitude that survives on a groomed corridor. */
export const CORRIDOR_DAMPING = 0.15;
export const DEFAULT_DETAIL_AMPLITUDE_M = 0.5;
export const MIN_DETAIL_AMPLITUDE_M = 0.3;
export const MAX_DETAIL_AMPLITUDE_M = 0.8;
/** Base micro-detail wavelength as a fraction of the DEM cell size. */
export const DEFAULT_WAVELENGTH_FRACTION = 0.75;
export const DEFAULT_DETAIL_OCTAVES = 3;
export const DEFAULT_CORRIDOR_HALF_WIDTH_M = 14;
export const DEFAULT_CORRIDOR_FALLOFF_M = 10;

export interface MicroDetailOptions {
  /** Peak-to-centre amplitude in metres; must be within [0.3, 0.8] (DESIGN §3.3). */
  amplitudeM?: number;
  /**
   * Wavelength of the coarsest fbm octave, metres. Must be strictly below the
   * DEM cell size — the whole point of the layer is detail the DEM cannot hold.
   * Defaults to 75% of a cell.
   */
  baseWavelengthM?: number;
  octaves?: number;
  /** Detail amplitude multiplier at a groomed run's centreline. Default 0.15. */
  corridorDamping?: number;
  /** Half-width of a groomed corridor, metres. */
  corridorHalfWidthM?: number;
  /** Distance beyond the half-width over which damping relaxes back to 1. */
  corridorFalloffM?: number;
}

export interface RealTerrainOptions extends MicroDetailOptions {
  profile: ResortGameProfile;
  /** Defaults to `profile.terrainSeed`. */
  seed?: number;
}

// ─── Draped trails ───────────────────────────────────────────

/** A trail vertex in game coordinates, elevation sampled from the DEM. */
export interface DrapedPoint {
  x: number;
  /** Elevation in metres (the macro surface, before micro-detail). */
  y: number;
  z: number;
}

export interface DrapedRun {
  name: string | null;
  difficulty: string | null;
  grooming: string | null;
  gladed: boolean;
  oneway: boolean;
  /** True when this run contributes a damped corridor to the micro-detail layer. */
  groomed: boolean;
  halfWidthM: number;
  points: DrapedPoint[];
}

export interface DrapedLift {
  name: string | null;
  type: string;
  points: DrapedPoint[];
}

/** Result of a nearest-run query, filled in place to avoid per-frame garbage. */
export interface NearestRun {
  /** Index into `terrain.runs`, or -1 when the resort has no runs. */
  i: number;
  run: DrapedRun | null;
  /** Horizontal distance to the centreline, metres. */
  d: number;
  /** Closest point on the centreline. */
  x: number;
  z: number;
  /** True when within the run's half-width. */
  on: boolean;
}

export function createNearestRun(): NearestRun {
  return { i: -1, run: null, d: Infinity, x: 0, z: 0, on: false };
}

// ─── Sampler ─────────────────────────────────────────────────

export interface RealTerrainSampler extends TerrainSampler {
  readonly kind: "real";
  readonly meta: TerrainMeta;
  readonly field: Heightfield;
  readonly trails: Trails;
  readonly runs: readonly DrapedRun[];
  readonly lifts: readonly DrapedLift[];
  /** Bicubic DEM elevation alone, no micro-detail. */
  macroHeight(x: number, z: number): number;
  /** The micro-detail offset alone, corridor damping included. */
  microDetail(x: number, z: number): number;
  /** Nearest groomed-run centreline query over the real polylines. */
  nearestRun(x: number, z: number, out: NearestRun): NearestRun;
}

export function createRealTerrain(
  heightfieldData: ArrayBuffer,
  meta: TerrainMeta,
  trailsData: TrailsFile,
  options: RealTerrainOptions,
): RealTerrainSampler {
  if (meta.orientation !== HEIGHTFIELD_ORIENTATION) {
    throw new Error(
      `heightfield orientation mismatch for ${meta.slug}: got ${JSON.stringify(meta.orientation)}`,
    );
  }
  const field = decodeHeightfield(heightfieldData, meta);
  const trails = decodeTrails(trailsData);
  if (trails.sizeM !== meta.sizeM) {
    throw new Error(
      `trails/heightfield extent mismatch for ${meta.slug}: ${trails.sizeM} vs ${meta.sizeM}`,
    );
  }
  if (trails.center[0] !== meta.center[0] || trails.center[1] !== meta.center[1]) {
    throw new Error(`trails/heightfield centre mismatch for ${meta.slug}`);
  }

  const { profile } = options;
  const seed = options.seed ?? profile.terrainSeed;
  const cellSizeM = field.cellSizeM;
  const halfSizeM = field.sizeM / 2;

  const amplitudeM = options.amplitudeM ?? DEFAULT_DETAIL_AMPLITUDE_M;
  if (!(amplitudeM >= MIN_DETAIL_AMPLITUDE_M && amplitudeM <= MAX_DETAIL_AMPLITUDE_M)) {
    throw new Error(
      `micro-detail amplitude must be within [${MIN_DETAIL_AMPLITUDE_M}, ${MAX_DETAIL_AMPLITUDE_M}] m, got ${amplitudeM}`,
    );
  }
  const baseWavelengthM = options.baseWavelengthM ?? cellSizeM * DEFAULT_WAVELENGTH_FRACTION;
  if (!(baseWavelengthM > 0 && baseWavelengthM < cellSizeM)) {
    throw new Error(
      `micro-detail wavelength must be > 0 and strictly below the DEM cell size (${cellSizeM.toFixed(3)} m), got ${baseWavelengthM}`,
    );
  }
  const octaves = options.octaves ?? DEFAULT_DETAIL_OCTAVES;
  const corridorDamping = options.corridorDamping ?? CORRIDOR_DAMPING;
  const corridorHalfWidthM = options.corridorHalfWidthM ?? DEFAULT_CORRIDOR_HALF_WIDTH_M;
  const corridorFalloffM = options.corridorFalloffM ?? DEFAULT_CORRIDOR_FALLOFF_M;

  // Same seeding ritual as the procedural path so a resort's two terrains are
  // at least drawn from the same stream position.
  const random = mulberry32(seed);
  const noiseOffset = { x: 1000 + random() * 90000, z: 1000 + random() * 90000 };
  const noiseScale = 1 / baseWavelengthM;

  // ─── Macro surface ─────────────────────────────────────────

  const gridSample = createGridSample();

  function sampleMacro(x: number, z: number): void {
    sampleGridBicubic(
      field, (x + halfSizeM) / cellSizeM, (z + halfSizeM) / cellSizeM, gridSample,
    );
  }

  function macroHeight(x: number, z: number): number {
    sampleMacro(x, z);
    return gridSample.value;
  }

  // ─── Draping ───────────────────────────────────────────────

  // Asset y is north, game z is south. Elevations come from the macro surface
  // only: a corridor's micro-detail is damped anyway, and draping onto the
  // un-detailed surface keeps the polylines stable if detail options change.
  function drape(points: ReadonlyArray<{ x: number; y: number }>): DrapedPoint[] {
    const out: DrapedPoint[] = [];
    for (let i = 0; i < points.length; i += 1) {
      const x = points[i].x;
      const z = -points[i].y;
      out.push({ x, y: macroHeight(x, z), z });
    }
    return out;
  }

  const runs: DrapedRun[] = trails.runs.map((run) => ({
    name: run.name,
    difficulty: run.difficulty,
    grooming: run.grooming,
    gladed: run.gladed,
    oneway: run.oneway,
    groomed: !run.gladed && run.grooming !== "backcountry",
    halfWidthM: corridorHalfWidthM,
    points: drape(run.points),
  }));

  const lifts: DrapedLift[] = trails.lifts.map((lift) => ({
    name: lift.name,
    type: lift.type,
    points: drape(lift.points),
  }));
  const course = buildRealCourse(profile, runs, lifts, seed);

  const ramp = { value: 0, dx: 0, dz: 0 };
  function sampleRamps(x: number, z: number): void {
    ramp.value = 0; ramp.dx = 0; ramp.dz = 0;
    for (const run of course.runs) {
      for (const feature of run.ramps) {
        const dx = x - feature.x, dz = z - feature.z;
        const forwardX = Math.sin(feature.heading), forwardZ = Math.cos(feature.heading);
        const rightX = Math.cos(feature.heading), rightZ = -Math.sin(feature.heading);
        const along = dx * forwardX + dz * forwardZ;
        if (along < 0 || along > RAMP_LEN + 3.5) continue;
        const across = dx * rightX + dz * rightZ;
        const absoluteAcross = Math.abs(across);
        if (absoluteAcross > RAMP_W) continue;
        const lateralT = clamp01(1 - absoluteAcross / RAMP_W);
        const lateral = smoothstep(lateralT);
        const lateralDerivative = 6 * lateralT * (1 - lateralT)
          * (across === 0 ? 0 : -Math.sign(across) / RAMP_W);
        let shape: number, shapeDerivative: number;
        if (along <= RAMP_LEN) {
          const rise = along / RAMP_LEN;
          shape = rise * rise;
          shapeDerivative = 2 * rise / RAMP_LEN;
        } else {
          shape = clamp01(1 - (along - RAMP_LEN) / 3.5);
          shapeDerivative = shape > 0 ? -1 / 3.5 : 0;
        }
        ramp.value += RAMP_H * shape * lateral;
        const alongDerivative = RAMP_H * shapeDerivative * lateral;
        const acrossDerivative = RAMP_H * shape * lateralDerivative;
        ramp.dx += alongDerivative * forwardX + acrossDerivative * rightX;
        ramp.dz += alongDerivative * forwardZ + acrossDerivative * rightZ;
      }
    }
  }

  // ─── Corridor index ────────────────────────────────────────

  const corridors = buildSegmentIndex(runs, corridorFalloffM);

  /**
   * Groomed-corridor membership in [0, 1]: 1 on the centreline, 0 beyond
   * half-width + falloff. C1 because `smoothstep` has zero slope at both ends.
   *
   * Fills `corridorGrad` with ∂/∂x and ∂/∂z as a side effect.
   */
  const corridorGrad = { dx: 0, dz: 0 };

  function corridorField(x: number, z: number): number {
    corridorGrad.dx = 0;
    corridorGrad.dz = 0;
    const hit = corridors.query(x, z);
    if (!hit) return 0;
    const { distance, halfWidthM } = corridors;
    const t = clamp01(1 - (distance - halfWidthM) / corridorFalloffM);
    const value = smoothstep(t);
    if (t > 0 && t < 1 && distance > 0) {
      // dvalue/ddistance = smoothstep'(t) * (-1/falloff); ddistance/dp is the
      // unit vector from the closest centreline point to the query point.
      const scale = (6 * t * (1 - t)) * (-1 / corridorFalloffM);
      corridorGrad.dx = scale * ((x - corridors.closestX) / distance);
      corridorGrad.dz = scale * ((z - corridors.closestZ) / distance);
    }
    return value;
  }

  // ─── Micro-detail ──────────────────────────────────────────

  const noise: NoiseGradient = { value: 0, dx: 0, dz: 0 };
  const detail = { value: 0, dx: 0, dz: 0 };

  function sampleDetail(x: number, z: number): void {
    const groomed = corridorField(x, z);
    const weight = 1 - (1 - corridorDamping) * groomed;
    const weightDx = -(1 - corridorDamping) * corridorGrad.dx;
    const weightDz = -(1 - corridorDamping) * corridorGrad.dz;

    const nx = (x + noiseOffset.x) * noiseScale;
    const nz = (z + noiseOffset.z) * noiseScale;
    fbmWithGradient(nx, nz, octaves, noise);
    // fbm is in [0, 1]; recentre to [-1, 1] so detail neither raises nor lowers
    // the mean surface.
    const signed = 2 * noise.value - 1;
    const signedDx = 2 * noise.dx * noiseScale;
    const signedDz = 2 * noise.dz * noiseScale;

    detail.value = amplitudeM * signed * weight;
    detail.dx = amplitudeM * (signedDx * weight + signed * weightDx);
    detail.dz = amplitudeM * (signedDz * weight + signed * weightDz);
  }

  function microDetail(x: number, z: number): number {
    sampleDetail(x, z);
    return detail.value;
  }

  // ─── The sampling interface ────────────────────────────────

  function height(x: number, z: number): number {
    sampleMacro(x, z);
    const macro = gridSample.value;
    sampleDetail(x, z);
    sampleRamps(x, z);
    return macro + detail.value + ramp.value;
  }

  function normal(x: number, z: number, out: Vec3): Vec3 {
    sampleMacro(x, z);
    const macroDx = gridSample.dCol / cellSizeM;
    const macroDz = gridSample.dRow / cellSizeM;
    sampleDetail(x, z);
    sampleRamps(x, z);
    // Surface y = H(x, z) ⇒ normal ∝ (−∂H/∂x, 1, −∂H/∂z), matching the sign
    // convention of the procedural sampler's finite differences.
    out.x = -(macroDx + detail.dx + ramp.dx);
    out.y = 1;
    out.z = -(macroDz + detail.dz + ramp.dz);
    return normalize(out);
  }

  const nearestRunScratch = createNearestRun();

  function queryNearestRun(x: number, z: number, out: NearestRun): NearestRun {
    let bestD = Infinity, bestI = -1, bestX = 0, bestZ = 0;
    for (let i = 0; i < runs.length; i += 1) {
      const points = runs[i].points;
      for (let j = 1; j < points.length; j += 1) {
        const d = distanceToSegment(
          x, z, points[j - 1].x, points[j - 1].z, points[j].x, points[j].z,
        );
        if (d < bestD) {
          bestD = d;
          bestI = i;
          bestX = closestX;
          bestZ = closestZ;
        }
      }
    }
    out.i = bestI;
    out.run = bestI >= 0 ? runs[bestI] : null;
    out.d = bestD;
    out.x = bestX;
    out.z = bestZ;
    out.on = bestI >= 0 && bestD <= runs[bestI].halfWidthM;
    return out;
  }

  return {
    kind: "real",
    profile,
    seed,
    noiseOffset,
    meta,
    field,
    trails,
    runs,
    lifts,
    realRuns: course.runs,
    mainLift: course.mainLift,
    height,
    normal,
    macroHeight,
    microDetail,
    trailField: corridorField,
    nearestTrail: (x: number, z: number, out: NearestTrail) => {
      if (course.runs.length === 0) {
        out.i = -1; out.t = { kind: "procedural", trail: profile.trails[0] };
        out.d = Infinity; out.dx = 0; out.on = false;
        return out;
      }
      let bestI = 0, bestDistance = Infinity, bestX = 0;
      for (let i = 0; i < course.runs.length; i += 1) {
        const hit = nearestPointOnRun(course.runs[i], x, z);
        if (hit.distance < bestDistance) {
          bestI = i; bestDistance = hit.distance; bestX = hit.x;
        }
      }
      const run = course.runs[bestI];
      out.i = bestI; out.t = { kind: "real", run }; out.d = bestDistance;
      out.dx = x - bestX; out.on = bestDistance <= run.halfWidthM;
      return out;
    },
    nearestRun: (x: number, z: number, out: NearestRun = nearestRunScratch) =>
      queryNearestRun(x, z, out),
  };
}

// ─── Segment geometry ────────────────────────────────────────

// Closest point of the last `distanceToSegment` call. Module scratch: the
// alternative is an out-param on a function called several times per height
// sample, and this module is single-threaded by construction.
let closestX = 0;
let closestZ = 0;

function distanceToSegment(
  px: number, pz: number, ax: number, az: number, bx: number, bz: number,
): number {
  const ex = bx - ax, ez = bz - az;
  const lengthSq = ex * ex + ez * ez;
  const t = lengthSq > 0 ? clamp01(((px - ax) * ex + (pz - az) * ez) / lengthSq) : 0;
  closestX = ax + ex * t;
  closestZ = az + ez * t;
  return Math.hypot(px - closestX, pz - closestZ);
}

/**
 * Uniform bucket grid over groomed-run segments, sized so that a query only has
 * to look in the single bucket containing the point: every segment is
 * registered into all buckets its AABB touches once expanded by the influence
 * radius, so any segment within that radius of the point is guaranteed to be in
 * the point's own bucket.
 */
interface SegmentIndex {
  halfWidthM: number;
  distance: number;
  closestX: number;
  closestZ: number;
  query(x: number, z: number): boolean;
}

const BUCKET_LIMIT = 32768;

function buildSegmentIndex(runs: readonly DrapedRun[], falloffM: number): SegmentIndex {
  const ax: number[] = [], az: number[] = [], bx: number[] = [], bz: number[] = [];
  const halfW: number[] = [];
  let maxRadius = 1;
  for (const run of runs) {
    if (!run.groomed) continue;
    const radius = run.halfWidthM + falloffM;
    if (radius > maxRadius) maxRadius = radius;
    for (let j = 1; j < run.points.length; j += 1) {
      ax.push(run.points[j - 1].x);
      az.push(run.points[j - 1].z);
      bx.push(run.points[j].x);
      bz.push(run.points[j].z);
      halfW.push(run.halfWidthM);
    }
  }

  const cell = maxRadius;
  const buckets = new Map<number, number[]>();
  const key = (ix: number, iz: number): number => (ix + BUCKET_LIMIT) * 65536 + (iz + BUCKET_LIMIT);
  const cellIndex = (v: number): number => Math.floor(v / cell);

  for (let s = 0; s < ax.length; s += 1) {
    const radius = halfW[s] + falloffM;
    const minIx = cellIndex(Math.min(ax[s], bx[s]) - radius);
    const maxIx = cellIndex(Math.max(ax[s], bx[s]) + radius);
    const minIz = cellIndex(Math.min(az[s], bz[s]) - radius);
    const maxIz = cellIndex(Math.max(az[s], bz[s]) + radius);
    for (let ix = minIx; ix <= maxIx; ix += 1) {
      for (let iz = minIz; iz <= maxIz; iz += 1) {
        if (Math.abs(ix) >= BUCKET_LIMIT || Math.abs(iz) >= BUCKET_LIMIT) continue;
        const k = key(ix, iz);
        const bucket = buckets.get(k);
        if (bucket) bucket.push(s);
        else buckets.set(k, [s]);
      }
    }
  }

  const index: SegmentIndex = {
    halfWidthM: 0,
    distance: Infinity,
    closestX: 0,
    closestZ: 0,
    query(x: number, z: number): boolean {
      const ix = cellIndex(x), iz = cellIndex(z);
      if (Math.abs(ix) >= BUCKET_LIMIT || Math.abs(iz) >= BUCKET_LIMIT) return false;
      const bucket = buckets.get(key(ix, iz));
      if (!bucket) return false;
      let bestD = Infinity, bestS = -1, bestX = 0, bestZ = 0;
      for (let i = 0; i < bucket.length; i += 1) {
        const s = bucket[i];
        const d = distanceToSegment(x, z, ax[s], az[s], bx[s], bz[s]);
        if (d < bestD) {
          bestD = d;
          bestS = s;
          bestX = closestX;
          bestZ = closestZ;
        }
      }
      if (bestS < 0 || bestD > halfW[bestS] + falloffM) return false;
      index.halfWidthM = halfW[bestS];
      index.distance = bestD;
      index.closestX = bestX;
      index.closestZ = bestZ;
      return true;
    },
  };
  return index;
}
