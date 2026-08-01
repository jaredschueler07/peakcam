# Drop In v2 Phase 4 renderer parity checklist

Reference: `public/drop-in/engine.html` at Three r169. The v2 renderer remains
imperative Three.js; the HUD and minimap remain React/canvas UI outside its scene.

| v1 visual feature | v2 Phase 4 | Parity note |
|---|---|---|
| ACES filmic tone mapping, sRGB output, soft shadows | Ported | Same r169 renderer settings and 1024 px moving sun shadow. |
| Shader sky gradient, sun disc and glow | Ported | Same dome dimensions, shader arithmetic, sun direction and visibility by preset. |
| Seeded two-ring distant mountain silhouettes | Ported | Same radii, segment counts, palette, profile formula and resort seed. |
| 5×5 forward-biased streamed terrain tiles | Ported | Same 200 m tile, 50×50 cells, tile retention/recycling and forward bias. |
| Terrain height and normal sampling | Ported | Uses only `TerrainSampler`; no procedural-terrain assumptions or asset-axis conversion in rendering. |
| Snow/aspect/ice/rock/groomed corduroy vertex colors | Ported | Same constants, thresholds, trail-field weighting and noise frequencies as v1. |
| Resort-profile trees and snow caps | Ported | Same merged low-poly species geometry, profile colors and deterministic core chunk transforms. |
| Snow-capped rocks | Ported | Same merged rock/snow visual and core-provided placement/scale. |
| Chunked instanced prop streaming | Ported | Same 9×9 chunk window and 2,600 tree / 900 rock pools; placement comes only from core `getChunk`. |
| Orange/black trail-edge bamboo | Ported | Same 20 m spacing, corridor edge placement and 460-instance pool. |
| Alternating red/blue slalom gates | Ported | Same spacing/offset/width and passed-gate fade; renderer reads `passedGates`. |
| Ramp rails and banner dressing | Ported | Same trail-relative streaming, dimensions, slope alignment and materials. |
| Lift towers, sheaves and two cable strands | Ported | Same trail offset, 108 m tower spans, streamed pools and cable height. |
| Cable sag | Ported | Same `sin(u·π)·2.2` span curve, unit-tested at tower/midspan/tower. |
| Moving two-way chairs | Ported | Same pool, speed, direction, cable attachment and sway. |
| Lift ride camera | Ported | Dedicated smooth follow/look/FOV path while core `liftRide` is active. |
| Articulated torso/chest/head/helmet/goggles | Ported | Faithful v1 primitive rig and materials. |
| Arms, legs, boots, skis, tips, bindings and poles | Ported | Faithful v1 hierarchy, dimensions, tuck/carve/air pose. |
| Ground-normal alignment and carve lean | Ported | Reads sampler normals and simulation lean/crouch without writing simulation. |
| Crash tumble and ragdoll-ish limb flail | Ported | Tumble quaternion plus independent limb flail. |
| Respawn invulnerability blink | Ported | Visibility blink driven only from `state.invuln`. |
| Powder spray particle pool | Ported | Same 900-slot pool, edge emission, gravity, drag, growth and fade. |
| Snowfall with wind drift | Ported | Same 3,600-slot cap, camera wrapping, preset wind and reduced-motion cap of 320. |
| Persistent ski-track ribbon | Ported | Same 1,600-quad ring buffer, 1.4 m spacing, terrain drape and material. |
| Camera follow, terrain clearance, FOV kick and crash/speed shake | Ported | Same targets/damping/ranges; deterministic oscillation replaces visual-only random jitter. |
| `prefers-reduced-motion` | Ported | Disables camera shake and caps snowfall density. |
| Three resort-local weather presets | Ported | Fog color/density, sky top/horizon/haze, sun/hemi/ambient, exposure, snowfall and wind all switch together. |
| Weather controls `1`–`3` and `L` | Ported | Rising-edge input actions; weather remains renderer-owned. |
| Lift control `G` and touch Lift action | Ported | Routed through the existing core lifecycle command; renderer remains read-only. |
| Adaptive render resolution | Ported | Same 0.55–1.0 scale, 45/58 fps band and −0.12/+0.08 steps. |
| WebGL context loss/restoration | Ported | Prevents default loss teardown, suspends draws, resets renderer state and reapplies size on restore. |
| Full GPU resource disposal | Ported | Unique geometries/materials/textures are disposed once; render lists, renderer and context are released. A fake-backend 10× mount/unmount test audits counts. |
| `drop_in_ready` includes scene construction | Ported | Event remains after awaited `createGame`; renderer scene/resource construction completes synchronously before it resolves. |
| HUD, messages and minimap | Deferred — intentionally out of renderer | Phase 3 React HUD/imperative minimap remain authoritative; no in-canvas text added. |
| Procedural audio | Deferred — Phase 7 | Not a renderer feature; Phase 7 owns audio and audio accessibility. |
| Post-processing, CSM, LUT, bloom, triplanar normals, GPU particles | Deferred — Phase 6 | Explicitly excluded from r169 parity; no post-processing dependency or Three upgrade added. |

The v1 iframe and `public/drop-in/engine.html` are unchanged.
