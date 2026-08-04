# Drop In v2 — Implementation Plan

> Companion to `DESIGN.md`. Phases are sequential; each lands behind the engine flag,
> is independently shippable, and ends with explicit acceptance gates. Base branch:
> `feat/drop-in` (the v1 pilot — it owns the route and entry points). Work branches:
> `feat/drop-in-v2-p<N>-<name>`, PR'd into a long-lived `feat/drop-in-v2` integration
> branch. Sub-task agents: implementation → Codex (gpt-5.6-sol) or Opus; review →
> the other model reviews each phase (cross-model review, alternating).

Effort key: S = ≤half day · M = 1–2 days · L = 3–5 days.

---

## Phase 0 — Contracts & parity capture (M)

The migration's insurance policy. No behavior changes.

1. Capture golden fixtures from the v1 engine: terrain height/normal samples per
   resort (grid + random), three scripted input traces with expected periodic state
   hashes, final time/score. Store under `tests/fixtures/drop-in-v1/`.
2. Write the competitive run contracts (`RunDefinition`: time_trial | score_attack,
   trail, seed, startZ/finishZ, versions) as types + doc.
3. Pin budgets in `docs/drop-in-v2/BUDGETS.md` (from DESIGN §5 gates).
4. Add `zustand@5.0.14`, `zod@4.4.3`, `@playwright/test@1.61.1`; `three` moves
   devDependencies → dependencies at 0.169.0; `@types/three@0.169.0`.
5. Fix stale `next.config.ts` comment re: sandboxing (Codex finding #8).

**Gate:** fixtures replay green against v1 twice (determinism of the capture itself).

## Phase 1 — Single source of truth (S)

1. `lib/game/config/`: zod schema + typed profiles absorbing everything from both v1
   copies (lib/drop-in.ts PROFILES + engine RESORT_PROFILES: fall, relief, trails,
   forest, weather, accents).
2. `lib/drop-in.ts` becomes re-exports; the engine-drift test
   (`scripts/drop-in-engine.test.ts`) now checks engine-vs-config until the iframe dies.

**Gate:** `npm test` green; no site-visible change.

## Phase 2 — Deterministic core extraction (L) ★ the keystone

1. Port to pure TS under `lib/game/core|physics|terrain`: math, mulberry32 RNG, fbm,
   trail field, terrainHeight/Normal, obstacles, the full physics step (carve friction,
   slope gravity, anti-stall, jump/air/landing/crash, lift ride), scoring, fixed clock.
   Plain `{x,y,z}` vectors + module-local scratch (no THREE, no allocations in step).
2. `createSimulation(config, seed)` / `stepSimulation(state, input, dt, world)` /
   `resetSimulation` API; typed events out.
3. Golden fixtures from Phase 0 must replay bit-identical (hash-compare).
4. Determinism suite: 10k steps × 3 frame-pacing patterns → identical hashes.

**Gate:** parity fixtures green; determinism suite green; zero DOM/three imports
(lint rule: `no-restricted-imports` on `lib/game/{core,physics,terrain,replay}/**`).

## Phase 3 — Shell, runtime, input (L)

1. `DropInClientBoundary` / `DropInGame` (React shell, poster start screen on pc-*
   tokens) / `GameRuntime` (RAF owner, accumulator, disposal contract) / `UiBridge`
   (zustand vanilla store @ 15 Hz + typed events).
2. `InputManager` + adapters: Keyboard, PointerDrag (pointer capture, no lock),
   PointerLock (progressive enhancement per DESIGN §3.1), Touch (thumb steer zone +
   action buttons), Gamepad (standard mapping), Tilt (opt-in, permission + calibrate).
   Rising-edge action detection; dead zone 0.12; blur/visibility clears held input.
3. Minimal renderer: v1 terrain tiles + camera + flat-shaded skier, enough to play.
4. React HUD (speed/time/vert/alt/score/combo/trail) + imperative minimap canvas +
   pause/results dialogs. Route still serves the iframe by default; `?engine=v2` serves
   this.

**Gate:** keyboard-only playable start-to-crash-to-restart; pointer-lock-denied path
plays fine; Playwright smoke (route, start, no-iframe, unmount-clean) green.

## Phase 4 — Renderer parity at r169 (L)

Port in risk order: terrain tiles/camera → skier (articulated limbs, carve lean) →
props + collision parity → gates/markers/ramps/lift → weather presets, spray, snowfall,
tracks, adaptive resolution → context-loss recovery + full disposal audit.

**Gate:** side-by-side v1-vs-v2 feature checklist 100%; golden fixtures still green
(renderer cadence cannot affect sim); disposal test: mount/unmount 10× leaks nothing
(heap + WebGL resource counts).

## Phase 5 — Real terrain (L)

1. `scripts/bake-resort.ts` productionizing the prototype (`docs/drop-in-v2/research/
   prototype/`): terrarium z14 (+ Copernicus COG path for Portillo), 260×260 seam-safe
   sampling, tile prefetch, 1024² @ 0.1 m quantum → `.u16` + meta JSON + PNG16 artifact;
   Overpass GET fetch → RDP 6 m → delta JSON; brotli precompress; `validate-game-assets`
   checks decode round-trip + bounds.
2. `heightfield.ts`: bicubic sampler + analytic normals over the u16 grid; micro-detail
   fbm layer (seeded, < DEM-cell wavelengths, trail-corridor damping); swap into the
   shared height function.
3. Trail system v2: real centerlines replace sine-generated corridors; run selection UI
   (6 curated runs per resort from the real inventory — chosen for sustained fall line
   via OpenSkiMap elevation profiles); gates/ramps/obstacles placed relative to real
   corridors; lift follows the real lift line.
4. Landmarks: low-poly hero silhouettes (hotel, lake plane + shore, ridgelines from the
   DEM edge data, town glow billboard); per-resort skyline.
5. Credits panel + assets LICENSE (attribution strings from DESIGN §3.3).

**Gate:** all three resorts bake reproducibly (`--verify` re-bake hash-stable);
per-resort pack ≤ 1.5 MB brotli; fall-line playtest sign-off per resort (Jared);
determinism suite green on real heightfields.

## Phase 6 — Visual polish (L)

First commit: three 0.169 → **0.185.1** + `postprocessing@6.39.4` (the matched pair),
own visual/perf check. Then, in the rendering report's payoff order:
blue-shadow/wrap-diffuse/rim arithmetic → weather-driven light colors → post chain
(LUT from poster palette, vignette, restrained bloom) → triplanar detail normal →
FOV/shake/speed-lines feel pass → CSM → glint → GPU spray/snowfall upgrade → trail
deformation RT → quality ladder + perf telemetry postMessage→PostHog.

**Gate:** budgets hold on the device matrix (M1 Air, mid Windows laptop, iPhone 12,
Pixel 7 class); ladder degrades gracefully rung-by-rung; before/after capture reel for
each resort (marketing asset + regression reference).

## Phase 7 — Audio & mobile polish (M)

1. Sample-based audio layers over the procedural graph (DESIGN §3.5); loaded
   post-gesture; volume/mute persisted; `prefers-reduced-motion` respected end-to-end.
2. Touch ergonomics pass on real devices; safe-area insets; haptics (vibrate on land/
   crash where supported); PWA-ish meta (orientation hint, theme color).

**Gate:** WebKit Playwright smoke green; touch playtest sign-off; audio never blocks
start (progressive load).

## Phase 8 — Competition: modes, leaderboards, ghosts, Daily Line (L)

1. Migration 012 `drop_in_runs` (Codex schema, DESIGN §3.7) — applied via MCP per house
   process; RLS: public SELECT accepted-only, own-rejected readable, no client writes.
2. Route Handlers: `sessions` (HMAC ticket: nonce/seed/versions/expiry/uid),
   `runs` (verify → baseline validation → insert), `leaderboard` (cached read),
   `ghosts/[runId]`. Body limit 128 KB; per-IP+user rate limits.
3. Replay recorder + PCGH binary codec (round-trip tested, corrupted-input rejected);
   ghost renderer (interpolated, translucent poster-ink rider).
4. Time Trial + Daily Line UIs; results/leaderboard panels; anonymous-run nickname flow,
   auth "claim score" upsell.
5. Server re-simulation validator (same pure core) behind a flag; enable before Daily
   Line marketing push.
6. PostHog taxonomy (DESIGN §3.8) wired end-to-end.

**Gate:** validator accepts 100% of honest fixture runs, rejects all tampered fixtures
(time edit, teleport, speed hack, replayed nonce); leaderboard query p95 < 150 ms;
E2E: play → submit → appear on board.

## Phase 9 — Live conditions integration (M)

`ConditionsSnapshot` builder in the route (reads the same tables as the site);
surface-physics enum + weather default + start-card stamps; powder-line bonus zones;
Daily Line locks to morning snapshot server-side (in the ticket). Offseason fallback.

**Gate:** snapshot unit tests across data states (powder/icy/no-data/offseason);
run comparability — same course_version ⇒ same physics inputs, verified in validator.

## Phase 10 — Hardening & rollout (M)

Full Playwright matrix + CI pipeline (`lint → test → build → e2e`) · load-test the run
endpoints · error taxonomy + fatal-error reporting · accessibility audit (HUD contrast
on pc tokens, focus order, reduced-motion, screen-reader route fallback kept) ·
percentage rollout per DESIGN §5 with funnel comparison dashboards · at 100%: delete
engine.html, vendored three, sync-three script, drift test, CORS header · postmortem +
`docs/drop-in-v2/LESSONS.md`.

**Gate:** DESIGN §5 promotion gates all green for 7 consecutive days at 100%.

---

## Sequencing notes

- Phases 0–2 are pure-code and can overlap Phase 5's bake-script work (different files;
  good parallel split between two implementation agents).
- Phase 6 must follow 5 (shaders depend on final terrain normals/corridors).
- Phase 8 depends on 2 (validator reuses the core) but its DB/API scaffolding can start
  any time after 0.
- Nothing merges to `main` until the Phase 10 rollout begins; the site keeps shipping v1
  from `feat/drop-in` if that branch is merged independently (decision deferred — v1
  merge is optional since v2 replaces it behind the same route).

## Rough effort envelope

0:M · 1:S · 2:L · 3:L · 4:L · 5:L · 6:L · 7:M · 8:L · 9:M · 10:M — roughly 6–8 weeks of
focused agent-driven implementation with cross-model review, compressible by running
the parallel tracks above.
