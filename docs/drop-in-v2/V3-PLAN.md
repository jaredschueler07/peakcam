# Drop In v3 Implementation Plan

> For agentic workers: use superpowers:subagent-driven-development for bounded implementation and independent review. Checkboxes distinguish implementation from browser acceptance; an unchecked gate is never a shipped claim.

**Goal:** Make the real-mountain v2 game the public Drop In experience, with complete baked trails, physical lift laps, weighty deterministic skiing, trustworthy conditions and verified performance.

**Architecture:** Keep the pure 120 Hz simulation shared by browser and validator. Bake geographic topology and terrain features before rendering them. React owns the shell and runtime lifetime; the existing dual-backend renderer and audio engine own frames.

**Tech Stack:** Next.js 16, TypeScript, three 0.185.1, WebGPU/TSL and WebGL, node:test, Playwright, GDAL and OSM.

**Spec:** [V3-BRIEF.md](V3-BRIEF.md), supplied by Jared on 2026-09-05. Background retained in [BACKGROUND.md](BACKGROUND.md).

## Global constraints

- Fixed 120 Hz; seeded RNG; no DOM/React/three/network in core, physics or terrain.
- Preserve v1 golden traces under phys=v1. PHYSICS_VERSION becomes 2; COURSE_VERSION advances when baked topology or collision changes. Never delete historical scores.
- gameZ = −assetY. Baked far field remains. Terrain pack <3 MB brotli per resort; retain stricter existing asset guard wherever the new pack fits it.
- $0 new tooling/assets, CC0/public domain/already licensed, record provenance. OSM remains ODbL with attribution.
- Real GPU screenshots at 750 ms, 5 s and 30 s; production build; weather=0 luminance guard thresholds unchanged unless measured evidence supports a deliberate rebaseline.
- Mac Mini WebGPU rung 4: 60 fps; phone WebGL rung 1: 30+ fps; heap growth <2 MB/10 s, no frame allocations.
- All work isolated from snowing-now changes in the primary checkout. Integration branch feat/drop-in-v3. Phase branches start from main; merge phase dependencies explicitly; inspect git diff main...HEAD --stat before every --no-ff integration merge.
- Game API routes, .github/workflows and Playwright config are additionally in scope because ranked security and PR CI are explicit rollout requirements. No shared weather or snow-sync edits.

## Phase 0 — baseline and evidence

Files: this plan, V3-BRIEF.md, BACKGROUND.md, SESSION-2026-09-05.md; existing tests.

- [x] Read background, DESIGN, STATUS, TERRAIN-SAMPLING, BUDGETS and P2-GATE-VISUAL-FIXES.
- [x] Create isolated worktree from main; preserve main's unrelated changes.
- [x] Install isolated dependencies; run npm test and npx tsc --noEmit, record pre-existing failures.
- [x] Capture existing browser behavior and determine the available hardware/backend.

Gate: a local production URL and baseline screenshots for all three resorts; no snowing-now checkout mutations.

## Phase 1 — bake the full mountain

Files: scripts/bake-resort.ts, new scripts/bake-mountain-network.ts and tests, lib/game/terrain/{formats,real-heightfield,real-course,resorts}.ts, public/game/terrain/*, config/versions.ts.

- [x] Preserve full named downhill network, stable source IDs, difficulty, width, grooming, top/bottom elevations; keep disjoint pieces separate and order by altitude.
- [x] Preserve lift type, occupancy, source tower coordinates and plausible documented fallback speed; bake junctions, station bounds and forest polygons.
- [x] Reuse committed DEMs for network-only rebakes; cache OSM source and record retrieval/provenance. Validate identity names and pack size on all resorts.
- [x] Bake seed-stable corridor banks/berms and meso geometry for ungroomed blacks, ridgelines, steep rock and tree wells; share sampled geometry with physics and normals. Avoid modifying the legacy procedural terrain.
- [x] Make every usable named run selectable, retaining canonical stable IDs and versioning changed courses.
- [x] Test clipping, source IDs, elevations, widths, repeat-bake hashes and normal/height agreement.

Gate: inspect generated trail map/manifest for Peak 8/Imperial, Gunbarrel/Nevada and Roca Jack/Plateau, then ski intersections and corridor edges in-browser. Document data gaps rather than fabricate OSM coverage.

## Phase 2 — authoritative physics and conditions

Files: lib/game/physics/integrator-core.ts and integrator wrappers/fixtures, config/{physics-rollout,versions}.ts, conditions.ts, server/{sessions,validate-run,courses} modules, competition contract modules and game API routes.

- [x] Main currently lacks September's integrator-core refactor: port only its game seam if reachable, otherwise extract the common integrator while proving v1 parity.
- [x] Ship progressive v2 carve, tuck, counter-steer, landing and surface behavior on that seam. Add golden traces for changed behaviors/surfaces in the same commit.
- [x] Derive ranked surface and environment on the server, never trust a client surface. Time Trial fixes conditions; Daily Line persists the resort morning snapshot and signs it into tickets.
- [x] Quantize powder depth, wind/exposure, morning north-facing ice and visibility; make browser and validator consume identical snapshot values.
- [x] Flip rollout model and PHYSICS_VERSION=2; retain offline v1 override and old board rows. Exercise legitimate and tampered recorded tapes.

Gate: keyboard and touch groomer/powder/ice/tuck/landing comparison plus accepted legitimate ranked run and rejected tampered tape. Live credentials/morning-snapshot migration requiring deployment goes in Needs Jared.

## Phase 3 — lifts, trail identity and readable terrain

Files: core lift state/lifecycle, terrain lift paths, rendering/{WorldRenderer,CameraController,SkierRenderer,LandmarkRenderer,TerrainRenderer}, audio engine, runtime createGame and HUD bridge.

- [x] Implement board/ride/unload state machine for every baked lift; Free Ride proximity boarding, constant plausible cable speed and catenary sag; no teleport lap.
- [x] Draw lift-specific carriers, stations/name signs, real tower spacing; camera follows chair; unload on terrain at top ramp.
- [x] Render groomed banks, difficulty/name signs at junctions, boundary ropes, species-aware trees from forest polygons/treeline, rocks and landmark silhouettes.
- [x] Feed edge angle, speed, landing, surface, wind/exposure, station proximity and sign collision into existing rig/camera/audio.
- [x] Test boarding bounds, reverse line orientation, correct unload, collision and deterministic replay; ski each type on real GPU before acceptance.

Gate: board each lift in each resort, ride continuously to its actual top and ski away. Screenshots include stations, junction, ridgeline and landmark.

## Phase 4 — renderer quality and performance

Files: rendering/{SkyNodeMaterial,SnowNodeMaterial,NodePostProcessing,WeatherRenderer,EffectsRenderer,QualityController,VisualPresets}, runtime/createGame.ts, related tests.

- [x] Replace construction-only rung decisions with reversible governor transitions that shed physical sky/texture sampling when stepping down; handle late texture load and disposal safely.
- [x] Give WebGPU rungs 0/1 antialiasing without restoring scene-pass MSAA incompatible with depth effects.
- [x] Implement groomed corduroy normals, persistent ski-track normal deformation and distinct snow spray/drift; coordinate backend scene identity and time-of-day/alpenglow presets.
- [x] Measure full-scene telemetry and heap guard, use observed bottlenecks to tune streaming/draw calls/LODs, record device/rung/FPS evidence.

Gate: force 4→1→4 transitions, inspect the failing 750 ms view and 5/30 s frames on both backends. Mac Mini and Android performance gates are separate; emulation cannot certify phone GPU performance.

## Phase 5 — shell, rollout and QA

Files: components/drop-in/**, app/resorts/[slug]/drop-in/page.tsx, lib/drop-in.ts, public/drop-in legacy assets, legacy build scripts/tests, .github/workflows, playwright.config.ts, tests/e2e/**, session/status docs.

- [x] HUD shows named run and elevations, lift ride/progress, junction prompt and named conditions on results. Keep modes, tickets, ghosts, leaderboard, keyboard focus and one-line controls.
- [x] Accessibility: labels, touch sizes, keyboard start/pause/results and focus return, reduced-motion shell; progressive pointer lock.
- [x] CI runs unit/type/lint/build and production Playwright on PRs, uploads failure traces; preserve luminance and heap guards.
- [x] Flip route to v2, remove engine selector, delete v1 iframe host/engine and orphan vendor/sync tests without deleting parity fixtures.
- [x] Matrix: all resorts × modes × backends × keyboard/touch; every lift; legitimate/tampered validator cases; weather=0 screenshots at 750 ms, 5 s, 30 s. Mark unavailable external/hardware gates accurately.
- [x] Independent review, fix findings, test merged tree, update STATUS and session log, provide local play URL and evidence.

Gate: no-query Breckenridge is playable within ten seconds, recognizable Peak 8, Imperial return lap, ranked re-simulation, measured desktop/phone target. Do not claim production deployment or hardware sign-off without evidence.

## Local acceptance evidence

Final gameplay build `aed2b3d`: 1,099 unit tests, TypeScript, import fences and
production build pass; 43/43 browser tests and all six unchanged luminance guards
pass. The full 36-case resort/mode/backend/input matrix finishes through actual
keyboard or two-finger touch with no debug mutations. All 72 lifts pass accelerated
boarding/traversal/unload. Real authenticated handler tests accept legitimate v2
and Daily Line tapes and reject tampering, using in-memory dependencies.

All six clear-weather capture sets were inspected at 750 ms, 5 seconds and
30 seconds, plus reversible 4→1→4 quality transitions. Desktop WebGPU rung 4
storm samples meet draw/triangle/texture limits at 9.8–10.0 ms p95; mobile WebGL
rung 1 DPR 2 samples meet draw/triangle limits on the M4. Cold no-query readiness
is 2.78 seconds on the stated 4G profile. The phone GPU/feel gates remain open.
See [V3-QA.md](V3-QA.md) for exact methods, limits and reproducible evidence.
Implementation/local acceptance checkmarks do not represent deployment or Android
sign-off.

## Needs Jared

- Real Android device play/performance gate when none is attached.
- Feel-gate playtest on keyboard and phone when phase is ready.
- Vercel ticket env configuration and Supabase migration/deployment if required; never expose keys in logs.
- Production funnel/fatal-error telemetry after deployment. Source defaults and coverage gaps are documented in the bake provenance.
