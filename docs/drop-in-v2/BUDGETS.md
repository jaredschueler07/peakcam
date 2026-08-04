# Drop In v2 — pinned budgets

These are release gates, not aspirational targets. Desktop figures apply to the
mid-tier desktop/laptop target; mobile figures apply to iPhone-12/Pixel-7-class
devices unless a gate states otherwise.

| Resource | Desktop | Mobile |
|---|---:|---:|
| Draw calls | < 150 | < 80 |
| Triangles | < 400,000 | < 150,000 |
| Texture memory | < 128 MB | < 64 MB |
| KTX2 runtime texture (per asset) | ≤ 512 KB | ≤ 512 KB |
| Basis transcoder (shared, raw transfer) | < 600 KB | < 600 KB |
| Frame time | 16.6 ms | 33.3 ms |
| Post-processing share | ~3 ms | ~4 ms |
| Shadow share | ~3 ms | ~1 ms |

## Rollout gates

- Funnel conversion from `drop_in_opened → drop_in_ready → drop_in_started`
  must meet or exceed v1.
- Fatal error rate must remain below 0.5%.
- p75 frame rate must be at least 55 fps desktop and 30 fps on an
  iPhone-12-class device.
- First-ready must be below 3 seconds on a 4G profile.
- Each resort payload (engine chunk plus terrain pack) must be at most 3.5 MB
  brotli-compressed.
- Each baked resort terrain/trail pack must be at most 1.5 MB brotli-compressed.

## Renderer payload split

The node-material pipeline — `SkyNodeMaterial`, `SnowNodeMaterial`, `AtmosphereNode`,
`ParticleNodeMaterial`, `CsmShadowsNode`, `NodePostProcessing` — sits behind one dynamic
boundary, `lib/game/rendering/nodeFactories.ts`. Every one of those modules reaches
`three/webgpu` (`three/tsl` and `three/addons/csm/CSMShadowNode.js` both re-export from it), so
importing any of them statically put 647 KB of minified WebGPU renderer into the chunk group that
`createGame`'s dynamic import fetches — on every session, WebGL included.

Routing them through `loadNodeFactories()`, which `createGame` awaits only after a WebGPU device
is confirmed, took that eager group from **1510.3 KB to 839.0 KB raw (328.4 KB to 179.8 KB
brotli)**. `nodeFactories.test.ts` enforces the rule the split rests on: outside those modules,
nothing may import `three/webgpu`, `three/tsl`, `CSMShadowNode.js`, or a node-material module at
value level. `import type` is erased and stays free.

**The `postprocessing` package (6.39.4) stays.** It is the WebGL path's whole post chain —
`EffectComposer`, bloom, SMAA, the 3D LUT, vignette and chromatic aberration in
`lib/game/rendering/PostProcessing.ts` — and `NodePostProcessing` replaces it only on WebGPU.
Removing it is a rollout-end task: it becomes dead the moment the WebGL fallback is dropped, and
not one moment sooner. `PostProcessing.ts` is already behind a dynamic import, so it costs a
lazy chunk rather than eager bytes in the meantime.

## KTX2 asset inventory

Task 7 originally found no eligible file textures. Phase 2 Task 4 adds the first
runtime raster pair, sourced from ambientCG Snow006 and baked through the shared
KTX2 boundary:

| Asset | Committed size | Gate |
|---|---:|---:|
| `public/game/textures/snow-normal.ktx2` | 238,614 bytes (233 KB) | ≤ 512 KB |
| `public/game/textures/snow-roughness.ktx2` | 169,834 bytes (166 KB) | ≤ 512 KB |

Both are ETC1S/BasisLZ KTX2 at 1024x1024, resized down from the 2048x2048
ambientCG source and baked with `toktx` (KTX-Software v4.4.2) — the native-
resolution UASTC encode was ~5.6 MB per map, well past the gate; ETC1S plus the
resize brings each comfortably under it. The procedural detail normal remains
the fallback below rung 3 (`SnowNodeMaterial.ts`); baked 16-bit terrain PNGs
remain inspection artifacts and are not runtime textures.

Future runtime raster outputs from `scripts/bake-resort.ts` must pass through its
KTX2 emission boundary, which validates the KTX2 identifier and emits a `.ktx2`
file. The shared Three.js Basis transcoder payload is 584,862 bytes total:
`basis_transcoder.js` is 57,529 bytes and `basis_transcoder.wasm` is 527,333
bytes. These files are served from `/game/basis/` and count once per cached app
version, not once per texture.

Production telemetry emits p50/p95 frame time, final quality rung, DPR, and
device tier once per run. It never emits per-frame samples. The quality ladder
drops post effects, shadow cascades, and glint before reducing pixel scale.

## Phase 2 gate measurement (2026-08-03)

Widest camera (`?cam=wide`), real WebGPU, default (highest) rung, all Phase 2
effects active (GTAO, physical sky, godrays, real snow textures), 60 s
mid-run RAF sampling per resort on the Apple-silicon reference machine:

| resort | p50 | p75 | p95 | max |
|---|---|---|---|---|
| breckenridge | 8.3 ms | 8.5 ms | 10.3 ms | 16.7 ms |
| heavenly | 8.3 ms | 8.5 ms | 10.2 ms | 10.4 ms |
| ski-portillo | 8.3 ms | 8.5 ms | 10.3 ms | 10.4 ms |

p75 sits at the 120 Hz vsync interval — the display, not the renderer, is the
limiter, and the governor's 22.2 ms desktop budget is never approached. Caveat:
this machine cannot exercise the weakest-hardware rungs; the ladder's step-down
behaviour there is covered by the policy unit tests and production telemetry,
not by this measurement. Probe: `.superpowers/sdd/frame-cost.mjs`.
