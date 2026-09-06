# Drop In v2 — Build Status

## Current overhaul — 2026-09-05

Drop In v3 is implemented on the isolated `feat/drop-in-v3` integration branch
in `.worktrees/drop-in-v3`, based on `de795d4`. This branch makes the native game
the public default and removes the old iframe engine. A [Vercel preview](https://peakcam-30bdi0pzu-jaredschuelerspotify-3622s-projects.vercel.app/resorts/breckenridge/drop-in) is ready from `67cf51e`; it has **not been deployed to production**.
The primary checkout and its snowing-now changes remain separate.
A follow-up corrects inverted steering across keyboard, touch, mouse and gamepad;
12 actual browser direction checks pass on WebGL/WebGPU.
The HUD also includes a descent meter with percent down and vertical feet left;
desktop and narrow-phone visual/reset checks pass in the development preview.

The full mapped trail catalog, baked terrain detail, physical lift laps, default
physics v2, signed environmental conditions and authoritative input replay are
integrated. Forest assets, sourced lake/hotel silhouettes, snow relief, sensory
feedback, named HUD, focus handling and PR CI are also implemented. Independent
reviews found and fixed contract, licensing, rendering and lifecycle issues.

Local validation passed: **1,099 unit tests, 43 browser tests, 36 full real-input
runs and all 72 lift traversals**. All six unchanged luminance guards pass. Final
GPU samples meet desktop draw/triangle/texture budgets and mobile-emulation
draw/triangle budgets; cold 4G navigation-to-ready is 2.78 seconds. See
[V3-QA.md](V3-QA.md) for measurements and reproduction, and
[SESSION-2026-09-05.md](SESSION-2026-09-05.md) for the implementation record.
Actual Android performance and memory, subjective keyboard/phone feel, and production
migration/configuration remain release gates. The historical sections below describe
earlier releases, not the current branch's default behavior.

> Session logs: `SESSION-2026-08-02.md` (phases 8/11/12 + visual program + security + email).
> Original session log 2026-08-01 (design + phases 0–7 and 9 in one day). Orchestrator: Claude
> (Fable 5) verifying every gate; implementation: Codex gpt-5.6-sol + Claude Opus
> subagents. Read `DESIGN.md` + `PLAN.md` first; this file is the delta.

## Where everything lives

- Integration branch: **`feat/drop-in-v2`** (pushed; every phase merged via --no-ff).
  Base was `feat/drop-in` (the v1 iframe pilot, still unmerged to main, still the
  default engine on the route).
- Local clone `~/projects/peakcam`; worktrees `~/projects/peakcam-wt-p0` (Codex) and
  `~/projects/peakcam-wt-bake` (Opus agents). `.env.local` in all three (copied from the
  old checkout `~/peakcam/peakcam/`, plus generated `DROP_IN_TICKET_KEYS` dev values).
- Playtest (auto-updates on push):
  `https://peakcam-git-feat-drop-in-v2-jaredschuelerspotify-3622s-projects.vercel.app/resorts/ski-portillo/drop-in?engine=v2`
  (also `breckenridge`, `heavenly`; drop the param for v1).

## Done and merged (374/374 unit tests, 9/9 Playwright at session end)

| Phase | Delivered |
|---|---|
| 0+1 | Golden v1 parity fixtures (byte-deterministic capture), RunDefinition contracts, BUDGETS.md, zod config source of truth (`lib/game/config/`) |
| 2 | Pure-TS deterministic 120Hz simulation core (`lib/game/{core,physics,terrain}`) — bit-identical to v1 on all 9 fixture traces + 3,867 terrain samples; eslint import fences |
| 3 | v2 shell behind `?engine=v2` (`DropInClientBoundary`/`DropInGame`), GameRuntime + UiBridge (zustand@15Hz), full input stack (pointer lock = progressive enhancement), React HUD, Playwright suite |
| 4 | Renderer parity at r169 (tiles, articulated skier, props, lift, weather, spray, tracks, adaptive res, context-loss, disposal audit) |
| 5.1 | Terrain bake pipeline (`scripts/bake-resort.ts`) + committed assets (`public/game/terrain/`, ~1.1MB br/resort) + runtime decoders |
| 5.2 | Bicubic real-heightfield sampler + analytic normals + corridor-damped micro-detail (`real-heightfield.ts`); coordinate convention **gameZ = −assetY** (TERRAIN-SAMPLING.md) |
| 5.3 | Real mountains in-game: asset loading (brotli via headers), 6 curated real OSM runs/resort, real lift lines, landmarks (Laguna del Inca, hotel, Tahoe, town glow), spawn grade-trimming, minimap polylines. **Took 2 orchestrator visual fix rounds** (floating landmarks = visibility tied to streamed terrain windows; obstacles on ungroomed curated runs; oversized hotel clipping viewport) |
| 6 | three **0.185.1 + postprocessing 6.39.4** (matched pair, ceiling <0.186), snow material stack (wrap-diffuse/blue shadows/rim/glint/triplanar), poster LUT post chain (CA in its own pass — convolution can't merge), CSM, 3-stop sky + cloud band, player-relative height fog (**absolute-Y fog saturates at real 3km altitudes — the big washout bug**), 5-rung quality ladder, perf telemetry. e2e canvas-luminance guard (mean<190, stdev>28) |
| 7.1–7.3 | Audio engine (v1 synthesis ported + surface-aware layers), 10 CC0 samples (archive.org Designer's Choice UCS, 1.2MB, CREDITS.md), runtime wiring (init on Start, samples never gate first frame), HUD mute toggle |
| 8 (backend) | Migration **015_drop_in_runs APPLIED to Supabase prod** (empty, RLS select-only), PCGH ghost codec, HMAC run tickets, nickname sanitizer, all 4 API routes (`/api/drop-in/{sessions,runs,leaderboard,ghosts/[runId]}`) with baseline anti-cheat validation |
| 9 | Live conditions: `buildConditionsSnapshot` (DESIGN 3.6 table), server-fetched in route (ISR 3600), POWDER DAY poster stamp (verified live — Portillo had a real 8" day today), surface physics enum in sim config ('packed' = parity-neutral) |
| — | prod hotfix cherry-picked to main: forecast snow bucket rounding (0.8999999999999999" render) |

## Remaining work (in PLAN.md order)

> Sessions 2026-08-01/02 (multi-fleet: Claude Opus 5 + Codex gpt-5.6-sol + Grok
> implementing, Fable 5 orchestrating; ~20 SDD tasks, every one through
> independent review + fix loops, final whole-branch review APPROVED):
> **Phases 8, 11 (code), and 12 (code) are COMPLETE and merged** at 616/616
> unit, 21/21 + 17/17 dual-backend e2e, recorder→validator joint smoke green.
> - **Phase 8**: full competition loop live behind the route — recorder, ghost
>   racing, Time Trial / Daily Line tickets (HMAC, seed+surface+physicsModel
>   claims, layered fail-closed guards), submission/leaderboard panels,
>   re-sim validator behind `DROP_IN_RESIM`, analytics taxonomy.
> - **Phase 11**: WebGPU is the default renderer where available (three r185
>   WebGPURenderer + TSL node materials: snow/fog/CSM/post/sky/particles);
>   WebGL fallback preserved byte-equivalent; bundle split keeps three/webgpu
>   (647KB) off WebGL sessions (eager 1510→839KB); shader prewarm; thermal
>   governor (ring-buffered, 60Hz-recoverable); KTX2 infra; heap guard e2e
>   (<2MB/10s). Five orchestrator browser rounds fixed: LUT colour space,
>   WGSL sin() NaN at 3km coords, CSM negative-light fade + ×N intensity,
>   WebGPU point-list particles (instanced quads). SwiftShader-black reality:
>   e2e default project pins gfx=webgl; `PLAYWRIGHT_WEBGPU=1 --headed` runs
>   the hardware project.
> - **Phase 12**: physicsV2 (carve/air/landing/surface) merged flag-off,
>   parity-proven, golden-fixtured; `?phys=v2` override runs are unsubmittable
>   by three layers (server 400 while rollout off + entry/restart/remint
>   config guards). NOTE for playtest: an override run shows the generic
>   "played offline" notice — that is correct behaviour, not a server bug.
> - Dev levers (deliberately live in prod, render-only): `?gfx`, `?nopost`,
>   `?snowdbg`, `?csmdbg`, `?treedbg`, `?e2ecanvas`, `?e2espawn`, `?phys`.
> - Ledgers with the full deferred/parked backlog: `.superpowers/sdd/*/progress.md`.

> **Visual program Phase 1 COMPLETE (2026-08-02)** — see `VISUALS-DESIGN.md` and
> `docs/superpowers/plans/2026-08-02-far-field-and-dem.md`. 718 tests green.
> - **Real DEM per resort**: Breckenridge USGS 3DEP **1 m lidar**, Heavenly 3DEP
>   **seamless 10 m** (no 1 m project covers the ski area — both candidates return
>   nodata at its coordinates, verified with `gdallocationinfo`), Portillo Copernicus
>   GLO-30 (nothing better exists free in the Andes). GDAL warps each resort to its own
>   UTM zone. **`COURSE_VERSION` bumped to 2**; course gates regenerated from the bake,
>   not hand-edited. Leaderboards were empty, which is why this landed pre-launch.
> - **Real 30 km horizon**: pre-baked radially-graded wedge mesh (~265 KB br/resort,
>   ~14 k verts drawn) replaces the two procedural ridge bands. Aconcagua renders as real
>   geometry at Portillo (6854 m, 24 km, +9.6°). Ridge bands retained as fallback.
> - **Fog curve unified**: there were FOUR hand-written copies (TSL, CPU reference, the
>   WebGL GLSL string, `heightFogAmount`) with only two pinned. One definition now emits
>   all three; the WebGL shader is generated and its test executes the emitted source.
>   A long-range envelope (identity below the tile grid's derived reach) stops fog
>   saturating before the far field begins. Storm presets bit-identical.
> - Caveat worth knowing: the bit-identity guarantee covers the **tile grid only**.
>   Lift towers, cable and trail markers sit beyond it and are intentionally affected.
> - Tooling/licences: $0 spend. See `.superpowers/sdd/research/` for the three research
>   reports (rendering libs, assets/licensing, terrain data) behind these choices.
>
> **Next**: Phase 2 (lighting/surfaces — GTAO, SkyMesh, godrays are already in our
> bundle, unused), then density, then art direction.
>
> **Visual program Phase 2 COMPLETE (2026-08-04) — and everything MERGED TO
> MAIN (90008a5).** Drop In v2 is on production, DORMANT behind `?engine=v2`
> (default route still serves the v1 iframe; public flip is Phase 10). GTAO,
> physical sky, godrays, real KTX2 snow textures; three real-GPU fix rounds
> (see `P2-GATE-VISUAL-FIXES.md` — bloom blend inverted HDR, GTAO
> depth-precision banding, tone-map ordering); luminance guards re-baselined
> per-backend and weather-pinned (`?weather=`). Full story:
> `SESSION-2026-08-04.md`. NEW PHASE 10 BLOCKERS from the final review:
> (1) rung captured at construction — governor cannot shed SkyMesh/textures on
> thermal step-DOWN; (2) rungs 0/1 on WebGPU have no AA (samples:0 removed
> inherited MSAA; `aa` starts at rung 2).

1. **Phase 10b (rollout)** — CI pipeline, device matrix beyond this Mac Mini,
   accessibility pass, percentage rollout per DESIGN §5, delete v1, soft-404 fix.
   BACKLOG (from final review, in ledgers): S1 server-side surface derivation
   (client-chosen surface affects v1 boards — ROLLOUT GATE); PHYSICS_VERSION→2
   before v2 default flips; governor limit-cycle latch; tail-ramp banner/rail
   cosmetics; eslint-ignore vendored basis; [gate]-mock rollout-model assert;
   e2e sessions-mock tickHz 10→30; override-run poster copy; NodePostProcessing
   disposal audit gap; conditionSurface narrative-scan design (regex precedence
   FIXED; design question remains).
2. **Needs Jared (playtest prerequisites)**: `DROP_IN_TICKET_KEYS` in the Vercel
   **preview** env (playtest URL) AND production (`npx vercel env add
   DROP_IN_TICKET_KEYS preview` / `production`, value `k1:<openssl rand -base64 32>`
   — without it competitive runs silently degrade to offline); then the
   fall-line + physicsV2 feel playtest (`?phys=v2`) and sign-off.

## Operating lessons (read before dispatching agents)

- **Codex sandbox**: no network (next build fails on Google Fonts — orchestrator runs
  build), can't git-commit in shared worktrees (orchestrator commits), can't bind ports
  (orchestrator runs Playwright). Run via `nohup codex exec … &` — the Bash tool's 10-min
  ceiling killed one run. `codex exec resume` needs `--sandbox` BEFORE `resume`.
- **Sandboxed agents cannot see rendering bugs.** Unit tests passed while the hotel
  floated in the sky and the whole scene washed out. The loop that works: agent
  implements → orchestrator plays it in a real browser (Playwright probe scripts +
  screenshots) → precise defect brief → fix round. Budget 1–2 fix rounds per visual phase.
- e2e runs against a **production build** (`next start` on :3100); the dev server wedged
  once after `.next` was deleted underneath it. `/_vercel/*` 404s are environmental noise
  locally (filtered in the unmount test).
- Playwright + Enter-to-start: hydration races; the spec polls Enter until the shell
  reacts.
