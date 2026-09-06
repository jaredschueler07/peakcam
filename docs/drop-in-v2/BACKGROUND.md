# Drop In — Full Background

> What was built, how it was built, and why. Written 2026-09-05 for anyone (human or
> agent) who opens this repo cold. This is the narrative; the per-phase detail lives in
> the files it links to. Start here, then read `DESIGN.md` and `STATUS.md`.

---

## 1. What Drop In is

Drop In is an arcade ski-descent game embedded in PeakCam (peakcam.io), a snow-report and
webcam site covering ~148 ski resorts. On a pilot resort's page (Portillo, Breckenridge,
Heavenly) a **Drop In** call-to-action opens `/resorts/[slug]/drop-in`, a full-bleed route
where you ski a stylized version of *that* mountain.

The one-sentence thesis, from `DESIGN.md`:

> The game is a marketing surface for the data product, and the data product makes the
> game different every day. That loop is the whole point.

Concretely: PeakCam's live snow data (depth, 24h snowfall, condition rating, NWS
weather) picks the game's weather preset, tunes the snow-surface physics, and stamps a
POWDER DAY badge on the start card when the resort really got snow. A powder day in real
life is a powder day in the game.

### Why it exists

Jared's stated direction (recorded in `DESIGN.md`, 2026-08-01): **arcade physics + real
resort identity + live-conditions integration, production/enterprise grade.** Not
photoreal; the reference tier is *Alto's Odyssey* / *Lonely Mountains: Downhill* craft,
wearing PeakCam's retro ski-poster visual identity. The game is meant to be the thing
that makes a snow-report site memorable and shareable, and the daily-changing conditions
are what give people a reason to come back.

Explicit non-goals for v2: multiplayer, terrain park/rails, character customization,
more than three resorts (though every per-resort input is data, so a fourth resort is
"a bake away"), photorealism, native apps.

---

## 2. Timeline at a glance

| Date | Milestone | Where the record is |
|---|---|---|
| 2026-07-27 | **v1 pilot** built: single-file `engine.html`, procedural terrain, three resorts, iframe host. 36-agent review → 24 defects → fixed same day. | commits `e8a0911`, `d0c36a8`, `d1f495b`, `8d71f54` on `feat/drop-in` |
| 2026-08-01 | **v2 design + plan** written; research reports (terrain, rendering, architecture); Phases 0–7 and 9 built in one day by a multi-model fleet. | `DESIGN.md`, `PLAN.md`, `research/`, commit `643c128` |
| 2026-08-01/02 | Phases 8 (competition), 11 (WebGPU), 12 (physicsV2) complete. Visual Program Phase 1 (real DEMs, 30 km horizon, unified fog). Security audit, email fix. | `SESSION-2026-08-02.md`, `P8-COMPLETION-PLAN.md`, `P11-P12-PLAN.md` |
| 2026-08-03/04 | Visual Program Phase 2 (GTAO, physical sky, godrays, real snow textures). Production incident (shared Supabase disk full). **`feat/drop-in-v2` merged to `main` (90008a5)**, dormant behind `?engine=v2`. | `SESSION-2026-08-04.md`, `P2-GATE-VISUAL-FIXES.md` |
| 2026-08-11 | `/drop-in` hub page, nav link, sitemap entry; real-but-unbuilt resorts get a "no descent built yet" page instead of 404. | commit `d9a0c89` |
| 2026-08-13–19 | Site trailer work (Hermes/ElevenLabs orchestration) references the game; no engine changes. | Claude Code session `1227339a…` |
| 2026-09-02 | Refactor audit: five correctness bugs fixed, then high-payoff dedup (single integrator core with a `CarveModel` seam, shared server validation, generated engine.html profile block). | commits `15056af`, `daac3f5` on `refactor/high-payoff` (PR open) |
| 2026-09-04 | Site-wide UI/UX fix pass; Drop In section documented in the brief. | Claude Code session `6bc0a942…` |

**Current state (2026-09-05):** v2 is fully on `main` and on production, but the public
route still serves the **v1 iframe by default**. v2 renders only with `?engine=v2`.
The public flip is Phase 10 and is gated on the blockers in §7.

---

## 3. v1 — the pilot (2026-07-27)

### What
A self-contained real-time 3D arcade descent in one 2,430-line file,
`public/drop-in/engine.html`, wired into the map: clicking a pilot resort's popup
(desktop) or bottom sheet (mobile) offers "Drop In".

### How
- One shared **analytic heightfield** drives the mesh, the physics, prop placement and
  the minimap identically — so the ground you see is the ground you ski.
- 5×5 streamed 200 m terrain tiles; 2,600 instanced trees + 900 rocks streamed by 120 m
  chunks from a hash-seeded RNG that doubles as the collision set.
- Chairlift with catenary sag, three particle systems, synthesized WebAudio, custom
  sky-dome shader, three.js r169.
- `lib/drop-in.ts` holds a hand-maintained pilot flag and per-resort profiles. Kept as a
  module rather than a DB column on purpose: three resorts don't justify a migration.
- Route prerendered for the three slugs, `noindex`.

### Why it was built this way
Speed. It was a Codex-orchestrated one-day build to prove the concept and get a preview
deploy in front of Jared. The commit message is explicit that it was "committed as-built
… this one is the checkpoint."

### What the review found
A 36-agent review confirmed 24 defects: keyboard-inoperable start (a bare `<div>` bound
only to click/touch), an unsandboxed same-origin iframe loading three.js from a CDN (a
path from third-party code to PeakCam's non-httpOnly Supabase auth cookie), no WebGL
fallback, HUD overlap on every common phone width, and an anti-stall term that let the
skier climb uphill forever. All fixed in `d0c36a8`: three.js vendored and pinned,
iframe sandboxed without `allow-same-origin`, WebGL construction wrapped, HUD scaled
below 480 px, touch controls completed. Two follow-ups (`d1f495b`, `8d71f54`) fixed CORS
and loading behind an auth wall.

### What v1 got right (and v2 kept)
The **physics feel**: anisotropic carve friction, slope-projected gravity, natural air
off convex lips. `DESIGN.md` pillar 1 says it "ports intact. It already feels right."
That decision drove the whole Phase 0–2 parity discipline described below.

---

## 4. v2 — the design (2026-08-01)

### Why a v2 at all
v1 proved the idea but was a prototype: procedural terrain that only *looked* like the
resort, an iframe trust boundary, no deterministic core (so no honest leaderboards), no
live-data loop, and no path to premium visuals. The design brief named the target as
"enterprise-grade": deterministic TypeScript simulation, tests and golden fixtures, perf
budgets with device tiers, telemetry, server-validated leaderboards, CI.

### How the design was produced
Claude (Fable 5) as design lead / orchestrator; two Claude Opus research agents (terrain
data, rendering libraries) and Codex `gpt-5.6-sol` (architecture). The three reports are
in `research/`. Conflicts between reports were resolved explicitly in `DESIGN.md` §3.2 —
e.g. "stay on three r169 during migration parity" (Codex) vs "pin three 0.185 +
postprocessing" (rendering): resolved as *parity first at r169, then upgrade in one
phase with the luminance guard as the regression test.*

### The pillars
1. **Real mountains, arcade heart** — terrain baked from real DEMs; trails routed where
   the real runs go; each resort's landmark on the horizon (Portillo: yellow hotel +
   Laguna del Inca; Breckenridge: Tenmile ridgeline + town glow; Heavenly: Lake Tahoe
   filling the view). v1 physics ported intact.
2. **Ski today's mountain** — live PeakCam data selects weather, tunes surface physics,
   badges the start card.
3. **Premium stylized, not photoreal** — real lighting, post, atmosphere, sound, inside
   the poster palette.
4. **Enterprise-grade build.**

### Modes
| Mode | What | Leaderboard |
|---|---|---|
| Free Ride | v1's endless descent, polished. Weather cycling, lift laps, trick scoring. | No (personal best) |
| Time Trial | One named real run, fixed seed/weather, gated start→finish. | Per resort × trail |
| Daily Line | One shared daily challenge; server-issued seed + course; weather locked to that resort's real morning conditions; one ranked score per user per day. | Global, resets daily |

Time Trial and Daily Line are versioned run contracts (`physics_version`,
`course_version`) — the prerequisite for any leaderboard being honest.

### Architecture decisions (the "how" that everything else depends on)
- **The iframe dies; the simulation core is the trust boundary.** Server Component
  route → `DropInClientBoundary` (`ssr:false`) → `DropInGame` (poster shell, React HUD)
  → on Start, dynamic-import `lib/game/runtime/createGame`. Two-level code split: the
  main site never loads game code; the route loads a small shell; the engine loads on
  intent.
- **`lib/game/{core,physics,terrain}` are pure TypeScript** — no React, DOM, three.js or
  network. Fixed-step 120 Hz, `InputFrame`-driven, seeded RNG, deterministic. The same
  code runs in the browser, in `node:test`, and in the server-side run validator. This is
  what makes ghost racing, re-simulation anti-cheat and golden fixtures possible.
- **React owns the runtime's lifetime, never its frames.** HUD reads a Zustand vanilla
  store updated at 10–20 Hz by a `UiBridge`; discrete events go through a typed emitter.
- **Pointer lock is a progressive enhancement**, never a gate — retiring v1's
  `WrongDocumentError` class of failure.
- **Zod config is the single source of truth** (`lib/game/config/`); `engine.html`'s
  profile block is now *generated* from it (`scripts/drop-in-sync-profiles.ts`) and a
  test fails if it drifts.

---

## 5. v2 — the build (2026-08-01 → 08-04)

### How the work was run
A multi-model fleet with one orchestrator. Claude Fable 5 orchestrated and verified
every gate; Claude Opus 5 / Sonnet subagents, Codex `gpt-5.6-sol`, and Grok implemented.
Every task went **implement → independent review (spec compliance + code quality) → fix
loop → merge**, with a whole-branch review at the end of each phase. Work happened in
git worktrees (`~/projects/peakcam-wt-*`) per agent; each phase merged `--no-ff` into
`feat/drop-in-v2`. Per-task ledgers lived under `.superpowers/sdd/`.

The single most important operating lesson, repeated in every session log:
**sandboxed agents cannot see rendering bugs, and neither can unit tests.** The loop
that actually worked was agent implements → orchestrator plays it in a real browser
(Playwright probe scripts + screenshots on the Mac Mini's GPU) → precise defect brief →
fix round. Visual phases were budgeted 1–2 fix rounds; Phase 11 took five.

### Phase by phase (what and why)

**Phase 0+1 — Contracts & parity capture.** Golden v1 fixtures captured
byte-deterministically (9 input traces + 3,867 terrain samples), `RunDefinition`
contracts, `BUDGETS.md`, zod config. *Why:* you cannot refactor a feel you can't
measure. Every later physics/terrain change is checked against these.

**Phase 2 — Deterministic core** (the keystone). Pure-TS 120 Hz simulation in
`lib/game/{core,physics,terrain}`, bit-identical to v1 on every fixture. ESLint import
fences keep it pure.

**Phase 3 — Shell, runtime, input.** v2 route behind `?engine=v2`, `GameRuntime` +
`UiBridge`, full input stack (keyboard, pointer-drag, pointer-lock, touch, gamepad),
React HUD, Playwright suite.

**Phase 4 — Renderer parity at r169.** Tiles, articulated skier, props, lift, weather,
spray, tracks, adaptive resolution, context-loss handling, disposal audit. *Why r169
first:* prove nothing regressed before upgrading three.

**Phase 5 — Real terrain.**
- 5.1 Bake pipeline (`scripts/bake-resort.ts`) → committed assets in
  `public/game/terrain/` (~1.1 MB brotli per resort) + runtime decoders.
- 5.2 Bicubic real-heightfield sampler with analytic normals and corridor-damped
  micro-detail. Coordinate convention **gameZ = −assetY** (`TERRAIN-SAMPLING.md`).
- 5.3 Real mountains in-game: six curated real OSM runs per resort, real lift lines,
  landmarks, spawn grade-trimming, minimap polylines. Took two orchestrator visual fix
  rounds (floating landmarks whose visibility was tied to streamed terrain windows;
  obstacles on ungroomed runs; an oversized hotel clipping the viewport).

**Phase 6 — Visual polish.** three **0.185.1 + postprocessing 6.39.4** (matched pair),
snow material stack (wrap-diffuse, blue shadows, rim, glint, triplanar), poster LUT post
chain, CSM shadows, 3-stop sky + cloud band, **player-relative height fog** (absolute-Y
fog saturated at real 3 km altitudes — the big washout bug), 5-rung quality ladder,
perf telemetry, and an e2e canvas-luminance guard (mean < 190, stdev > 28) so a washed-out
frame fails CI.

**Phase 7 — Audio.** v1 synthesis ported plus surface-aware layers; 10 CC0 samples
(archive.org, 1.2 MB, credited in `CREDITS.md`); samples never gate the first frame;
HUD mute toggle.

**Phase 9 — Live conditions.** `buildConditionsSnapshot` (the DESIGN §3.6 table),
server-fetched in the route (ISR 3600), POWDER DAY stamp (verified live — Portillo had
a real 8" day), surface physics enum in sim config (`packed` = parity-neutral).

**Phase 8 — Competition.** Migration `015_drop_in_runs` applied to Supabase prod (RLS
select-only), PCGH ghost codec, HMAC run tickets (seed + surface + physicsModel claims,
layered fail-closed guards), nickname sanitizer, four API routes
(`/api/drop-in/{sessions,runs,leaderboard,ghosts/[runId]}`), recorder, ghost racing,
submission/leaderboard panels, server re-simulation validator behind `DROP_IN_RESIM`.
*Why HMAC tickets and re-sim:* the client is untrusted; a deterministic core lets the
server replay the input tape and reject impossible runs.

**Phase 11 — WebGPU.** WebGPU default where available (three r185 `WebGPURenderer` +
TSL node materials for snow/fog/CSM/post/sky/particles), WebGL fallback preserved
byte-equivalent, bundle split (eager chunk 1510 → 839 KB; `three/webgpu` 647 KB stays
off WebGL sessions), shader prewarm, ring-buffered thermal governor, KTX2 infra,
heap-growth e2e guard. Five real-GPU fix rounds: LUT colour space, WGSL `sin()` NaN at
3 km coordinates, CSM negative-light fade, WebGPU point-list particles. SwiftShader
renders black, so e2e pins `gfx=webgl` by default; `PLAYWRIGHT_WEBGPU=1 --headed` runs
the hardware project.

**Phase 12 — physicsV2.** Carve dynamics, air-control authority decay, aligned-landing
absorption, per-surface response. Merged **flag-off**, parity-proven, golden-fixtured
(4 surfaces × 2 tapes). `?phys=v2` override runs are unsubmittable by three independent
layers. **Default flip awaits Jared's feel-gate playtest.**

**Visual Program Phase 1 (08-02).** Real DEM per resort — Breckenridge USGS 3DEP 1 m
lidar, Heavenly 3DEP seamless 10 m (no 1 m project covers it; verified with
`gdallocationinfo`), Portillo Copernicus GLO-30 (nothing better exists free in the
Andes). GDAL warps each resort to its own UTM zone; `COURSE_VERSION` → 2. Real 30 km
horizon as a pre-baked wedge mesh (~265 KB br/resort) — Aconcagua renders as real
geometry at Portillo. Fog curve unified from four hand-written copies to one definition
that emits the GLSL. Camera presets (`?cam=classic|wide|high|cinematic`) after playtest
feedback that the chase camera felt too close. $0 spend on tooling/licences.

**Visual Program Phase 2 (08-03/04).** GTAO (rung 3+), physical SkyMesh (rung 2+),
godrays (rung 4), real ambientCG Snow006 textures through KTX2. Three real-GPU fix
rounds, documented in `P2-GATE-VISUAL-FIXES.md`: bloom's screen blend `a+b−a·b` inverts
HDR inputs (black sky and gold smear were the same bug); GTAO depth-precision banding
(fixed with a 10–28 m distance fade); Heavenly washout from tone mapping applied after
LDR-calibrated stages. Also discovered: the baked far-field assets had never been
committed, so every earlier browser round silently rendered no horizon and the
luminance budgets had been calibrated against that absence. Guards now pin
`?weather=0` instead of measuring the live forecast.

### Adjacent work that shaped the game
- **Security audit** (PRs #10, #11): the ops dashboard was bound to `0.0.0.0:3333`
  unauthenticated and could spawn `claude --dangerously-skip-permissions` — a LAN path to
  the service-role key. Now localhost-only; open-redirect validation on auth sinks; CSP
  report-only; PostHog token sanitization.
- **Transactional email had never worked** (PR #13): domain unverified in Resend and the
  prod key wasn't a Resend key; every call site discarded `error`, so failure looked like
  success. Matters to the game because Daily Line / leaderboard notifications ride on it.
- **Production incident 2026-08-03**: the History Game's Wikipedia-RAG ingest filled the
  shared Supabase disk → read-only → PostgREST wedged → ISR cached empty pages sitewide.
  Fix was `pg_terminate_backend` on the authenticator connections after the disk was
  expanded, then cache-warm, manual syncs, redeploys. Led to the recommendation to move
  History Game off PeakCam's database.
- **Branch hygiene lesson**: PR #12 was cut from `feat/drop-in-v2` and contained the
  whole game (308 files); it nearly launched the game as a side effect of an email fix.
  Closed; the two email commits were cherry-picked instead.

---

## 6. After the merge (2026-08-11 → 09-04)

- **08-11 `/drop-in` hub** (`d9a0c89`): the game had no global entry point — no nav
  link, no sitemap entry, and `/drop-in` itself 404'd. Now an indexable hub lists the
  live mountains from `lib/drop-in`'s roster; "Drop In" is in the header nav; real
  resorts without a descent get a named "no descent built yet" page instead of "RESORT
  NOT FOUND".
- **09-02 refactor audit** (`15056af`, `daac3f5`, branch `refactor/high-payoff`, PR
  open): five correctness bugs fixed (game side: server `MAX_RUN_SPEED_CMS` now derived
  from `MAX_SPEED` × the max surface multiplier instead of a drifted constant), then
  high-payoff dedup — `lib/game/physics/integrator-core.ts` is one integrator with a
  `CarveModel` seam shared by v1 and v2; `validateRun` and `resimulateGhost` share a
  core in `lib/game/server/validate-run.ts`; `scripts/drop-in-sync-profiles.ts`
  generates engine.html's profile/constants block from `lib/game/config/profiles.ts` and
  `drop-in-engine.test.ts` fails when the generated region is stale.
- **09-04 UI/UX pass**: Drop In section written into the fix brief; route gating
  (`isDropInResort()`) reconfirmed on the map popup, bottom sheet, and resort page.

---

## 7. Where things stand and what's blocking the public flip

**Shipped and on production:** everything in §5. 28 k lines of TypeScript in
`lib/game/`, ~800 unit tests, dual-backend Playwright suites, all green at last merge.

**Not yet done — Phase 10 (rollout):**
1. Rung is captured at construction, so the thermal governor cannot shed SkyMesh or
   triplanar texture sampling on a step-*down* (the direction that matters).
2. Rungs 0/1 on WebGPU have no antialiasing (`aa` policy starts at rung 2).
3. **Server-side surface derivation** — the `surface` claim is client-chosen and signed,
   and it affects v1 leaderboards today. Named as the rollout gate.
4. Bump `PHYSICS_VERSION` before the physicsV2 default flips so leaderboards segment.
5. CI pipeline, device matrix beyond the Mac Mini, accessibility pass, percentage
   rollout, delete v1, soft-404 fix.

**Needs Jared specifically:**
- `DROP_IN_TICKET_KEYS` in Vercel **preview** and **production** envs
  (`k1:<openssl rand -base64 32>`) — without it competitive runs silently degrade to
  offline.
- The **feel-gate playtest**: `?engine=v2&phys=v2` on prod. An override run showing
  "played offline" is the anti-cheat working, not a bug.
- Decide the AA-at-rung-0/1 question.

**Dev levers live in prod (render-only):** `?gfx`, `?nopost`, `?snowdbg`, `?csmdbg`,
`?treedbg`, `?e2ecanvas`, `?e2espawn`, `?phys`, `?cam`, `?weather`.

---

## 8. Lessons that should outlive this document

Collected from `SESSION-2026-08-02.md`, `SESSION-2026-08-04.md`, and `STATUS.md`:

- **Sandboxed agents cannot see rendering bugs.** Unit tests passed while the hotel
  floated in the sky and the whole scene washed out. Budget real-GPU screenshot rounds
  into every visual phase, and look at the failing view (round 1's "after" frame was
  9 s into the run; the failing view was at 750 ms).
- **Measure, don't reason, about external data.** Heavenly's DEM killed three
  theories before `gdalinfo` settled it. A staged tile existing is not coverage; 3DEP
  filenames index the tile's *north* edge.
- **Silence is the enemy.** Email that reported success while rejected; a far-field
  asset 404 that degraded so gracefully it read as "working as intended". Check the
  thing, not the absence of complaints.
- **One-sided guards can't see a black sky** — it moves both luminance metrics in the
  passing direction. Guards that measure live weather aren't guards; pin the inputs.
- **Debug flags beat theories.** `?nopost` / `?snowdbg` partitioned three bugs in
  minutes and contradicted every prior hypothesis.
- **Duplication is where correctness goes to die.** Four copies of one fog curve with
  two pinned; fake test backends modelling renderers that don't exist — which is how a
  WebGPU-only `dispose()` crash reached a user.
- **Reviews caught what authors could not.** A redirect guard prescribed by our own
  security review was bypassable; a `Permissions-Policy` header would have silently
  killed the map's "find me" button. All caught pre-merge by a second model reading the
  same diff.
- **Check `git diff main...HEAD --stat` before merging anything.**

---

## 9. Map of the record

| Want to know… | Read |
|---|---|
| The vision, pillars, modes, architecture decisions | `DESIGN.md` |
| The phase plan and effort envelope | `PLAN.md` |
| Current delta vs the plan, remaining work, operating lessons | `STATUS.md` |
| What happened day by day | `SESSION-2026-08-02.md`, `SESSION-2026-08-04.md` |
| Competition loop design | `P8-COMPLETION-PLAN.md`, `RUN-CONTRACTS.md`, `P5-RUN-SELECTION.md` |
| WebGPU + physicsV2 design and plan | `P11-P12-DESIGN.md`, `P11-P12-PLAN.md` |
| Visual program | `VISUALS-DESIGN.md`, `P2-GATE-VISUAL-FIXES.md`, `docs/superpowers/plans/2026-08-0{2,3}-*.md` |
| Terrain sampling / coordinate conventions | `TERRAIN-SAMPLING.md` |
| Perf budgets | `BUDGETS.md` |
| Audio | `AUDIO.md` |
| The three research reports behind the design | `research/` |
| v1 → v2 parity checklist | `P4-PARITY-CHECKLIST.md` |
| Git history of the game | `git log -- lib/game components/drop-in public/drop-in docs/drop-in-v2` |
| Claude Code transcripts (Mac Mini) | `~/.claude/projects/-Users-maestro-admin-projects/{011459cf…,21a4aa8a…}.jsonl` (Aug 3–10), `-Users-maestro-admin-projects-peakcam/3e3cf95b….jsonl` (Sep 2–3), `-Users-maestro-admin-peakcam-peakcam/6bc0a942….jsonl` (Sep 4) |

The 2026-07-27 v1 build and the 2026-08-01/02 design-and-build sessions predate any
surviving Claude Code transcript; their record is the commits and the docs above.