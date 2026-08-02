# Drop In v2 — Phases 11 & 12 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Spec: `docs/drop-in-v2/P11-P12-DESIGN.md`. Orchestration lessons: `STATUS.md`
> (sandboxed agents cannot see rendering bugs — every visual task ends at an
> orchestrator browser-review gate, budget 1–2 fix rounds).

**Goal:** Migrate the Drop In renderer to three.js WebGPURenderer + TSL (with automatic WebGL2 fallback), modernize assets/perf (KTX2, shader pre-warm, zero-alloc frame path, thermal governor), then add a flag-gated `physicsV2` skier model (carve/air/surface feel) inside the deterministic TS core.

**Architecture:** The render layer (`lib/game/rendering/`) swaps its backend and material system; the sim core (`lib/game/{core,physics}`) is untouched by Phase 11. Phase 12 adds a parallel v2 integrator selected by `SimulationConfig.physicsModel`, defaulting to `"v1"` so every existing fixture stays bit-identical.

**Tech Stack:** three 0.185.1 (`three/webgpu`, `three/tsl`, addons `CSMShadowNode`, `BloomNode`, `Lut3DNode`, `FXAANode`), zod config SoT, node:test via tsx, Playwright.

## Global Constraints

- three stays at **0.185.1**, ceiling `<0.186` (matched pair rule from Phase 6). Do not bump.
- The `postprocessing` npm package must be **gone from package.json** by end of Task 6.
- Sim core purity: nothing under `lib/game/{core,physics,terrain}` may import three or `lib/game/rendering` (eslint import fences enforce this — do not weaken them).
- All 374 existing unit tests + 9 Playwright specs stay green after every task. Parity fixtures are sacred: any diff in `simulation-parity.test.ts` or `real-determinism.test.ts` with `physicsModel: "v1"` is a task failure, full stop.
- Unit tests run in Node with no GPU: never instantiate `WebGPURenderer` in a unit test — test pure functions and injected mocks (the `RendererBackend` seam in `Renderer.ts:18`).
- Fog must remain **player-relative** (`referenceHeight` = skier Y). Absolute-Y fog washes out at real 3km altitudes (Phase 6 lesson).
- Dev-only query overrides follow the existing `nopost` pattern (`Renderer.ts:91`): gated on `process.env.NODE_ENV !== "production"` except `gfx`, which is allowed in production as a support/debug lever.
- Commit per task with `feat(drop-in): …` / `test(drop-in): …`; orchestrator merges `--no-ff` per phase, same as Phases 0–9.
- API names to verify once at Task 1 against the pinned r185 `node_modules` (they moved between recent releases): `PostProcessing` class export from `three/webgpu` (dev branch renamed toward `RenderPipeline`; r185 ships `PostProcessing`), `chromaticAberration` TSL display node (if absent in r185, use the custom RGB-shift node given in Task 5).

---

## Phase 11 — Renderer & Asset Modernization

### Task 1: Backend selection + async renderer bring-up

**Files:**
- Create: `lib/game/rendering/backend.ts`
- Test: `lib/game/rendering/backend.test.ts`
- Modify: `lib/game/runtime/createGame.ts` (await backend before `GameRuntime`), `lib/game/rendering/Renderer.ts` (accept prepared backend; widen `RendererBackend`)

**Interfaces:**
- Produces: `resolveBackendKind(search: string, hasWebGPU: boolean): "webgpu" | "webgl"` (pure), `createRendererBackend(canvas: HTMLCanvasElement, kind: "webgpu" | "webgl"): Promise<RendererBackend>` (calls `renderer.init()`), and `RendererBackend` gains `readonly backendKind: "webgpu" | "webgl"` and optional `compileAsync?(scene: THREE.Object3D, camera: THREE.Camera): Promise<unknown>`; `forceContextLoss` becomes optional (`forceContextLoss?(): void` — WebGPU has no context-loss API; guard the call in `dispose()`).
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test**

```ts
// lib/game/rendering/backend.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBackendKind } from "./backend";

test("defaults to webgpu when available", () => {
  assert.equal(resolveBackendKind("", true), "webgpu");
});
test("falls back to webgl when WebGPU is unavailable", () => {
  assert.equal(resolveBackendKind("", false), "webgl");
});
test("?gfx=webgl forces the fallback even with WebGPU present", () => {
  assert.equal(resolveBackendKind("?gfx=webgl", true), "webgl");
});
test("?gfx=webgpu without adapter support still resolves webgl", () => {
  assert.equal(resolveBackendKind("?gfx=webgpu", false), "webgl");
});
```

- [ ] **Step 2: Run it** — `npx tsx --test lib/game/rendering/backend.test.ts` — expect FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// lib/game/rendering/backend.ts
import type { RendererBackend } from "./Renderer";

export function resolveBackendKind(search: string, hasWebGPU: boolean): "webgpu" | "webgl" {
  if (!hasWebGPU) return "webgl";
  return new URLSearchParams(search).get("gfx") === "webgl" ? "webgl" : "webgpu";
}

export async function createRendererBackend(canvas: HTMLCanvasElement, kind: "webgpu" | "webgl"): Promise<RendererBackend> {
  const { WebGPURenderer } = await import("three/webgpu");
  const renderer = new WebGPURenderer({ canvas, antialias: true, forceWebGL: kind === "webgl" });
  await renderer.init();
  return Object.assign(renderer as unknown as RendererBackend, { backendKind: kind });
}
```

In `Renderer.ts`: `options.backend` becomes required for tests but the constructor default changes from `new THREE.WebGLRenderer(...)` to throwing if absent in browser paths is NOT wanted — keep the seam: `this.renderer = options.backend ?? …` stays, but the production call site (`createGame`) now always passes a prepared backend. Guard `this.renderer.forceContextLoss?.()` in `dispose()`.

In `createGame.ts`, before constructing `GameRuntime`:

```ts
import { createRendererBackend, resolveBackendKind } from "../rendering/backend";
// inside createGame(), after terrain load:
const kind = resolveBackendKind(
  typeof location === "undefined" ? "" : location.search,
  typeof navigator !== "undefined" && "gpu" in navigator,
);
const backend = await createRendererBackend(options.canvas, kind);
```

and thread `backend` through `GameRuntime` → `GameRenderer` `options.backend`. `GameRuntime`'s constructor signature gains `backend: RendererBackend` before `assetLoadMs`; update `createGame.test.ts` mocks accordingly.

- [ ] **Step 4: Run tests** — `npx tsx --test lib/game/rendering/backend.test.ts lib/game/runtime/createGame.test.ts` — expect PASS. Then full `npm test` — expect green.
- [ ] **Step 5: Verify r185 exports** — `node -e "import('three/webgpu').then(m => console.log(!!m.WebGPURenderer, !!m.PostProcessing))"`. Record the result in the task report (Task 5 depends on the `PostProcessing` name).
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(drop-in): WebGPU backend selection with automatic WebGL fallback"`.

### Task 2: Snow material → TSL node material

**Files:**
- Create: `lib/game/rendering/SnowNodeMaterial.ts`
- Test: extend `lib/game/rendering/rendering.test.ts`
- Modify: `lib/game/rendering/TerrainRenderer.ts` and `lib/game/rendering/SceneFactory.ts` call sites that used `polishSnowMaterial` (keep `SnowMaterial.ts` for `buildPosterLut`/`buildSnowDetailNormal` — they are backend-agnostic textures).

**Interfaces:**
- Consumes: `buildSnowDetailNormal(seed)`, `SnowUniforms` shape (`horizon`, `glint`, `track` — see below).
- Produces: `createSnowNodeMaterial(detailNormal: THREE.Texture, uniforms: SnowNodeUniforms): MeshStandardNodeMaterial` and `interface SnowNodeUniforms { horizon: UniformNode<THREE.Color>; glint: UniformNode<number>; track: UniformNode<THREE.Vector4>; }` — TSL `uniform()` nodes still expose `.value`, so `Renderer.render()`'s per-frame writes (`snowUniforms.glint.value`, `snowUniforms.track.value.set(...)`) keep working unchanged. `SceneFactory` constructs the uniforms with `uniform(new THREE.Color(...))` etc. and exposes them under the same `built.snowUniforms` name.

- [ ] **Step 1: Write the failing test** (structure-level; no GPU):

```ts
test("snow node material carries poster uniforms and triplanar detail", () => {
  const uniforms = createSnowNodeUniforms();
  const material = createSnowNodeMaterial(buildSnowDetailNormal(7), uniforms);
  assert.equal(material.isNodeMaterial, true);
  assert.ok(material.colorNode ?? material.outputNode, "must install a custom shading node");
  uniforms.glint.value = 0.5;
  assert.equal(uniforms.glint.value, 0.5);
});
```

- [ ] **Step 2: Run** — expect FAIL. 
- [ ] **Step 3: Implement.** Port `polishSnowMaterial`'s GLSL (SnowMaterial.ts:80–113) to TSL. Full mapping — keep constants identical so the look matches:

```ts
import { MeshStandardNodeMaterial } from "three/webgpu";
import {
  abs, cameraPosition, clamp, dot, float, floor, fract, length, max, mix, normalWorld,
  normalize, pow, positionWorld, sin, smoothstep, step, texture, uniform, vec2, vec3, vec4,
} from "three/tsl";

// snowHash(p) = fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453)
const snowHash = (p) => fract(sin(dot(p, vec3(127.1, 311.7, 74.7))).mul(43758.5453));
const snowFlake = (p) => normalize(vec3(snowHash(p).sub(0.5), snowHash(p.add(17.3)).sub(0.5), snowHash(p.add(41.7)).sub(0.5)));
```

- Triplanar detail: weights `pow(abs(normalWorld), 4)` normalized; sample `texture(detailNormal, positionWorld.yz.div(0.35))` etc. at the two scales (0.35 near / 3.0 far), blend by `smoothstep(28,105,length(positionWorld.sub(cameraPosition)))`, feed `material.normalNode` (perturb `normalWorld` by `mix(.08,.22,near)` like line 99).
- Wrap/rim/glint/backscatter block (lines 101–111) → build an `outgoingLight`-style adjustment via `material.emissiveNode` + `material.colorNode` composition: wrap term `clamp(dot(n, L).add(0.5).div(1.5), 0, 1)` with `L = vec3(-.46,.62,-.64)`; rim `pow(sub(1, clamp(dot(n, v), 0, 1)), 3).mul(uniforms.horizon).mul(0.055)`; glints via `snowFlake(floor(positionWorld.mul(7)))` / `.mul(19).add(53)` with `pow(…, 400)` / `pow(…, 2000)` and the `step(.72/.82)` cutoffs scaled by `uniforms.glint`; track dimming from `uniforms.track` using the segment-distance formula (line 91) rebuilt with TSL vec2 ops.
- Set `material.roughness = 0.92`, `material.metalness = 0` (copy exact values from the existing `MeshStandardMaterial` construction in TerrainRenderer/SceneFactory — read them at implementation time).
- [ ] **Step 4: Run tests** — targeted file then `npm test`. PASS required.
- [ ] **Step 5: Commit** — `feat(drop-in): TSL snow node material (triplanar, wrap, rim, glint, track)`.

### Task 3: Height fog + sky → scene-level TSL fog

**Files:**
- Create: `lib/game/rendering/AtmosphereNode.ts`
- Test: extend `lib/game/rendering/rendering.test.ts`
- Modify: `lib/game/rendering/SceneFactory.ts` (install `scene.fogNode`; port sky/cloud ShaderMaterials to node materials), `Renderer.ts` (drop `configureSceneMaterials`'s `addHeightFog` leg for node materials — scene fog now applies globally; keep `Atmosphere.ts`'s pure helpers `fogExp2Amount`/`heightFogAmount` and their tests as the reference math).

**Interfaces:**
- Produces: `createAtmosphereFog(uniforms: AtmosphereNodeUniforms): Node` assigned to `scene.fogNode`, where `AtmosphereNodeUniforms` mirrors `AtmosphereUniforms` (`density`, `heightFalloff`, `referenceHeight`, `blue`, `warm`, `sunDirection`) as TSL `uniform()` nodes with `.value` intact — `Renderer.render()` line 147 (`atmosphereUniforms.referenceHeight.value = state.pos.y`) keeps working.
- Consumes: the fog math from `Atmosphere.ts:16-19` — the TSL expression must equal `heightFogAmount` exactly:

```ts
const ray = positionWorld.sub(cameraPosition);
const dist = length(ray);
const height = exp(uniforms.heightFalloff.negate().mul(max(positionWorld.y.sub(uniforms.referenceHeight), 0)));
const factor = sub(1, exp(uniforms.density.mul(uniforms.density).mul(dist).mul(dist).mul(height).negate()));
const sunAmount = pow(max(dot(normalize(ray), normalize(uniforms.sunDirection)), 0), 3);
// fogNode color: mix(uniforms.blue, uniforms.warm, sunAmount); factor: clamp(factor, 0, 1)
```

- [ ] **Step 1: Failing test** — unit-test a pure sampling helper: export `heightFogReference` re-using `heightFogAmount` and assert the TSL constants (density², falloff, sun pow 3) are sourced from the same uniform objects (structural assertions: `createAtmosphereFog` returns a node and mutating `referenceHeight.value` is visible on the uniform).
- [ ] **Step 2: Run** — FAIL. 
- [ ] **Step 3: Implement** `AtmosphereNode.ts` per the expression above (`fog()` node from `three/tsl` composes color+factor). Port `SceneFactory`'s sky dome / cloud band / sun disc ShaderMaterials to `NodeMaterial` with the same 3-stop gradient uniforms (`skyUniforms.uTime` keeps `.value` ticking from `Renderer.render()` line 148). Materials that opted out via `userData.heightFog === false` set `material.fog = false` instead.
- [ ] **Step 4: Run tests** — targeted + `npm test`. PASS.
- [ ] **Step 5: Commit** — `feat(drop-in): scene-level TSL height fog + node sky (player-relative reference preserved)`.

### Task 4: CSM → CSMShadowNode

**Files:**
- Modify: `lib/game/rendering/CsmShadows.ts` (same public API: `setupMaterial`, `setWeather`, `setQuality`, `update`, `dispose`)
- Test: existing `rendering.test.ts` CSM cases keep passing (they exercise the class through mocks).

**Interfaces:**
- Consumes: `SUN_DIRECTION` from SceneFactory, `QualityRung`, `ResortWeather`, `VisualWeatherPreset` — unchanged.
- Produces: identical class surface; internally one `THREE.DirectionalLight` whose `shadow.shadowNode = new CSMShadowNode(light, { cascades, maxFar: 250, mode })` (import from `three/addons/csm/CSMShadowNode.js` — WebGPU-native per three docs). `setupMaterial` becomes a no-op kept for API compatibility (CSMShadowNode works through the light, not per-material injection) — delete the `onBeforeCompile` chaining. `setQuality` maps rung<3 or mobile → `cascades: 1`, else 3, by rebuilding the shadow node (CSMShadowNode cascade count is constructor-time; wrap in `rebuild(cascades)` that disposes and re-creates). `setWeather` sets `light.color` / `light.intensity` directly.

- [ ] **Step 1:** Update the CSM unit tests to the new internals (light + shadowNode present, cascade rebuild on quality change). Run — FAIL.
- [ ] **Step 2:** Implement per above. `Renderer.ts`: `configureSceneMaterials` loses its CSM leg (materials no longer need per-material setup); keep the function exported with fog-opt-out handling only, updating its tests.
- [ ] **Step 3:** `npm test` green. Commit — `feat(drop-in): CSMShadowNode cascaded shadows on the node pipeline`.

### Task 5: Post chain → node-based PostProcessing

**Files:**
- Rewrite: `lib/game/rendering/PostProcessing.ts`
- Test: extend `rendering.test.ts` (quality-rung gating logic as pure data)
- Modify: `package.json` (nothing yet — removal is Task 6), `MotionEffects.ts` untouched (`chromaticAberrationOffset(speed, reducedMotion)` is reused verbatim).

**Interfaces:**
- Consumes: `buildPosterLut(32)` (unchanged), `chromaticAberrationOffset`, `QualityRung`.
- Produces: same class surface as today (`PostProcessing` with `setSize`, `setQuality(rung)`, `render(dt)`, `dispose()`), constructor becomes `(renderer: RendererBackend, scene: THREE.Scene, camera: THREE.PerspectiveCamera, speed: { value: number }, reducedMotion: boolean)`.

- [ ] **Step 1: Failing test** — extract and test the rung policy as a pure function so it can't drift:

```ts
export function postChainPolicy(rung: QualityRung, reducedMotion: boolean) {
  return { chain: rung > 0, bloom: rung >= 3, aa: rung >= 2, chromatic: rung > 0 && !reducedMotion };
}
```

Assert the four rows matching today's `setQuality` (PostProcessing.ts:41-46). Run — FAIL.

- [ ] **Step 2: Implement.** Node chain (imports from `three/tsl` + addons):

```ts
import { PostProcessing as ThreePost } from "three/webgpu"; // name verified in Task 1 step 5
import { pass, renderOutput, uniform } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { fxaa } from "three/addons/tsl/display/FXAANode.js";
// LUT + vignette + CA composed inline:
const scenePass = pass(scene, camera);
let color = scenePass.getTextureNode();
color = color.add(bloom(color, 0.5, /*radius*/ 0.8, /*threshold*/ 0.85)); // rung>=3, gate via uniform mul
// poster LUT: sample buildPosterLut(32) as 3D texture — use texture3D(lut, color.rgb) lookup (Lut3DNode addon if present: lut3D(color, lutTexture, 32, 1))
// vignette: color.mul(sub(1, smoothstep(0.35, 1.0, length(screenUV.sub(0.5)).mul(1.4142)).mul(0.5)))
// chromatic aberration: offset uniform uCA (vec2, set per-frame from chromaticAberrationOffset):
//   r = colorNode sampled at screenUV.add(uCA), b at screenUV.sub(uCA), g at screenUV — if r185 lacks the
//   chromaticAberration addon node, build this 3-tap RGB shift from scenePass.getTextureNode().sample(uv).
post.outputNode = fxaa(renderOutput(color));
```

Rung gating: multiply optional stages by `uniform(0|1)` floats flipped in `setQuality` (node graphs are compiled once; do NOT rebuild the graph per rung). `render(dt)` sets the CA uniform from `chromaticAberrationOffset(speed.value, reducedMotion)` then `post.render()`.
- [ ] **Step 3:** `npm test` green (policy test + existing suite). Commit — `feat(drop-in): node-based poster post chain (bloom, LUT, vignette, CA, FXAA)`.

### Task 6: Renderer integration, pre-warm, remove `postprocessing`

**Files:**
- Modify: `lib/game/rendering/Renderer.ts` (post is no longer dynamically imported behind `!options.backend` — construct directly with the injected backend; add `prewarm()`), `lib/game/runtime/GameRuntime.ts` (await prewarm before first frame / before Start enables), `package.json` (drop `postprocessing`), `lib/game/rendering/WeatherRenderer.ts` + `EffectsRenderer.ts` + `SkierRenderer.ts` + `WorldRenderer.ts` + `LandmarkRenderer.ts` (any `ShaderMaterial`/`onBeforeCompile` stragglers → node materials; audit with `grep -rn "onBeforeCompile\|ShaderMaterial" lib/game/rendering/`).

**Interfaces:**
- Produces: `GameRenderer.prewarm(): Promise<void>` → `this.renderer.compileAsync?.(this.built.scene, this.built.camera)` for the current rung, then once more at rung 4 settings (highest-cost variants compiled up front).
- Consumes: Task 1's `RendererBackend.compileAsync?`.

- [ ] **Step 1:** `grep -rn "onBeforeCompile\|ShaderMaterial\|postprocessing" lib/game/` — enumerate every remaining WebGL-only construct; port each to node equivalents (same pattern as Tasks 2–3).
- [ ] **Step 2:** Wire `prewarm()` into `GameRuntime.start()` before the first `requestAnimationFrame` (GameRuntime.ts:85); loading UI already exists (`uiBridge.setLoadingProgress`) — report a final `0.95 → 1.0` step around prewarm.
- [ ] **Step 3:** `npm uninstall postprocessing`; delete the `@ts-ignore` import block in the old PostProcessing (already rewritten in Task 5); `npx tsc --noEmit` + `npm run lint` + `npm test` all green.
- [ ] **Step 4:** `npm run build` (orchestrator runs this — Codex sandbox has no network for Google Fonts).
- [ ] **Step 5:** Commit — `feat(drop-in): WebGPU renderer integration, shader pre-warm, drop postprocessing dependency`.

### Task 7: KTX2 texture infrastructure

**Files:**
- Create: `lib/game/rendering/loaders/GameTextureLoader.ts`, `public/game/basis/` (transcoder `.js`/`.wasm` copied from `node_modules/three/examples/jsm/libs/basis/`)
- Test: `lib/game/rendering/loaders/GameTextureLoader.test.ts`
- Modify: `scripts/bake-resort.ts` (emit `.ktx2` for any raster texture it produces), `docs/drop-in-v2/BUDGETS.md` (per-asset ceilings row)

**Interfaces:**
- Produces: `createGameTextureLoader(renderer: RendererBackend): { load(url: string): Promise<THREE.Texture>; dispose(): void }` — wraps `KTX2Loader` (`three/addons/loaders/KTX2Loader.js`), `setTranscoderPath("/game/basis/")`, `detectSupport(renderer)`.
- Consumes: Task 1 backend.

- [ ] **Step 1:** Inventory: `find public/game -type f | grep -viE 'terrain|audio'` + grep loaders for `TextureLoader`. Current textures are procedural `DataTexture`s (SnowMaterial.ts) — expected result: zero file textures today. If so, this task delivers the loader + transcoder assets + bake-pipeline support so Phase 10+ art lands compressed, and records "no eligible textures yet" in BUDGETS.md. Do not invent textures to convert (YAGNI).
- [ ] **Step 2:** Failing test: `resolveTranscoderPath()` pure helper returns `/game/basis/`; loader factory throws cleanly without a renderer. Run — FAIL. Implement. PASS.
- [ ] **Step 3:** `npm test` green; commit — `feat(drop-in): KTX2 loader infrastructure + basis transcoder assets`.

### Task 8: Zero-allocation frame path + heap guard

**Files:**
- Modify: `lib/game/rendering/EffectsRenderer.ts`, `WeatherRenderer.ts`, `Renderer.ts` (line 152: `camera.position.clone()` in `render()` — replace with a module-scope scratch `THREE.Vector3`), `GameRuntime.ts` frame closure audit
- Create: `tests/e2e/drop-in-heap.spec.ts`

**Interfaces:** none new — behavior-preserving refactors.

- [ ] **Step 1:** Audit: `grep -n "new THREE\.\|\.clone()\|=> {" lib/game/rendering/*.ts lib/game/runtime/GameRuntime.ts` and list every allocation reachable from `GameRenderer.render()` / `GameRuntime.frame`. Known offender to fix: `Renderer.ts:152` (`this.built.camera.position.clone()`).
- [ ] **Step 2:** Failing e2e (Playwright, Chromium with `--js-flags=--expose-gc`): start a run, play 10 simulated seconds via the existing input-injection helpers in `tests/e2e/drop-in.spec.ts`, call `window.gc()` twice, snapshot `performance.memory.usedJSHeapSize`, run 10 more seconds, gc twice, re-snapshot; assert growth `< 2 MB`. Expected: FAIL if offenders remain, then:
- [ ] **Step 3:** Fix each listed allocation with pre-allocated scratch objects/pools (follow the existing module-scope scratch-vector idiom in `physics/integrator.ts:12-16`). Re-run e2e until green.
- [ ] **Step 4:** `npm test` + `npx playwright test drop-in-heap` green. Commit — `perf(drop-in): zero-allocation render path + heap-growth e2e guard`.

### Task 9: Thermal/frame governor

**Files:**
- Modify: `lib/game/rendering/QualityController.ts`
- Test: `lib/game/rendering/QualityController.test.ts` (create — governor logic is pure)

**Interfaces:**
- Produces: `QualityController.observeFrameTimes(p75Ms: number, budgetMs: number, nowSeconds: number): QualityState` — steps `rung` down when `p75Ms > budgetMs` continuously for ≥5s; steps up only after ≥20s of `p75Ms < budgetMs * 0.7` (hysteresis); never oscillates faster than one step per 5s. Existing `observe(fps)` stays for the fast loop; `Renderer.render()` calls the governor every 1.4s adapt tick with the rolling p75 of `frameTimes` and `budgetMs = 1000/45` mobile, `1000/58` desktop.
- Consumes: existing `QualityRung`, `frameTimes` buffer (Renderer.ts:81,139).

- [ ] **Step 1:** Failing tests: sustained-over-budget-for-5s steps down once; recovery below 0.7× budget for 20s steps back up; a 4s spike does nothing; step-down resets the recovery clock. Run — FAIL.
- [ ] **Step 2:** Implement (track `overSince`/`underSince`/`lastStepAt` timestamps; pure, injectable `nowSeconds`). PASS.
- [ ] **Step 3:** Wire into `Renderer.render()` adapt tick; telemetry: emit the existing Phase 6 perf-telemetry event with `{ reason: "governor", from, to }` on every step. `npm test` green. Commit — `feat(drop-in): thermal frame governor with hysteresis on the quality ladder`.

### Task 10: Phase 11 gate — dual-backend e2e + orchestrator visual review

**Files:**
- Modify: `tests/e2e/drop-in.spec.ts` (parameterize the suite over `?gfx=webgl` and default; keep the canvas-luminance guard `mean<190, stdev>28` on both), `docs/drop-in-v2/BUDGETS.md` (record measured p50/p95 per rung on this Mac + iPhone via playtest URL)

**Steps:**
- [ ] **Step 1:** Duplicate the Playwright project matrix: `{ name: "webgpu" }` (Chromium default — WebGPU on) and `{ name: "webgl", use extra query gfx=webgl }`. All 9 specs + luminance guard green on both.
- [ ] **Step 2:** ORCHESTRATOR (not a sandboxed agent): `xcodebuild -downloadComponent MetalToolchain` (once), production build, `next start :3100`, screenshot probe script at fixed sim timestamps on both backends for all three resorts; diff against Phase 6 reference screenshots; file precise defect briefs; budget 1–2 fix rounds.
- [ ] **Step 3:** Jared eyeball pass on the playtest URL (Safari + Chrome). Merge `--no-ff` to `feat/drop-in-v2` with all green.

---

## Phase 12 — physicsV2 (deterministic core)

### Task 11: physicsModel flag + config plumbing (parity-neutral)

**Files:**
- Modify: `lib/game/core/config.ts`, `lib/game/core/surface-config.test.ts`
- Test: extend `surface-config.test.ts`

**Interfaces:**
- Produces: `SimulationConfig` gains `readonly physicsModel: "v1" | "v2"` and `readonly carve: CarveParams` where

```ts
export interface CarveParams {
  readonly gripBase: number;       // lateral grip at zero edge
  readonly gripEdgeGain: number;   // added grip per unit edge angle
  readonly gripSpeedFade: number;  // grip loss factor at MAX_SPEED
  readonly skidDrag: number;       // forward drag while skidding (rightVel high, edge low)
  readonly turnInLag: number;      // seconds of edge-angle smoothing (surface feel)
  readonly airAuthority: number;   // in-air steer multiplier
  readonly landingWindow: number;  // seconds of landing absorption
}
```

`simulationConfig(surface, model: "v1" | "v2" = "v1")` returns the existing rows with `physicsModel: "v1"` and a v1-shaped default `carve` (values below) — **v1 rows must be value-identical to today's table plus the new inert fields**. v2 rows (same four surfaces) get distinct `carve` tables: powder `{gripBase 4.2, gripEdgeGain 6.5, gripSpeedFade 0.25, skidDrag 0.35, turnInLag 0.14, airAuthority 0.9, landingWindow 0.22}`, packed `{5.0, 8.0, 0.3, 0.25, 0.08, 1.0, 0.16}`, firm `{4.4, 8.6, 0.4, 0.2, 0.06, 1.0, 0.12}`, ice `{2.8, 7.2, 0.55, 0.12, 0.04, 1.0, 0.08}` (tuning starts here; Jared's feel gate owns final values).
- Consumes: nothing; `stepSimulation` untouched this task.

- [ ] **Step 1:** Failing tests: `simulationConfig("packed")` deep-equals the pre-change object plus `{physicsModel:"v1", carve: <default>}`; `simulationConfig("ice","v2").physicsModel === "v2"`; all four v2 rows present. Run — FAIL. Implement. PASS.
- [ ] **Step 2:** Run the full parity suites (`simulation-parity.test.ts`, `real-determinism.test.ts`) — must be untouched-green.
- [ ] **Step 3:** Commit — `feat(drop-in): physicsModel flag + per-surface carve params (v1 parity-neutral)`.

### Task 12: v2 integrator — carve dynamics

**Files:**
- Create: `lib/game/physics/integrator-v2.ts`
- Test: `lib/game/physics/integrator-v2.test.ts`
- Modify: `lib/game/core/simulation.ts` (dispatch), `lib/game/physics/skier.ts` + `lib/game/core/types.ts` (add `edgeAngle: number` and `landingTimer: number` to `SimulationState`, initialized 0 — verify parity suites stay green after the shape change, since v1 never reads them)

**Interfaces:**
- Produces: `integrateSkierV2(state: SimulationState, input: InputFrame, dt: number, world: SimulationWorld): void` — v1 signature. Dispatch in `stepSimulation`: `(world.config.physicsModel === "v2" ? integrateSkierV2 : integrateSkier)(state, input, dt, world)`.
- Consumes: `CarveParams` (Task 11), all of `core/math.ts`, `checkGates`/`checkObstacleCollision`/`onLand`, `GRAVITY`/`MAX_SPEED` constants.

- [ ] **Step 1:** Failing tests (fixed-step, seeded, pure — mirror `physics.test.ts` style):
  - edge angle tracks steer through the `turnInLag` smoothing: after 0.5s of full steer at dt=1/120, `state.edgeAngle` is within 1e-6 of the analytic `1 - exp(-t/lag)` response;
  - grip curve: at equal speed, lateral velocity decays faster with `edge=1` than `edge=0.2` (assert ratio > 2);
  - ice vs packed: identical inputs produce larger `|rightVelocity|` residue on ice after 1s (assert strictly greater);
  - determinism: two runs, same inputs → `assert.deepEqual` on full state after 600 steps.
- [ ] **Step 2:** Run — FAIL (module missing).
- [ ] **Step 3:** Implement. Start from a copy of `integrateSkier` (lift/crash blocks unchanged); replace the ground steering block (integrator.ts:104-107) with:

```ts
const edgeTarget = clamp(Math.abs(steer), 0, 1);
const lagRate = 1 / Math.max(cfg.carve.turnInLag, 1e-3);
s.edgeAngle += (edgeTarget - s.edgeAngle) * (1 - Math.exp(-lagRate * dt));
const speedFade = 1 - cfg.carve.gripSpeedFade * clamp01(flatSpeed / (MAX_SPEED * cfg.topSpeedMultiplier));
const grip = (cfg.carve.gripBase + cfg.carve.gripEdgeGain * s.edgeAngle) * speedFade * (1 + brake * 1.4);
const newRightVelocity = rightVelocity * Math.exp(-grip * dt);
const skid = clamp01(Math.abs(rightVelocity) / 13) * (1 - s.edgeAngle);
let newForwardVelocity = forwardVelocity - (drag + skid * cfg.carve.skidDrag) * forwardVelocity * dt - airDrag * dt;
s.carve = damp(s.carve, clamp01(Math.abs(rightVelocity) / 13) * (0.35 + s.edgeAngle * 0.65), 9, dt);
```

(`cfg = world.config`; `drag`/`airDrag`/assist/tuck lines carry over from v1 verbatim.) Use only `core/math.ts` ops + `Math.exp/hypot/sin/cos/atan2` — the same transcendental set v1 already relies on for cross-platform determinism.
- [ ] **Step 4:** Targeted tests PASS; full `npm test` green (parity suites prove v1 untouched).
- [ ] **Step 5:** Commit — `feat(drop-in): physicsV2 carve dynamics (edge angle, grip curve, skid drag)`.

### Task 13: v2 integrator — air control + landing absorption

**Files:**
- Modify: `lib/game/physics/integrator-v2.ts`
- Test: extend `integrator-v2.test.ts`

**Interfaces:**
- Consumes: `onLand(state, impact, thresholdMultiplier)` from `collision.ts` (unchanged); `CarveParams.airAuthority`, `landingWindow`.
- Produces: in-air turn rate becomes `3.4 * cfg.carve.airAuthority * (1 / (1 + s.airTime * 0.8))` (authority decays with hang time); on touchdown, if the player's velocity is within 25° of the surface fall line (reuse the fall-line projection from integrator.ts:98-100), set `s.landingTimer = cfg.carve.landingWindow` and pass `impact * 0.72` to `onLand` (clean-landing absorption); while `landingTimer > 0` decrement it and suppress `checkObstacleCollision` crash amplification is NOT touched — only the impact scaling changes.

- [ ] **Step 1:** Failing tests: aligned landing at fixed impact does not crash where a 90°-off landing does (construct both with hand-built states); in-air yaw change over 1s is smaller after 2s of airTime than in the first 0.5s. Run — FAIL.
- [ ] **Step 2:** Implement per above. PASS + full suite green.
- [ ] **Step 3:** Commit — `feat(drop-in): physicsV2 air authority decay + aligned-landing absorption`.

### Task 14: physicsV2 golden fixtures + determinism suite

**Files:**
- Create: `lib/game/core/fixtures/physics-v2/` (captured traces), `lib/game/core/physics-v2-parity.test.ts`
- Modify: the Phase 0 capture harness script (locate via `git log --oneline --all -- '*fixture*'` / `ls scripts/ | grep -i fixture`) to accept `--physics v2`.

**Interfaces:**
- Consumes: `createSimulation` + `stepSimulation` with `simulationConfig(surface, "v2")`; the existing byte-deterministic serializer used by `simulation-parity.test.ts` (reuse, do not re-implement).
- Produces: 8 traces (4 surfaces × 2 scripted input tapes: slalom tape + jump tape, 3600 steps each) committed as fixtures; test replays each and asserts byte equality.

- [ ] **Step 1:** Extend the capture script; generate fixtures; write the replay test (FAIL before fixtures exist, PASS after).
- [ ] **Step 2:** Run the replay test twice back-to-back and once under `node --stack-size=2000` variance check (same bytes). Full `npm test` green.
- [ ] **Step 3:** Commit — `test(drop-in): physicsV2 golden fixtures (byte-deterministic, 4 surfaces x 2 tapes)`.

### Task 15: Runtime/e2e wiring + feel gate

**Files:**
- Modify: `lib/game/runtime/GameRuntime.ts` or its config intake (select model from `ConditionsSnapshot` + dev override `?phys=v2` following the `nopost` pattern), `app/.../drop-in` route conditions plumbing (`buildConditionsSnapshot` already selects surface — add `physicsModel` selection: v2 only when the rollout flag in config says so; default remains v1 until Jared's gate), `tests/e2e/drop-in.spec.ts` (one spec: `?phys=v2` run starts, HUD updates, no crash loop)
- Server: confirm (read, don't rewrite) that run tickets/ghost headers carry config version so the Phase 8 validator can re-sim v2 runs; if the ticket payload lacks a `physicsModel` field, add it to the ticket schema + validator switch in the same commit.

**Steps:**
- [ ] **Step 1:** Failing e2e for `?phys=v2` boot; implement plumbing; PASS both backends.
- [ ] **Step 2:** Full `npm test` + Playwright matrix green; `npm run build` (orchestrator).
- [ ] **Step 3:** Jared feel-check playtest on the preview URL (per-surface: pick a powder/ice day or use the dev override). His sign-off flips the default to v2; until then v1 ships.
- [ ] **Step 4:** Commit + `--no-ff` merge; update `STATUS.md` phase table.

---

## Self-review notes (resolved)

- Spec §2.2 KTX2 "all game textures": inventory shows textures are procedural; Task 7 delivers infra + bake support and records the empty inventory rather than inventing conversions.
- Spec §2.1 sparkle/weather uplift at high rungs: delivered inside Tasks 2 (glint nodes scale with rung via existing `snowUniforms.glint` gating in `applyQuality`) and 5 (bloom at rung≥3) — no separate task needed.
- Type consistency: `SnowNodeUniforms`/`AtmosphereNodeUniforms` keep `.value` fields so `Renderer.render()` lines 147–150 compile unchanged; `RendererBackend.forceContextLoss` optionality is applied in Task 1 and consumed in Task 6's dispose audit.
- Every task ends with the full suite green and its own commit; parity suites are the tripwire in every Phase 12 task.
