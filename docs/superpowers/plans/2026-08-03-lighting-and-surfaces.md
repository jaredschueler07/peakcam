# Phase 2 — Lighting & Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the snow depth and the light a source — ambient occlusion, a real sky model, sun shafts, and genuine surface detail — using capability already shipping in our bundle.

**Architecture:** Four independent additions to the existing WebGPU node pipeline, each gated on `backendKind === "webgpu"` with the WebGL path unchanged, and each on its own quality rung so the ladder can shed them. Nothing here changes the simulation, the terrain data, or the near/far fog contract Phase 1 established.

**Tech Stack:** three 0.185.1 first-party TSL nodes (`ao` from `GTAONode`, `godrays` from `GodraysNode`, `SkyMesh`), the existing `NodePostProcessing` chain, the KTX2/Basis pipeline built in P11 Task 7 and never yet fed, ambientCG CC0 textures.

## Global Constraints

- **$0 spend.** Every node used is already in `node_modules/three`; every texture is CC0 from ambientCG. Do not add a dependency.
- three stays at **0.185.1**. Verified present at that version: `three/addons/tsl/display/GTAONode.js` exporting `ao(depthNode, normalNode, camera)`, `GodraysNode.js` exporting `godrays(depthNode, camera, light)`, `three/addons/objects/SkyMesh.js`. **`SSAONode` does not exist at 0.185.1 — GTAO is the AO path.**
- **WebGPU only.** Every addition is gated on `backendKind === "webgpu"`; the WebGL fallback keeps its current appearance exactly. Neither path may import the other's modules at runtime (the bundle split from P11 Task 10a must survive).
- **The fog contract is load-bearing and must not move.** Phase 1 proved bit-identity for everything the streamed tile grid draws. Any change that alters near-field fog is a regression, not a re-baseline. Sky changes are exempt (the sky is not fogged) but must not change the fog *colour* inputs.
- Every effect is **rung-gated** through `QualityController`, and must degrade to today's appearance at rung 0. State the rung for each.
- Zero per-frame allocation (the Task 8 regime governs all of `lib/game/rendering`).
- `npm test` and `npx tsc --noEmit` green after every task. The orchestrator runs Playwright, the build, and every visual round.
- The canvas-luminance guards are per-resort and one-sided (`maxMean`, `minStdev`). AO and godrays move both metrics; a deliberate re-baseline is sanctioned, but each task must state the expected direction so an unintended shift is still detectable.

---

## File structure

| File | Responsibility |
|---|---|
| `lib/game/rendering/NodePostProcessing.ts` (modify) | Insert AO and godrays into the existing chain; own their uniforms and rung gating. |
| `lib/game/rendering/SkyNodeMaterial.ts` (modify) | Replace the hand-authored gradient with `SkyMesh`, keeping the poster palette. |
| `lib/game/rendering/surfaceTextures.ts` (new) | Loads and owns the KTX2 snow normal/roughness set; single place that knows the file names. |
| `lib/game/rendering/SnowNodeMaterial.ts` (modify) | Consume the real normal/roughness maps instead of the procedural DataTexture, at high rungs. |
| `scripts/bake-surface-textures.ts` (new) | Converts source PNGs to KTX2 via the P11 Task 7 pipeline; committed output. |

---

### Task 1: GTAO — ambient occlusion

**Files:**
- Modify: `lib/game/rendering/NodePostProcessing.ts`
- Test: `lib/game/rendering/NodePostProcessing.test.ts`

**Interfaces:**
- Consumes: `ao(depthNode, normalNode, camera)` from `three/addons/tsl/display/GTAONode.js`; the scene pass's depth and normal outputs (the chain already builds a `pass(scene, camera)` — read whether it currently requests MRT normals; if not, add `normal` to the MRT and say so in the report, because that is the non-obvious cost of AO).
- Produces: `postChainPolicy` gains `ao: rung >= 3`, with the AO factor multiplied by a rung uniform exactly as bloom is (compile once, never rebuild the graph).

- [ ] **Step 1: Write the failing test** — extend the policy table test with the `ao` row across all five rungs and the reduced-motion case; assert the graph is the same object identity across a rung change (the existing compile-once assertion pattern).
- [ ] **Step 2: Run** — `npx tsx --test lib/game/rendering/NodePostProcessing.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.** Wire `ao(...)` into the chain **before** the poster LUT — AO is a lighting term and must be graded, not applied on top of the grade. Tune `distanceExponent`, `thickness`, `scale` and sample count for a snow scene: snow is a high-albedo, low-contrast surface, so AO that looks right on architecture will be invisible here; start from three's defaults and say what you changed and why.
- [ ] **Step 4: Run tests** — PASS, then full `npm test`.
- [ ] **Step 5: Commit** — `feat(drop-in): GTAO ambient occlusion at rung 3+`.

**Expected luminance shift:** mean DOWN slightly, stdev UP (AO darkens creases). If mean rises, the effect is inverted.

### Task 2: SkyMesh — a real sky model

**Files:**
- Modify: `lib/game/rendering/SkyNodeMaterial.ts`, `lib/game/rendering/SceneFactory.ts`
- Test: `lib/game/rendering/rendering.test.ts`

**Interfaces:**
- Consumes: `SkyMesh` from `three/addons/objects/SkyMesh.js`, whose uniforms are `turbidity`, `rayleigh`, `mieCoefficient`, `mieDirectionalG`, and a sun position.
- Produces: the same `skyUniforms.uTime` surface the renderer already ticks, so `Renderer.render()` needs no change.

**The hard constraint:** the current sky is a 3-stop gradient whose colours come from each resort's weather preset (`top`, `hor`), and those same colours feed the fog. Replacing the sky must NOT change the fog inputs. Either drive `SkyMesh`'s parameters to approximate each preset's palette, or keep the preset colours as a tint over the physical model — decide, justify, and prove the fog colour uniforms are untouched with a test.

- [ ] **Step 1: Failing test** — sky material is a `SkyMesh` on WebGPU and the legacy `ShaderMaterial` on WebGL; `atmosphereUniforms.blue`/`warm` are byte-identical before and after for all three resorts and all weather presets.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4:** PASS + full suite.
- [ ] **Step 5: Commit** — `feat(drop-in): physical sky model on WebGPU`.

**Rung:** rung 2+; rung 0–1 keep the gradient (SkyMesh is a full-screen shader).

### Task 3: Godrays — sun shafts

**Files:**
- Modify: `lib/game/rendering/NodePostProcessing.ts`
- Test: `lib/game/rendering/NodePostProcessing.test.ts`

**Interfaces:**
- Consumes: `godrays(depthNode, camera, light)`. **It takes a light object**, so the chain needs the CSM's directional light — that light lives in `CsmShadowsNode`/`CsmShadows`. Expose it through a narrow accessor rather than reaching into either class; say which you added.
- Produces: `postChainPolicy` gains `godrays: rung >= 4`.

**Art-direction constraint:** godrays are the single most over-used effect in this genre. The poster look is graphic and restrained. Keep the intensity low enough that shafts read as atmosphere rather than as a lens effect, and gate them so they only appear when the sun is actually near the frame — a shaft with no visible source looks like a bug.

- [ ] **Step 1: Failing test** — policy row across rungs; the light accessor returns the CSM's light on both backends; the effect uniform is zero at rung < 4.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(drop-in): sun shafts at rung 4`.

**Expected luminance shift:** mean UP where the sun is in frame. This is the one effect that can push a resort past its `maxMean` guard — check all three.

### Task 4: Real snow surface textures

**Files:**
- Create: `lib/game/rendering/surfaceTextures.ts`, `scripts/bake-surface-textures.ts`, tests for both
- Modify: `lib/game/rendering/SnowNodeMaterial.ts`

**Interfaces:**
- Produces: `loadSurfaceTextures(loader): Promise<{ snowNormal: THREE.Texture; snowRoughness: THREE.Texture } | null>` — null on any failure, because a missing texture must degrade to today's procedural normal, never break the run.
- Consumes: the `GameTextureLoader` built in P11 Task 7 (`createGameTextureLoader`), which has never had a texture to load.

**Sourcing (do this first, and record it):** ambientCG snow material, CC0. Download the normal and roughness maps only — **discard the albedo**: snow's albedo carries almost no signal and a photographic one will fight the poster palette. Record source URL, licence and download date in the provenance file created in the Phase 0 licence work, and add the asset to `BUDGETS.md` with its size.

- [ ] **Step 1: Failing test** — the bake emits KTX2 (magic-byte check, reusing `emitKtx2Texture`); the loader returns null rather than throwing when the file is absent; the material uses the real normal map at rung 3+ and the procedural one below.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS + suite.
- [ ] **Step 5: Commit** — `feat(drop-in): real snow surface textures via KTX2`.

**Note:** the triplanar sampling in `SnowNodeMaterial` already blends two scales of the procedural normal. Feed the real map through the same path rather than adding a second sampling scheme — one triplanar implementation, not two.

### Task 5: Integration gate (orchestrator)

- [ ] Production build; both e2e projects; heap guard.
- [ ] Screenshots at rungs 0/2/3/4 on all three resorts, both backends, comparing against Phase 1 references: AO visible in creases and around props; sky reads as sky, not a gradient; shafts restrained; snow surface has detail at grazing angles without looking noisy.
- [ ] Re-baseline the per-resort luminance calibration **as a deliberate change**, recording which effects moved which metric.
- [ ] Frame cost at the widest camera on the weakest rung — the governor must not permanently step down.
- [ ] `BUDGETS.md` updated with texture sizes and the new per-rung frame costs.

---

## Self-review notes (resolved)

- Design §4 coverage: GTAO (T1), SkyMesh (T2), godrays (T3), ambientCG through KTX2 (T4). The design also lists `DepthOfFieldNode`/`FilmNode`/`BleachBypass` as available — deliberately **not** in this plan: they are grade choices belonging to Phase 4 (art direction), not lighting.
- Every task states its rung and its expected luminance direction, so the Task 5 re-baseline can attribute each shift rather than accepting a lump change.
- The riskiest interaction is Task 2 versus the fog colour inputs, which is why it carries an explicit byte-identity test rather than a visual check alone.
