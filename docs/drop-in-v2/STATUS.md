# Drop In v2 — Build Status

> Session log 2026-08-01 (design + phases 0–7 and 9 in one day). Orchestrator: Claude
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

1. **Phase 8.3/8.4** — ghost recorder wired into the runtime, Time Trial + Daily Line
   mode selection UI, results submission + leaderboard/ghost panels, server
   re-simulation validator enabled before Daily Line marketing. Note handoffs: courses
   need real startZ/finishZ (validator's `startFinishChecked:false`), and
   `RuntimeAudio`/`UiBridge` event streams are the integration points.
2. **Phase 10** — device-matrix perf validation (budgets in BUDGETS.md), full CI,
   accessibility pass, percentage rollout per DESIGN §5 gates, delete v1
   (engine.html/vendored three/sync script/drift test/CORS header), fix the
   **pre-existing site-wide soft-404** (notFound() streams HTTP 200 — confirmed on prod,
   documented in tests/e2e/drop-in.spec.ts).
3. **Needs Jared**: `DROP_IN_TICKET_KEYS` in Vercel prod env
   (`npx vercel env add DROP_IN_TICKET_KEYS production`, value `k1:<openssl rand -base64 32>`);
   fall-line playtest sign-off per resort (Phase 5 gate).

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
