# Drop In v2 — Rendering Polish Research

> Produced by a research agent (Claude Opus), 2026-08-01. Versions verified against npm
> that day. NOTE: this report was written against the v1 constraint of a bundler-free
> static engine; the v2 design adopts a bundled TypeScript architecture, which makes the
> "vendoring" caveats moot — but every technique, version pin, and budget below carries over.

## Context corrections (verified against the v1 pilot)

- The v1 pilot is **not unlit**: it already uses MeshStandardMaterial, hemi+directional+ambient lights, ACESFilmicToneMapping, PCFSoftShadowMap, FogExp2, and a two-color gradient sky dome. The cartoony read comes from **no textures, no normal maps, no post-processing, single-cascade shadows**.
- Audio already exists (synthesized WebAudio) and dynamic resolution already exists (pixelScale 0.55–1.0 against a 45/58 FPS band). Weather presets already exist per resort — "time-of-day + weather looks" is an extension of an existing data structure.
- Verified versions: **three 0.185.1** latest; repo pins 0.169.0. **pmndrs postprocessing 6.39.4** latest stable.

## 1. RECOMMENDED STACK

| Decision | Recommendation | Why |
|---|---|---|
| Renderer | WebGLRenderer, three **0.185.1** | WebGPU real but ecosystem-blocked (below) |
| Post lib | pmndrs `postprocessing` **6.39.4** | Merges effects into ONE fragment pass |
| Snow material | MeshStandardMaterial + `onBeforeCompile` | Keeps three's shadow/fog/tonemap chunks |
| Terrain detail | Triplanar noise normal, generated to DataTexture at boot | No download |
| Trails | Ping-ponged WebGLRenderTarget trail map + vertex displacement | §5 |
| Asset formats | glTF + meshopt + KTX2/UASTC where assets are used at all | §7 |
| Shadows | CSM addon: 3 cascades desktop / 1 mobile | §4 |
| Device tiering | Hand-rolled quality ladder, NOT detect-gpu | §9 |

**Critical version fact:** postprocessing@6.39.4 declares `peerDependencies: three ">= 0.168.0 < 0.186.0"` → **three 0.185.x is the ceiling**. The v7 beta line is narrower still (`>= 0.179.0 < 0.184.0`) — not a forward path. Pin `three@0.185.1` + `postprocessing@6.39.4` as a matched pair.

## 2. WebGL2 vs WebGPU — stay on WebGL2

WebGPU crossed the line in 2026 (Safari iOS 26 default-on, Firefox 147, ~70% coverage; WebGPURenderer production-labelled since r171; r184 fixed a major per-frame allocation bug). Still recommend WebGL2 because: (1) pmndrs postprocessing is WebGL-only — WebGPU means rebuilding post on TSL; (2) older-iOS floor means shipping both paths; (3) payload doubling; (4) this scene isn't renderer-bound (instanced, low draw calls). Revisit when postprocessing v7 stabilizes with WebGPU or when >100k GPU particles matter.

If going WebGPU later: TSL effect nodes are in `three/addons/tsl/display/`, NOT `three/tsl` (widely miscopied). Confirmed exports in 0.185.1: bloom, smaa, fxaa, ao (GTAO), dof, film, lut3D, fsr1 (FidelityFX upscale — interesting for mobile), motionBlur, sharpen, godrays, denoise, chromaticAberration, ssaaPass, TRAA, SSR, SSGI, and **SSSNode `sss(depthNode, camera, mainLight)`** — screen-space subsurface scattering, excellent on snow.

## 3. Snow material — the biggest single win

Do NOT write a from-scratch ShaderMaterial (loses shadow/fog/tonemap/light-probe chunks). Use MeshStandardMaterial + `onBeforeCompile` + `customProgramCacheKey`. Four layers, by payoff:

**(a) Triplanar procedural detail normal — first.** Generate at boot into a DataTexture (value noise → sobel → RGB normal; 256², RepeatWrapping). Blend three planar samples weighted by `pow(abs(worldNormal), vec3(4.0))` normalized. Sample at two frequencies (~0.35 and ~3.0 world units), blend by distance (near grain, far clean — doubles as anti-aliasing). Inject after `#include <normal_fragment_maps>`. **~0.3–0.6 ms @1080p.** Removes most of the "flat clay" read.

**(b) View-dependent glint/sparkle.** Noise on a normal map does NOT read as glitter — you need discrete flakes flaring on half-vector alignment. Cheap version: hash **world position** (not screen — sparkle swims) into per-cell random unit vector `f`; `g = pow(max(dot(normalize(f), halfVector), 0.), P)` with P 400–2000; threshold; add white scaled by sun intensity. Two octaves at different cell sizes. Gate by weather (full Bluebird, ~zero Whiteout). **~0.2–0.4 ms.** The most premium cheap effect on snow.

**(c) Fresnel/rim.** `pow(1.0 - saturate(dot(N, V)), 3.0)` tinted toward the weather preset's horizon color. Reads as wind-packed sheen; separates ridgelines from fog. Effectively free.

**(d) SSS approximation.** Wrap-diffuse: `(dot(N,L) + w) / (1 + w)`, w≈0.5, plus back-light `pow(saturate(dot(V, -L)), 4.0)` tinted pale blue-cyan. **Snow's signature: shadowed snow is BLUE (#a8c4e8-ish), not grey** — tint ambient/shadow term instead of darkening neutrally. This one change does more for believability than any texture. Negligible cost.

References: `three-glitter-material` (leannepepper) for onBeforeCompile glint form; UDK I3 Snow Shader R&D writeup for flake-orientation reasoning.

## 4. Lighting, sky, atmosphere

- **Sky:** the gradient dome is right for the poster aesthetic; a physical Preetham sky (Sky.js addon) would fight the palette. Upgrade the dome: 3rd color stop (horizon/mid/zenith), procedural cloud band (two scrolling noise octaves, upper hemisphere mask), softer wider sun halo. Alpenglow = just a preset (warm-magenta horizon, deep-blue zenith, low warm sun, high fresnel).
- **Shadows — where v1 most looks prototype.** CSM addon (`three/addons/csm/CSM.js` + CSMFrustum + CSMHelper + CSMShader; `CSMShadowNode.js` is WebGPU-only — wrong one). Config: `cascades: 3, mode: 'practical', maxFar: ~250, shadowMapSize: 2048, fade: true`; `csm.update()` per frame, `csm.setupMaterial()` per shadow-receiving material. **~1.5–3 ms desktop.** Mobile: 1 cascade, 1024.
- **Height fog / aerial perspective.** FogExp2 alone flattens mountains. Custom injection: `density * exp(-heightFalloff * worldY) * distance`, fog color tinted by view direction (bluer away from sun, warmer toward). Makes ridgelines *stack* like a poster. **~0.1 ms.** Existing per-preset fog/fogCol map straight on.
- **Lights:** hemi/sun/ambient colors must come from the weather preset table (v1 hardcodes warm sunlight even in Whiteout — ten-line fix, large return).

## 5. Snow track deformation — trail render target (recommended)

Downward-looking ortho camera following the rider → ping-pong two WebGLRenderTargets: each frame scroll previous by camera delta, apply slow decay (snow refill), splat rider position. Sample in terrain vertex shader (displace down) and fragment shader (smooth + **kill glint inside the track** — packed snow is smoother and bluer, reads correct immediately). 1024² RG16F over ~60 m ≈ 6 cm texels. **~0.3 ms + vertex fetch.**

Best reference: `Noniv/snowflow_demo` (WebGPU/Babylon, fully procedural; 2048² RGBA16F over 80 m with depth/displaced-mass/compression/ice channels — displaced-mass gives raised berms). Steal the structure, use two channels.

Geometry deformation ties trail resolution to terrain tessellation and makes tile recycling ugly — skip. WebGL2 has no tessellation shaders regardless.

## 6. Post-processing

pmndrs postprocessing over three's EffectComposer: merges N `Effect`s into ONE fullscreen pass vs one pass + RT ping-pong each — several ms of bandwidth on mobile.

Chain (single EffectPass, this order):
1. **Bloom** — `mipmapBlur: true, luminanceThreshold: 0.85, intensity: 0.5`. Restrained: heavy bloom on snow = amateur. ~0.8–1.5 ms.
2. **LUT3D** — 32³ LUT generated from the poster palette. **Highest premium-per-ms; if only one effect, this one.** ~0.2 ms.
3. **Vignette** — offset 0.35, darkness 0.5. ~0.05 ms.
4. **SMAA** (MEDIUM) — prefer over TAA (fast camera + sparkle = TAA smear). ~0.6–1.2 ms. Low tier: FXAA or none.
5. **ChromaticAberration** — radial, subtle, speed-scaled. Sells velocity. ~0.1 ms.

DoF **menus only** (~2–4 ms, fine on a paused frame). Budget: ~2–3 ms desktop, ~4–6 ms mobile; tier-gate bloom + SMAA.

Skip: SSAO/GTAO (high-albedo snow, 2–4 ms for nothing visible), god rays, motion blur (fights crisp poster look).

## 7. Scene dressing at scale

- **LOD within instancing:** three InstancedMesh pools per prop (full / reduced / billboard); move instances between pools on tile load, not per-frame (per-frame LOD switching defeats instancing).
- **Distant forest as billboards** beyond ~150 m: alpha-tested camera-facing quad, ~4 tris. Bake silhouette atlas at boot by rendering the real tree to an RT from 8 angles. Octahedral imposters overkill (camera always behind/above).
- **Per-instance color jitter** via InstancedBufferAttribute — kills the clone-army read, free.
- **Formats:** meshopt (`EXT_meshopt_compression`) over Draco (order-of-magnitude faster decode, ~30 KB WASM vs 200 KB+, compresses all attributes); KTX2/Basis (stays compressed in VRAM; BC7 desktop / ASTC iOS / ETC2 Android; 4–8× texture memory cut). **Trap:** KTX2Loader can pick ETC1 for alpha textures and silently drop alpha — encode alpha as UASTC, not ETC1S.
- Philosophy: prefer procedural (DataTextures, boot-baked atlases, generated LUT) over downloads; reserve authored assets for hero items (rider model). Mobile texture ceiling makes this doubly right.

## 8. Particles and feel

- **Ski spray:** fixed GPU pool, per-particle spawn-time attributes, analytic position in vertex shader (`p = p0 + v0*t + 0.5*g*t²`). No readback, one draw call. Rate/cone from carve angle + speed. 2,000 particles plenty. ~0.3 ms.
- **Falling snow:** one Points cloud parented to camera, positions wrapped modulo a box in vertex shader + wind offset. Infinite snow, zero state. Count/size by weather. ~0.2 ms.
- **Speed lines:** screen-space radial streaks masked to edges, opacity from smoothed speed uniform (beats world-space lines — never intersects terrain).
- **Camera feel — highest feel-per-line-of-code:** FOV ~65→82 across speed range, low-amplitude Perlin rotation shake scaled by speed/surface, slight roll into carves. Critically-damp everything. Drive FOV kick + chromatic aberration + speed lines off the SAME speed uniform.

## 9. Performance

**Tiering: hand-roll, not detect-gpu** (~200 KB DB payload; renderer strings masked in privacy browsers). Extend the existing closed-loop FPS controller into a **quality ladder**: ordered rungs (0: post off, 1 cascade, no glint → 4: full post, 3 cascades, glint, spray); the 45/58 FPS band walks the ladder FIRST and pixelScale LAST (sub-0.7 DPR is more visible than losing bloom). Seed starting rung from hardwareConcurrency / deviceMemory / coarse-pointer / DPR; loop corrects within ~2 s.

| Resource | Desktop mid | Mobile |
|---|---|---|
| Draw calls | < 150 | < 80 |
| Triangles | < 400k | < 150k |
| Texture memory | < 128 MB | **< 64 MB — mobile Safari kills tabs, it does not degrade** |
| Frame budget | 16.6 ms | 33.3 ms |
| Post share | ~3 ms | ~4 ms |
| Shadows share | ~3 ms | ~1 ms |

Instrumentation: Stats.js dev-only. Production: emit p50/p95 frame time + final quality rung + DPR + tier once per run end → PostHog (distribution, never per-frame). `EXT_disjoint_timer_query_webgl2` unavailable in Safari — dev-only.

## 10. Sequencing by visual return per risk

1. three → 0.185.1 (+ postprocessing pair)
2. Blue shadow tint + wrap diffuse + fresnel rim (pure arithmetic, largest single believability jump)
3. Weather-driven light colors (fix hardcoded inconsistency)
4. Post chain: LUT + vignette + restrained bloom
5. Triplanar detail normal
6. FOV kick + camera shake + speed lines
7. CSM shadows
8. Glint/sparkle
9. Spray + falling snow
10. Trail deformation RT
11. Quality ladder + perf telemetry

Steps 2–4 ≈ one day and carry most of the cartoony→premium jump. 10–11 are the expensive ones.

Sources: three.js CSM docs/example · pmndrs/postprocessing · pmndrs/detect-gpu · KTX2Loader docs · Basis Universal KTX2 wiki · WebGPU implementation status · WebGPU in iOS 26 · utsubo WebGPU migration guide · threejsroadmap post-processing guide 2026 · Noniv/snowflow_demo · leannepepper/three-glitter-material · digitaldracott SP_snow.pdf · goeshard.org snow deformation · utsubo 100 three.js tips
