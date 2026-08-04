# Phase 1 — Far Field & DEM Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fake painted horizon with real mountain geometry out to 30 km, and upgrade the DEM sources and projection maths behind every resort's terrain.

**Architecture:** Two halves. (A) The offline bake gains a GDAL-backed path that warps each resort to its own UTM zone and pulls USGS 3DEP 1 m lidar for the US resorts, replacing the current centre-latitude ENU approximation and Terrarium tiles. (B) A new far-field bake emits one radially-graded coarse mesh per resort (30 km radius, 16 angular wedges), which a new renderer draws every frame with no streaming and no LOD state machine, replacing `SceneFactory`'s two procedural ridge bands.

**Tech Stack:** GDAL CLI via `child_process` (gdalbuildvrt/gdalwarp/gdal_translate), `delatin` or `martini` (ISC, pure JS) for mesh generation, existing brotli asset pipeline, three 0.185.1 WebGPU/TSL renderer, node:test via tsx.

## Global Constraints

- **Spend $0.** Every data source and tool in this plan is public domain, CC0, or permissively licensed. Do not introduce a paid dependency.
- **Per-resort DEM sources are fixed** (design §3): Breckenridge → USGS 3DEP 1 m (`CO_Central_and_WesternCO_2016_A16`); Heavenly → 3DEP 1 m (`CA_SierraNevada_B22`); ski-portillo → Copernicus GLO-30 (`S33_00_W071_00`). **No free public DEM better than 30 m exists for the Chilean Andes** — do not go looking for one, and specifically do NOT use FABDEM (CC BY-NC-SA) or TanDEM-X 12 m (scientific-use-only).
- **Never blend bare-earth and DSM sources within one resort.** 3DEP is bare-earth, GLO-30 is a DSM; a seam between them produces a canopy-height step. One source per resort.
- three stays at **0.185.1**. No renderer or backend changes — the far-field mesh is ordinary geometry on the existing node-material path, gated for both backends like every other Task 6 material.
- The far-field mesh is **static and pre-baked**: no runtime streaming, no LOD state machine, no per-frame rebuilds. Draw every wedge that survives frustum culling.
- Committed asset budget: **≤ 400 KB brotli per resort** for the far-field mesh (design target ~250 KB). Fail the bake loudly if exceeded rather than silently shipping it.
- Zero per-frame allocation in the far-field renderer (the Task 8 regime applies to all of `lib/game/rendering`).
- `npm test` and `npx tsc --noEmit` green after every task. Playwright and `npm run build` are the orchestrator's to run.
- **Re-baking changes terrain, which changes the simulation.** Any task that changes baked heights MUST bump `COURSE_VERSION` and re-capture the affected fixtures in the same commit. Do not "fix" a parity failure by editing a fixture without a version bump.

---

## File structure

| File | Responsibility |
|---|---|
| `scripts/dem/gdal.ts` (new) | Thin typed wrappers over the GDAL CLI: `gdalbuildvrt`, `gdalwarp`, `gdal_translate`, `gdalinfo`. Pure process orchestration, no PeakCam concepts. |
| `scripts/dem/sources.ts` (new) | Per-resort source resolution + fetch: 3DEP project tiles, Copernicus COG, Terrarium fallback. Owns URLs, retries, and the loud fallback warning. |
| `scripts/dem/utm.ts` (new) | UTM zone selection from lat/lon and the projected-grid maths. Pure, unit-testable. |
| `scripts/bake-resort.ts` (modify) | Orchestration only — calls the above, keeps existing PNG/meta emission. |
| `scripts/bake-far-field.ts` (new) | Emits the 30 km wedge mesh per resort: sample coarse rings, triangulate, split into wedges, encode, brotli. |
| `lib/game/terrain/far-field-format.ts` (new) | The wire format for the far-field asset, shared by baker and runtime. One place defines it. |
| `lib/game/rendering/FarFieldRenderer.ts` (new) | Loads the asset, builds wedge meshes, culls, draws. Replaces the ridge bands. |
| `lib/game/rendering/SceneFactory.ts` (modify) | Drops `makeRidge` usage; wires `FarFieldRenderer` in. |

---

### Task 1: UTM projection maths

**Files:**
- Create: `scripts/dem/utm.ts`, `scripts/dem/utm.test.ts`

**Interfaces:**
- Produces: `utmZoneFor(lat: number, lon: number): { zone: number; north: boolean; epsg: number }` and `metresPerSampleError(centreLat: number, halfSpanM: number): number` (the latter quantifies the current approximation's worst-case error across the box, in metres, so the plan's premise is measured rather than asserted).
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { utmZoneFor, metresPerSampleError } from "./utm";

test("utm zone for each pilot resort", () => {
  // Portillo -32.842, -70.129 -> zone 19 south, EPSG 32719
  assert.deepEqual(utmZoneFor(-32.842, -70.129), { zone: 19, north: false, epsg: 32719 });
  // Breckenridge 39.4749, -106.081 -> zone 13 north, EPSG 32613
  assert.deepEqual(utmZoneFor(39.4749, -106.081), { zone: 13, north: true, epsg: 32613 });
  // Heavenly 38.9404, -119.912 -> zone 11 north, EPSG 32611
  assert.deepEqual(utmZoneFor(38.9404, -119.912), { zone: 11, north: true, epsg: 32611 });
});

test("the centre-latitude approximation's error is real but sub-metre-per-sample", () => {
  // Quantifies what the UTM warp fixes: mPerDegLon is evaluated once at the box
  // centre, so longitude spacing drifts toward the box's north and south edges.
  const err = metresPerSampleError(39.4749, 3072); // Breckenridge half-span
  assert.ok(err > 0, "approximation is not exact");
  assert.ok(err < 20, `expected a small box-edge error, got ${err} m`);
});
```

- [ ] **Step 2: Run it** — `npx tsx --test scripts/dem/utm.test.ts` — expect FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
/** Standard 6°-wide UTM zones; the Norway/Svalbard exceptions do not apply to our resorts. */
export function utmZoneFor(lat: number, lon: number): { zone: number; north: boolean; epsg: number } {
  const zone = Math.floor((lon + 180) / 6) + 1;
  const north = lat >= 0;
  return { zone, north, epsg: (north ? 32600 : 32700) + zone };
}

const M_PER_DEG_LAT = 111132;
const mPerDegLon = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

/**
 * Worst-case ground error, in metres, from evaluating `mPerDegLon` once at the
 * box centre instead of per-row. Compares the east-west extent implied by the
 * centre constant against the true extent at the box's furthest edge latitude.
 */
export function metresPerSampleError(centreLat: number, halfSpanM: number): number {
  const edgeLat = centreLat + (centreLat >= 0 ? halfSpanM / M_PER_DEG_LAT : -halfSpanM / M_PER_DEG_LAT);
  const degAtCentre = halfSpanM / mPerDegLon(centreLat);
  return Math.abs(degAtCentre * mPerDegLon(edgeLat) - halfSpanM);
}
```

- [ ] **Step 4: Run tests** — `npx tsx --test scripts/dem/utm.test.ts` — expect PASS. Record the measured error for Breckenridge in the task report; it justifies the warp.
- [ ] **Step 5: Commit** — `git commit -m "feat(bake): UTM zone selection + quantified ENU approximation error"`.

### Task 2: GDAL CLI wrappers

**Files:**
- Create: `scripts/dem/gdal.ts`, `scripts/dem/gdal.test.ts`

**Interfaces:**
- Produces: `gdalAvailable(): Promise<boolean>`; `buildVrt(inputs: string[], out: string): Promise<void>`; `warpToUtm(input: string, out: string, epsg: number, resolutionM: number): Promise<void>`; `translateToTiff(input: string, out: string, opts?: { bounds?: [number, number, number, number] }): Promise<void>`; `gdalInfo(path: string): Promise<{ width: number; height: number; epsg: number | null }>`. All reject with a message naming the failing command and its stderr.
- Consumes: Task 1's `epsg`.

- [ ] **Step 1: Write the failing test** — these shell out, so test the *command construction*, not GDAL itself. Export the arg builders alongside the runners:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { warpArgs, vrtArgs } from "./gdal";

test("warp targets the resort's UTM zone at an exact resolution", () => {
  const args = warpArgs("in.vrt", "out.tif", 32613, 4);
  assert.ok(args.includes("-t_srs"), "must set target SRS");
  assert.ok(args.includes("EPSG:32613"));
  // -tr sets exact square ground resolution; without it gdalwarp picks its own.
  const tr = args.indexOf("-tr");
  assert.ok(tr >= 0, "must set target resolution");
  assert.deepEqual(args.slice(tr + 1, tr + 3), ["4", "4"]);
  assert.ok(args.includes("-r") && args.includes("bilinear"), "resampling must be explicit");
});

test("vrt build lists every input after the output", () => {
  assert.deepEqual(vrtArgs(["a.tif", "b.tif"], "m.vrt"), ["m.vrt", "a.tif", "b.tif"]);
});
```

- [ ] **Step 2: Run it** — expect FAIL.
- [ ] **Step 3: Implement.** `warpArgs(input, out, epsg, resM)` returns `["-t_srs", \`EPSG:${epsg}\`, "-tr", String(resM), String(resM), "-r", "bilinear", "-of", "GTiff", input, out]`. `vrtArgs(inputs, out)` returns `[out, ...inputs]`. The runners `execFile` the binary with those args, reject on non-zero exit including stderr, and `gdalAvailable()` resolves false when the binary is missing so callers can fall back with a clear message rather than a stack trace.
- [ ] **Step 4: Run tests** — PASS. Then run `gdalinfo --version` manually and record it in the report; if GDAL is absent, say so — the orchestrator installs it (`brew install gdal`) rather than the plan silently degrading.
- [ ] **Step 5: Commit** — `git commit -m "feat(bake): typed GDAL CLI wrappers"`.

### Task 3: DEM source resolution with a loud Terrarium fallback

**Files:**
- Create: `scripts/dem/sources.ts`, `scripts/dem/sources.test.ts`
- Modify: `lib/game/terrain/resorts.ts` (add `demSource` to `ResortBakeConfig`)

**Interfaces:**
- Produces: `type DemSource = { kind: "3dep"; project: string } | { kind: "copernicus"; tile: string } | { kind: "terrarium" }`; `resolveDemSource(cfg: ResortBakeConfig): DemSource`; `attributionFor(source: DemSource): { name: string; licence: string; notice: string[] }`.
- Consumes: `ResortBakeConfig` from `lib/game/terrain/resorts.ts`.

`ResortBakeConfig` gains `demSource: DemSource` — explicit per resort, no inference:
`ski-portillo` → `{ kind: "copernicus", tile: "S33_00_W071_00" }`; `breckenridge` → `{ kind: "3dep", project: "CO_Central_and_WesternCO_2016_A16" }`; `heavenly` → `{ kind: "3dep", project: "CA_SierraNevada_B22" }`.

- [ ] **Step 1: Write the failing test**

```ts
test("each pilot resort resolves to its designed source", () => {
  assert.deepEqual(resolveDemSource(RESORT_BAKE_CONFIGS["breckenridge"]), { kind: "3dep", project: "CO_Central_and_WesternCO_2016_A16" });
  assert.deepEqual(resolveDemSource(RESORT_BAKE_CONFIGS["heavenly"]), { kind: "3dep", project: "CA_SierraNevada_B22" });
  assert.deepEqual(resolveDemSource(RESORT_BAKE_CONFIGS["ski-portillo"]), { kind: "copernicus", tile: "S33_00_W071_00" });
});

test("terrarium fallback carries the attribution obligation it attaches", () => {
  const a = attributionFor({ kind: "terrarium" });
  assert.match(a.licence, /mixed/i);
  assert.ok(a.notice.length > 0, "fallback must state the obligation it creates");
});

test("3DEP and Copernicus carry their real licence terms", () => {
  assert.match(attributionFor({ kind: "3dep", project: "x" }).licence, /public domain/i);
  const cop = attributionFor({ kind: "copernicus", tile: "x" });
  // Article 6(c) requires a liability disclaimer, not merely a credit line.
  assert.ok(cop.notice.some((n) => /no warranty|liability/i.test(n)));
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**, including a `console.warn` in the fetch path when Terrarium is selected that names the CC-BY obligation now attached. **Step 4:** PASS + full `npm test`.
- [ ] **Step 5: Commit** — `git commit -m "feat(bake): explicit per-resort DEM sources, Terrarium demoted to loud fallback"`.

### Task 4: 3DEP fetch + UTM-warped heightfield bake

**Files:**
- Modify: `scripts/bake-resort.ts` (`bakeHeightfield` sampling path), `scripts/dem/sources.ts` (3DEP tile fetch)
- Test: `scripts/bake-resort.test.ts` (extend)

**Interfaces:**
- Produces: `sampleFromWarpedTiff(path: string): Promise<(row: number, col: number) => number>` — samples the projected grid directly by row/col, so no lat/lon conversion happens per sample.
- Consumes: Tasks 1–3.

The sampling loop in `bakeHeightfield` (currently lat/lon per sample via `mPerDegLon(cLat)`) is replaced for GDAL-backed sources: fetch source tiles → `buildVrt` → `warpToUtm(epsg, cellSizeM)` → read the projected raster → index it by grid row/col. `TerrainMeta` gains `demSource`, `epsg`, and `sourceResolutionM` so a baked asset is self-describing.

- [ ] **Step 1: Write the failing test** — assert `TerrainMeta` carries the new provenance fields and that the projected path produces a square grid whose corner-to-corner ground distance matches `sizeM` within 1 m (the property the ENU approximation misses).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4:** PASS.
- [ ] **Step 5: Re-bake all three resorts** (`npm run bake-resort -- --all` or the script's actual entry point — read it), inspect the diff in committed assets, and record min/max elevation before/after per resort in the report. A large unexplained shift means the warp is wrong, not that the data is better.
- [ ] **Step 6: BUMP `COURSE_VERSION`** in `lib/game/config/versions.ts` and re-capture the terrain-dependent fixtures in the same commit. The v1 parity fixtures pin the *procedural* terrain and must stay green untouched — if they fail, the change leaked into procedural generation, which is a bug.
- [ ] **Step 7: Commit** — `git commit -m "feat(bake): 3DEP 1m lidar for US resorts, UTM-warped sampling, COURSE_VERSION bump"`.

### Task 5: Far-field wire format

**Files:**
- Create: `lib/game/terrain/far-field-format.ts`, `lib/game/terrain/far-field-format.test.ts`

**Interfaces:**
- Produces: `FAR_FIELD_MAGIC`, `FAR_FIELD_VERSION`, `encodeFarField(wedges: FarFieldWedge[], meta: FarFieldMeta): Uint8Array`, `decodeFarField(bytes: Uint8Array): { wedges: FarFieldWedge[]; meta: FarFieldMeta }`, where `FarFieldWedge = { index: number; azimuthStartRad: number; azimuthEndRad: number; positions: Float32Array; indices: Uint32Array; minY: number; maxY: number }` and `FarFieldMeta = { slug: string; radiusM: number; wedgeCount: number; centre: [number, number]; demSource: string; bakedAt: string }`.
- Consumes: nothing.

Positions are quantised to 16-bit per axis against the wedge's own bounds (the same trick the heightfield already uses) — full float precision is wasted at 30 km. Follow the header discipline in `lib/game/replay/codec.ts`: magic, version, explicit sizes, and a decoder that rejects malformed input with a typed error rather than throwing on a bad array index.

- [ ] **Step 1: Failing round-trip test** — encode two synthetic wedges, decode, assert positions within the quantisation tolerance, indices exact, meta exact; plus a corrupted-header rejection test.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4:** PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(terrain): far-field wire format"`.

### Task 6: Far-field bake

**Files:**
- Create: `scripts/bake-far-field.ts`, `scripts/bake-far-field.test.ts`

**Interfaces:**
- Produces: one `public/game/terrain/<slug>-far.bin.br` per resort + a `.json` sidecar with `FarFieldMeta`.
- Consumes: Tasks 2–5.

Radial grading per design §3: cell sizes 16/48/128/256 m at 0.5/2/6/15/30 km, 16 angular wedges. The inner 0.5 km is a *hole* — the streamed near-field tiles own it — and the seam must be watertight enough that no gap is visible from the camera's eye height; overlap the boundary by one cell rather than trying to match vertices exactly.

- [ ] **Step 1: Failing tests** — ring cell sizes match the table; wedge azimuths tile 2π exactly with no gap or overlap; the inner hole matches the near-field extent; total encoded size ≤ 400 KB brotli (fail loudly, do not warn).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** using `delatin` or `martini` for triangulation (ISC, pure JS — add to devDependencies only). **Step 4:** PASS.
- [ ] **Step 5: Bake all three resorts**; record per-resort vert count, drawn-wedge estimate, and compressed size in the report. Confirm Aconcagua appears in Portillo's mesh (it is 23.1 km out at +10° elevation — check the geometry contains a peak at that bearing and distance; if it does not, the radius or the source window is wrong).
- [ ] **Step 6: Commit** — `git commit -m "feat(bake): far-field 30km wedge mesh"`.

### Task 7: Far-field renderer

**Files:**
- Create: `lib/game/rendering/FarFieldRenderer.ts`, tests in `rendering.test.ts`
- Modify: `lib/game/rendering/SceneFactory.ts` (remove the two `makeRidge` bands), `lib/game/rendering/Renderer.ts` (construct + dispose)

**Interfaces:**
- Produces: `class FarFieldRenderer { constructor(scene: THREE.Scene, asset: DecodedFarField, opts: { nodes: NodeFactories | null }); update(cameraPosition: THREE.Vector3, frustum: THREE.Frustum): void; dispose(): void }` — `update` toggles wedge visibility only; it never rebuilds geometry and allocates nothing.
- Consumes: Task 5's decoder; the existing node-material factories (WebGPU) with a WebGL fallback material, gated exactly as Task 6 of P11 did.

The material must accept the same atmosphere/fog treatment as the near field, or the seam will read as a colour step. Distant geometry sits far beyond the shadow cascade's `maxFar` (460 m) — it receives no shadows by design; do not try to extend the cascades to cover it.

- [ ] **Step 1: Failing tests** — wedges outside the frustum are `visible = false`; `update()` allocates nothing (scratch-object identity assertion, per the Task 8 regime); `dispose()` releases every geometry and material (extend the disposal audit, which must now count the far-field meshes).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4:** PASS + full `npm test`.
- [ ] **Step 5: Commit** — `git commit -m "feat(drop-in): far-field renderer replaces procedural ridge bands"`.

### Task 8: Integration gate (orchestrator)

- [ ] Production build; serve; screenshot all three resorts on both backends at `cam=classic` and `cam=high`, comparing against pre-change references — specifically checking the near/far seam, the fog transition across it, and Aconcagua on Portillo's skyline.
- [ ] Re-run the per-resort canvas-luminance calibration: a real horizon *will* move the numbers, so re-baseline as a **deliberate** change with the justification in the commit message (the don't-tune-to-green rule's sanctioned exception).
- [ ] Frame-time check at the widest camera on the weakest quality rung; the far field must not push the governor into a permanent step-down.
- [ ] Both e2e projects + heap guard green; `BUDGETS.md` updated with the far-field asset and vert budgets.

---

## Self-review notes (resolved)

- **Design §3 coverage**: wedge mesh (T5–7), DEM upgrade (T3–4), UTM fix (T1, T4), GDAL tooling (T2), `delatin`/`martini` (T6), no-blending constraint (T3 config is explicit per resort, one source each).
- **The `COURSE_VERSION` consequence is called out in the Global Constraints and given its own step (T4.6)** rather than left to be discovered by a failing fixture. Leaderboards are empty today, which is why this phase is time-sensitive.
- **Terrarium is not deleted**, only demoted with a loud warning — deleting it would break the bake for any future resort without a configured source.
- Type consistency: `DemSource` (T3) is what `TerrainMeta.demSource` (T4) records and what `attributionFor` (T3) consumes; `FarFieldWedge`/`FarFieldMeta` (T5) are what T6 emits and T7 renders.
