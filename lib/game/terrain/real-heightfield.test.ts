import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { brotliDecompressSync } from "node:zlib";

import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import { createGridSample, sampleGridBicubic } from "./bicubic";
import {
  encodeDelta, HEIGHTFIELD_ORIENTATION, quantizeHeight, sampleHeightBilinear,
  type RawRun, type TerrainMeta, type TrailsFile,
} from "./formats";
import { fbm } from "./noise";
import { pointAtArcLength } from "./real-course";
import { RAMP_LEN } from "./heightfield";
import { fbmWithGradient, vnoiseWithGradient } from "./noise-grad";
import {
  createNearestRun, createRealTerrain, CORRIDOR_DAMPING,
  DEFAULT_CORRIDOR_FALLOFF_M, DEFAULT_CORRIDOR_HALF_WIDTH_M,
  type RealTerrainOptions,
} from "./real-heightfield";

const profile = DROP_IN_GAME_PROFILES["ski-portillo"];

// ─── Synthetic asset builder ─────────────────────────────────

interface SyntheticOptions {
  grid?: number;
  sizeM?: number;
  minZ?: number;
  quantum?: number;
  /** Elevation in metres for a grid node (col 0 = west, row 0 = north). */
  height: (col: number, row: number) => number;
  runs?: RawRun[];
}

interface SyntheticAssets {
  heightfield: ArrayBuffer;
  meta: TerrainMeta;
  trails: TrailsFile;
  cellSizeM: number;
  halfSizeM: number;
}

function buildSynthetic(options: SyntheticOptions): SyntheticAssets {
  const grid = options.grid ?? 32;
  const sizeM = options.sizeM ?? (grid - 1) * 4;
  const minZ = options.minZ ?? 2000;
  const quantum = options.quantum ?? 0.1;
  const buffer = new ArrayBuffer(grid * grid * 2);
  const view = new DataView(buffer);
  let maxZ = -Infinity;
  for (let row = 0; row < grid; row += 1) {
    for (let col = 0; col < grid; col += 1) {
      const z = options.height(col, row);
      if (z > maxZ) maxZ = z;
      view.setUint16((row * grid + col) * 2, quantizeHeight(z, minZ, quantum), true);
    }
  }
  return {
    heightfield: buffer,
    meta: {
      version: 1,
      slug: "ski-portillo",
      center: [-32.842, -70.129],
      sizeM,
      grid,
      minZ,
      maxZ,
      quantum,
      source: "terrarium",
      sourceZoom: 14,
      orientation: HEIGHTFIELD_ORIENTATION,
      bakedAt: "2026-08-01T00:00:00.000Z",
    },
    trails: {
      v: 1,
      center: [-32.842, -70.129],
      sizeM,
      unit: 0.1,
      convention: "europe",
      runs: options.runs ?? [],
      lifts: [],
    },
    cellSizeM: sizeM / (grid - 1),
    halfSizeM: sizeM / 2,
  };
}

/** A smooth, asymmetric test surface with bounded curvature. */
function smoothSurface(col: number, row: number): number {
  return 2000
    + 0.9 * col
    + 1.7 * row
    + 18 * Math.sin(col * 0.21)
    + 11 * Math.cos(row * 0.17)
    + 6 * Math.sin((col + row) * 0.09);
}

/** A straight groomed run down the z axis at x = 0, as a `RawRun`. */
function straightRun(fromNorthM: number, toNorthM: number): RawRun {
  return {
    n: "Test Run",
    d: "intermediate",
    g: "classic",
    // Units are decimetres (`unit: 0.1`); asset y is north.
    p: encodeDelta([[0, fromNorthM * 10], [0, toNorthM * 10]]),
  };
}

function makeTerrain(assets: SyntheticAssets, overrides: Partial<RealTerrainOptions> = {}) {
  return createRealTerrain(assets.heightfield, assets.meta, assets.trails, {
    profile, ...overrides,
  });
}

// ─── Bicubic sampling ────────────────────────────────────────

test("bicubic returns the exact grid value at every node", () => {
  const assets = buildSynthetic({ height: smoothSurface });
  const terrain = makeTerrain(assets);
  const { field } = terrain;
  const { cellSizeM, halfSizeM } = assets;

  for (let row = 0; row < field.height; row += 1) {
    for (let col = 0; col < field.width; col += 1) {
      const x = -halfSizeM + col * cellSizeM;
      const z = -halfSizeM + row * cellSizeM;
      const expected = field.heights[row * field.width + col];
      // Interior nodes land on t = 0 and are bit-exact; the last row/column
      // land on t = 1 of the final cell, where the basis sums to p2 up to
      // float rounding.
      assert.ok(
        Math.abs(terrain.macroHeight(x, z) - expected) < 1e-9,
        `node (${col}, ${row}) gave ${terrain.macroHeight(x, z)}, expected ${expected}`,
      );
    }
  }
});

test("bicubic reproduces a linear ramp exactly between nodes", () => {
  // Catmull-Rom has linear precision, so a planar DEM must stay planar — this
  // catches basis-coefficient and index-offset mistakes that node-only tests miss.
  const assets = buildSynthetic({
    grid: 16,
    quantum: 1,
    height: (col, row) => 2000 + 3 * col + 5 * row,
  });
  const terrain = makeTerrain(assets);
  const { cellSizeM, halfSizeM } = assets;
  const perMetreX = 3 / cellSizeM;
  const perMetreZ = 5 / cellSizeM;

  for (let i = 0; i < 40; i += 1) {
    const col = 1 + (i * 0.37) % 12;
    const row = 1 + (i * 0.73) % 12;
    const x = -halfSizeM + col * cellSizeM;
    const z = -halfSizeM + row * cellSizeM;
    const expected = 2000 + 3 * col + 5 * row;
    assert.ok(Math.abs(terrain.macroHeight(x, z) - expected) < 1e-6);
    // And the analytic slope of the plane.
    const out = { x: 0, y: 0, z: 0 };
    terrain.normal(x, z, out);
    const slopeX = -out.x / out.y;
    const slopeZ = -out.z / out.y;
    // Micro-detail rides on top, so allow its contribution (< 1 m over ~3 m).
    assert.ok(Math.abs(slopeX - perMetreX) < 0.5);
    assert.ok(Math.abs(slopeZ - perMetreZ) < 0.5);
  }
});

test("bicubic slope is continuous across cell boundaries where bilinear jumps", () => {
  const assets = buildSynthetic({ grid: 24, height: smoothSurface });
  const terrain = makeTerrain(assets);
  const { field } = terrain;
  const { cellSizeM, halfSizeM } = assets;
  const sample = createGridSample();

  const z = -halfSizeM + 7.5 * cellSizeM;
  const row = (z + halfSizeM) / cellSizeM;
  const step = 0.01;
  let previous = Number.NaN;
  let worstBicubicJump = 0;

  for (let x = -halfSizeM + 3 * cellSizeM; x < -halfSizeM + 18 * cellSizeM; x += step) {
    sampleGridBicubic(field, (x + halfSizeM) / cellSizeM, row, sample);
    const slope = sample.dCol / cellSizeM;
    if (Number.isFinite(previous)) {
      worstBicubicJump = Math.max(worstBicubicJump, Math.abs(slope - previous));
    }
    previous = slope;
  }

  // Bilinear over the same line, differentiated the same way, to prove the
  // tolerance has teeth: its slope is piecewise constant and jumps at knots.
  let worstBilinearJump = 0;
  let previousBilinear = Number.NaN;
  for (let x = -halfSizeM + 3 * cellSizeM; x < -halfSizeM + 18 * cellSizeM; x += step) {
    const y = -z;
    const slope = (sampleHeightBilinear(field, x + step / 2, y)
      - sampleHeightBilinear(field, x - step / 2, y)) / step;
    if (Number.isFinite(previousBilinear)) {
      worstBilinearJump = Math.max(worstBilinearJump, Math.abs(slope - previousBilinear));
    }
    previousBilinear = slope;
  }

  assert.ok(worstBicubicJump < 0.01, `bicubic slope jumped by ${worstBicubicJump}`);
  assert.ok(
    worstBilinearJump > 20 * worstBicubicJump,
    `expected bilinear to jump much harder; got ${worstBilinearJump} vs ${worstBicubicJump}`,
  );
});

// ─── Analytic normals ────────────────────────────────────────

function assertNormalsAgree(
  terrain: ReturnType<typeof makeTerrain>,
  points: ReadonlyArray<readonly [number, number]>,
  tolerance: number,
): void {
  // Small: the value-noise second derivative is discontinuous at its lattice
  // lines, so a central difference straddling one carries an O(epsilon) error
  // of its own. Heights are ~2–4 km, so double precision still leaves ~1e-9 of
  // headroom at this step.
  const epsilon = 0.001;
  const analytic = { x: 0, y: 0, z: 0 };
  const numeric = { x: 0, y: 0, z: 0 };
  for (const [x, z] of points) {
    terrain.normal(x, z, analytic);
    const dx = (terrain.height(x + epsilon, z) - terrain.height(x - epsilon, z)) / (2 * epsilon);
    const dz = (terrain.height(x, z + epsilon) - terrain.height(x, z - epsilon)) / (2 * epsilon);
    const length = Math.hypot(dx, 1, dz);
    numeric.x = -dx / length;
    numeric.y = 1 / length;
    numeric.z = -dz / length;

    assert.ok(Math.abs(Math.hypot(analytic.x, analytic.y, analytic.z) - 1) < 1e-12);
    assert.ok(analytic.y > 0);
    for (const axis of ["x", "y", "z"] as const) {
      assert.ok(
        Math.abs(analytic[axis] - numeric[axis]) < tolerance,
        `normal.${axis} at (${x}, ${z}): analytic ${analytic[axis]} vs numeric ${numeric[axis]}`,
      );
    }
  }
}

test("analytic normals agree with central differences off-corridor", () => {
  const assets = buildSynthetic({ grid: 24, height: smoothSurface });
  const terrain = makeTerrain(assets);
  const points: Array<[number, number]> = [];
  for (let i = 0; i < 200; i += 1) {
    points.push([-40 + (i * 7.31) % 80, -40 + (i * 11.17) % 80]);
  }
  assertNormalsAgree(terrain, points, 1e-3);
});

test("analytic normals agree with central differences through a corridor falloff", () => {
  // A long straight run so the distance field has no medial-axis kink near the
  // sampled band; the corridor damping gradient is what is under test here.
  const assets = buildSynthetic({
    grid: 24, height: smoothSurface, runs: [straightRun(40, -40)],
  });
  const terrain = makeTerrain(assets);
  const points: Array<[number, number]> = [];
  for (let i = 0; i <= 120; i += 1) {
    // Sweep x across centreline → half-width → falloff → far field, at a z well
    // inside the segment.
    points.push([-35 + i * 0.58, -6 + (i % 7)]);
  }
  assertNormalsAgree(terrain, points, 2e-3);
});

// ─── Micro-detail ────────────────────────────────────────────

const flat = () => 2500;

test("micro-detail is deterministic for a seed and differs across seeds", () => {
  const assets = buildSynthetic({ height: flat });
  const a = makeTerrain(assets, { seed: 4242 });
  const b = makeTerrain(assets, { seed: 4242 });
  const c = makeTerrain(assets, { seed: 4243 });

  let differed = false;
  for (let i = 0; i < 500; i += 1) {
    const x = -50 + (i * 3.11) % 100;
    const z = -50 + (i * 5.03) % 100;
    assert.strictEqual(a.microDetail(x, z), b.microDetail(x, z));
    assert.strictEqual(a.height(x, z), b.height(x, z));
    if (a.microDetail(x, z) !== c.microDetail(x, z)) differed = true;
  }
  assert.ok(differed, "a different seed produced identical micro-detail everywhere");
});

test("micro-detail stays inside its configured amplitude and averages out", () => {
  const assets = buildSynthetic({ height: flat });
  const terrain = makeTerrain(assets, { amplitudeM: 0.8 });
  let sum = 0, count = 0, peak = 0;
  for (let x = -60; x <= 60; x += 0.7) {
    for (let z = -60; z <= 60; z += 0.7) {
      const d = terrain.microDetail(x, z);
      sum += d;
      count += 1;
      peak = Math.max(peak, Math.abs(d));
    }
  }
  assert.ok(peak <= 0.8 + 1e-12, `peak ${peak} exceeded the amplitude`);
  assert.ok(peak > 0.2, `detail is suspiciously flat (peak ${peak})`);
  assert.ok(Math.abs(sum / count) < 0.1, `detail has a DC offset of ${sum / count} m`);
});

test("micro-detail carries no energy at or above the DEM cell size", () => {
  // Spectral content is easiest to pin via autocorrelation: a signal whose
  // longest wavelength is below one cell must be essentially uncorrelated at a
  // one-cell lag, while still being smooth (strongly correlated) at a small
  // fraction of a cell. A layer that leaked DEM-scale wavelengths would stay
  // correlated across the cell and fight the baked morphology.
  const assets = buildSynthetic({ height: flat });
  const terrain = makeTerrain(assets);
  const cell = assets.cellSizeM;

  function correlationAtLag(lag: number): number {
    let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0;
    for (let x = -150; x <= 150; x += 0.37) {
      for (let z = -150; z <= 150; z += 4.3) {
        const a = terrain.microDetail(x, z);
        const b = terrain.microDetail(x + lag, z);
        sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b; n += 1;
      }
    }
    const cov = sab / n - (sa / n) * (sb / n);
    const va = saa / n - (sa / n) ** 2;
    const vb = sbb / n - (sb / n) ** 2;
    return cov / Math.sqrt(va * vb);
  }

  assert.ok(correlationAtLag(cell / 16) > 0.85, "detail should be smooth at sub-cell scales");
  const atCell = Math.abs(correlationAtLag(cell));
  assert.ok(atCell < 0.25, `detail is still ${atCell} correlated one DEM cell apart`);
});

test("micro-detail wavelength and amplitude options are validated", () => {
  const assets = buildSynthetic({ height: flat });
  assert.throws(() => makeTerrain(assets, { amplitudeM: 0.2 }), /amplitude/);
  assert.throws(() => makeTerrain(assets, { amplitudeM: 1.2 }), /amplitude/);
  assert.throws(
    () => makeTerrain(assets, { baseWavelengthM: assets.cellSizeM }),
    /below the DEM cell size/,
  );
  assert.throws(() => makeTerrain(assets, { baseWavelengthM: 0 }), /below the DEM cell size/);
  // The default sits below a cell.
  assert.ok(makeTerrain(assets).microDetail(0, 0) !== undefined);
});

test("micro-detail is damped to 15% inside a groomed corridor and unattenuated far away", () => {
  const assets = buildSynthetic({
    grid: 48, height: flat, runs: [straightRun(80, -80)],
  });
  const damped = makeTerrain(assets);
  const undamped = makeTerrain(assets, { corridorDamping: 1 });
  const far = DEFAULT_CORRIDOR_HALF_WIDTH_M + DEFAULT_CORRIDOR_FALLOFF_M + 20;

  for (let z = -60; z <= 60; z += 3.3) {
    for (const x of [0, 3, -5, DEFAULT_CORRIDOR_HALF_WIDTH_M - 0.5]) {
      const reference = undamped.microDetail(x, z);
      if (Math.abs(reference) < 1e-6) continue;
      assert.ok(
        Math.abs(damped.microDetail(x, z) / reference - CORRIDOR_DAMPING) < 1e-9,
        `expected ${CORRIDOR_DAMPING}× detail at (${x}, ${z})`,
      );
    }
    for (const x of [far, -far]) {
      const reference = undamped.microDetail(x, z);
      if (Math.abs(reference) < 1e-6) continue;
      assert.ok(Math.abs(damped.microDetail(x, z) / reference - 1) < 1e-9);
    }
  }

  // The corridor membership field itself is 1 on the centreline, 0 far away.
  assert.strictEqual(damped.trailField(0, 0), 1);
  assert.strictEqual(damped.trailField(far, 0), 0);
  // …and monotone in between.
  let previous = 1;
  for (let x = 0; x <= far; x += 0.25) {
    const value = damped.trailField(x, 0);
    assert.ok(value <= previous + 1e-12, `corridor field rose at x=${x}`);
    previous = value;
  }
});

test("ungroomed runs do not damp micro-detail", () => {
  const backcountry: RawRun = { ...straightRun(80, -80), g: "backcountry" };
  const gladed: RawRun = { ...straightRun(80, -80), gl: 1 };
  for (const run of [backcountry, gladed]) {
    const assets = buildSynthetic({ grid: 48, height: flat, runs: [run] });
    const terrain = makeTerrain(assets);
    const undamped = makeTerrain(assets, { corridorDamping: 1 });
    assert.strictEqual(terrain.trailField(0, 0), 0);
    assert.strictEqual(terrain.microDetail(0, 0), undamped.microDetail(0, 0));
  }
});

// ─── Orientation ─────────────────────────────────────────────

test("orientation: row 0 is north, col 0 is west, game z runs south", () => {
  // Asymmetric by construction: a distinct value per node.
  const assets = buildSynthetic({
    grid: 16, quantum: 1, height: (col, row) => 2000 + col + 100 * row,
  });
  const terrain = makeTerrain(assets);
  const { cellSizeM, halfSizeM } = assets;
  const { field } = terrain;

  // North-west corner of the box is grid index 0.
  assert.ok(Math.abs(terrain.macroHeight(-halfSizeM, -halfSizeM) - field.heights[0]) < 1e-9);
  // North-east corner is the end of row 0.
  assert.ok(
    Math.abs(terrain.macroHeight(halfSizeM, -halfSizeM) - field.heights[15]) < 1e-6,
  );
  // South-west corner is the start of the last row.
  assert.ok(
    Math.abs(terrain.macroHeight(-halfSizeM, halfSizeM) - field.heights[15 * 16]) < 1e-6,
  );

  // Every interior node, addressed through the documented mapping.
  for (let row = 1; row < 15; row += 1) {
    for (let col = 1; col < 15; col += 1) {
      const x = -halfSizeM + col * cellSizeM;
      const z = -halfSizeM + row * cellSizeM;
      assert.strictEqual(terrain.macroHeight(x, z), field.heights[row * 16 + col]);
    }
  }

  // Going east (+x) gains 1 m per cell; going south (+z) gains 100 m per cell.
  const base = terrain.macroHeight(0, 0);
  assert.ok(Math.abs(terrain.macroHeight(cellSizeM, 0) - base - 1) < 1e-6);
  assert.ok(Math.abs(terrain.macroHeight(0, cellSizeM) - base - 100) < 1e-6);
});

test("orientation: trails drape onto the surface with y = -north", () => {
  const assets = buildSynthetic({
    grid: 16, quantum: 1, height: (col, row) => 2000 + col + 100 * row,
    runs: [straightRun(20, -20)],
  });
  const terrain = makeTerrain(assets);
  const run = terrain.runs[0];
  assert.strictEqual(run.points.length, 2);
  // Asset y = +20 m north → game z = -20.
  assert.strictEqual(run.points[0].z, -20);
  assert.strictEqual(run.points[1].z, 20);
  for (const point of run.points) {
    assert.strictEqual(point.y, terrain.macroHeight(point.x, point.z));
  }
  // Heights rise southwards, so the second (southern) vertex is higher.
  assert.ok(run.points[1].y > run.points[0].y);
});

test("samples outside the box clamp to the edge with a flat normal", () => {
  const assets = buildSynthetic({ grid: 16, height: smoothSurface });
  const terrain = makeTerrain(assets);
  const { halfSizeM } = assets;
  const edge = terrain.macroHeight(halfSizeM, 0);
  assert.strictEqual(terrain.macroHeight(halfSizeM + 500, 0), edge);
  const out = { x: 0, y: 0, z: 0 };
  terrain.normal(halfSizeM + 500, 0, out);
  assert.ok(out.y > 0);
  assert.ok(Number.isFinite(out.x) && Number.isFinite(out.z));
});

// ─── Contract guards ─────────────────────────────────────────

test("a mismatched orientation or extent is rejected", () => {
  const assets = buildSynthetic({ height: flat });
  assert.throws(
    () => createRealTerrain(
      assets.heightfield, { ...assets.meta, orientation: "row 0 = south" }, assets.trails,
      { profile },
    ),
    /orientation mismatch/,
  );
  assert.throws(
    () => createRealTerrain(
      assets.heightfield, assets.meta, { ...assets.trails, sizeM: 99 }, { profile },
    ),
    /extent mismatch/,
  );
  assert.throws(
    () => createRealTerrain(
      assets.heightfield, assets.meta, { ...assets.trails, center: [0, 0] }, { profile },
    ),
    /centre mismatch/,
  );
});

test("nearest-run reports the real centreline geometry", () => {
  const assets = buildSynthetic({ grid: 48, height: flat, runs: [straightRun(80, -80)] });
  const terrain = makeTerrain(assets);
  const out = createNearestRun();

  terrain.nearestRun(7, 0, out);
  assert.strictEqual(out.i, 0);
  assert.strictEqual(out.run?.name, "Test Run");
  assert.ok(Math.abs(out.d - 7) < 1e-9);
  assert.ok(Math.abs(out.x) < 1e-9);
  assert.strictEqual(out.on, true);

  terrain.nearestRun(200, 0, out);
  assert.ok(Math.abs(out.d - 200) < 1e-9);
  assert.strictEqual(out.on, false);
});

// ─── Noise gradients ─────────────────────────────────────────

test("fbmWithGradient reproduces noise.fbm bit-for-bit", () => {
  const out = { value: 0, dx: 0, dz: 0 };
  for (let i = 0; i < 500; i += 1) {
    const x = -30 + (i * 0.617) % 60;
    const z = -30 + (i * 0.911) % 60;
    for (const octaves of [1, 2, 3, 4]) {
      fbmWithGradient(x, z, octaves, out);
      assert.strictEqual(out.value, fbm(x, z, octaves));
    }
  }
});

test("noise gradients match central differences", () => {
  const out = { value: 0, dx: 0, dz: 0 };
  const epsilon = 1e-5;
  for (let i = 0; i < 300; i += 1) {
    // Stay off integer lattice lines, where the value noise is only C1 by
    // construction and central differences straddle two cells.
    const x = 0.37 + (i * 0.613) % 40;
    const z = 0.21 + (i * 0.907) % 40;
    vnoiseWithGradient(x, z, out);
    const value = out.value;
    const dx = (vnoiseWithGradient(x + epsilon, z, out).value
      - vnoiseWithGradient(x - epsilon, z, out).value) / (2 * epsilon);
    const dz = (vnoiseWithGradient(x, z + epsilon, out).value
      - vnoiseWithGradient(x, z - epsilon, out).value) / (2 * epsilon);
    vnoiseWithGradient(x, z, out);
    assert.strictEqual(out.value, value);
    assert.ok(Math.abs(out.dx - dx) < 1e-4, `vnoise dx ${out.dx} vs ${dx}`);
    assert.ok(Math.abs(out.dz - dz) < 1e-4, `vnoise dz ${out.dz} vs ${dz}`);

    fbmWithGradient(x, z, 3, out);
    const fdx = (fbmWithGradient(x + epsilon, z, 3, out).value
      - fbmWithGradient(x - epsilon, z, 3, out).value) / (2 * epsilon);
    const fdz = (fbmWithGradient(x, z + epsilon, 3, out).value
      - fbmWithGradient(x, z - epsilon, 3, out).value) / (2 * epsilon);
    fbmWithGradient(x, z, 3, out);
    assert.ok(Math.abs(out.dx - fdx) < 1e-3, `fbm dx ${out.dx} vs ${fdx}`);
    assert.ok(Math.abs(out.dz - fdz) < 1e-3, `fbm dz ${out.dz} vs ${fdz}`);
  }
});

// ─── Real committed assets ───────────────────────────────────

/**
 * The module under test is IO-free by contract; the *test* is allowed to read
 * the committed pack from disk. Only `.height.u16.br` is committed, so undo the
 * brotli here — the runtime gets it for free from `Content-Encoding`.
 */
function loadBakedAssets(slug: string): {
  heightfield: ArrayBuffer; meta: TerrainMeta; trails: TrailsFile;
} {
  const dir = path.join(process.cwd(), "public", "game", "terrain");
  const raw = brotliDecompressSync(readFileSync(path.join(dir, `${slug}.height.u16.br`)));
  return {
    heightfield: raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer,
    meta: JSON.parse(readFileSync(path.join(dir, `${slug}.meta.json`), "utf8")) as TerrainMeta,
    trails: JSON.parse(readFileSync(path.join(dir, `${slug}.trails.json`), "utf8")) as TrailsFile,
  };
}

test("real Portillo assets decode into a sane sampler", () => {
  const assets = loadBakedAssets("ski-portillo");
  const terrain = createRealTerrain(assets.heightfield, assets.meta, assets.trails, { profile });

  assert.strictEqual(terrain.meta.grid, 1024);
  assert.strictEqual(terrain.field.width, 1024);
  assert.ok(Math.abs(terrain.field.cellSizeM - assets.meta.sizeM / 1023) < 1e-9);

  // Decoded elevations live inside the quantisation range the meta declares,
  // and actually reach the declared maximum.
  assert.ok(terrain.field.minZ >= assets.meta.minZ - 1e-6);
  assert.ok(terrain.field.maxZ <= assets.meta.maxZ + 1e-6);
  assert.ok(Math.abs(terrain.field.maxZ - assets.meta.maxZ) < assets.meta.quantum + 1e-6);

  // A dense scan stays finite, inside the DEM range plus the detail amplitude,
  // and yields unit up-facing normals.
  const out = { x: 0, y: 0, z: 0 };
  const half = assets.meta.sizeM / 2;
  const slack = 0.8;
  for (let i = 0; i < 4000; i += 1) {
    const x = -half + (i * 137.3) % assets.meta.sizeM;
    const z = -half + (i * 211.7) % assets.meta.sizeM;
    const h = terrain.height(x, z);
    assert.ok(Number.isFinite(h));
    // Bicubic can overshoot a little at sharp ridges; allow one quantum plus
    // the detail amplitude beyond the sampled extremes.
    assert.ok(h > terrain.field.minZ - 5 - slack && h < terrain.field.maxZ + 5 + slack, `h=${h}`);
    terrain.normal(x, z, out);
    assert.ok(out.y > 0);
    assert.ok(Math.abs(Math.hypot(out.x, out.y, out.z) - 1) < 1e-12);
  }
});

test("real Portillo trails drape with the summit above the base", () => {
  const assets = loadBakedAssets("ski-portillo");
  const terrain = createRealTerrain(assets.heightfield, assets.meta, assets.trails, { profile });

  assert.ok(terrain.runs.length > 20);
  assert.ok(terrain.lifts.length > 10);
  const named = terrain.runs.map((run) => run.name).filter(Boolean);
  assert.ok(named.includes("Roca Jack"), `expected Roca Jack among ${named.join(", ")}`);

  for (const run of terrain.runs) {
    for (const point of run.points) {
      assert.strictEqual(point.y, terrain.macroHeight(point.x, point.z));
      assert.ok(point.y >= assets.meta.minZ && point.y <= assets.meta.maxZ);
    }
  }

  // Roca Jack drops from the Juncalillo ridge to the hotel bowl: its top vertex
  // must sit a few hundred metres above its bottom one.
  const rocaJack = terrain.runs.find((run) => run.name === "Roca Jack");
  assert.ok(rocaJack);
  const top = rocaJack.points[0];
  const base = rocaJack.points[rocaJack.points.length - 1];
  assert.ok(top.y > base.y + 200, `Roca Jack vertical was only ${top.y - base.y} m`);
  assert.ok(top.y > 3200 && top.y < 3400, `Roca Jack top at ${top.y} m`);
  assert.ok(base.y > 2850 && base.y < 3050, `Roca Jack base at ${base.y} m`);

  // The high ridge in the north-east of the box towers over the lake basin.
  assert.ok(terrain.macroHeight(1751.7, -1995.9) > terrain.macroHeight(-888, -278) + 1000);
});

test("all three baked resorts load and sample", () => {
  for (const slug of ["ski-portillo", "breckenridge", "heavenly"] as const) {
    const assets = loadBakedAssets(slug);
    const terrain = createRealTerrain(assets.heightfield, assets.meta, assets.trails, {
      profile: DROP_IN_GAME_PROFILES[slug],
    });
    assert.strictEqual(terrain.meta.slug, slug);
    assert.ok(terrain.runs.length > 0);
    const out = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 200; i += 1) {
      const x = -500 + i * 5;
      const z = -500 + i * 4;
      assert.ok(Number.isFinite(terrain.height(x, z)));
      terrain.normal(x, z, out);
      assert.ok(out.y > 0);
    }
  }
});

test("real course ramps are physical height features along the selected polyline", () => {
  const assets = loadBakedAssets("heavenly");
  const terrain = createRealTerrain(assets.heightfield, assets.meta, assets.trails, {
    profile: DROP_IN_GAME_PROFILES.heavenly,
  });
  const run = terrain.realRuns?.find((candidate) => candidate.ramps.length > 0);
  assert.ok(run);
  const ramp = run.ramps[0];
  const point = pointAtArcLength(run.points, ramp.distanceM + RAMP_LEN / 2);
  const centre = terrain.height(point.x, point.z);
  const base = terrain.macroHeight(point.x, point.z) + terrain.microDetail(point.x, point.z);
  assert.ok(centre > base + 0.1, `ramp added only ${centre - base} m`);
});
