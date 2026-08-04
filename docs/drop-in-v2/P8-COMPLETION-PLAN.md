# Drop In v2 — Phase 8.3/8.4 Completion Plan (recorder, ghosts, modes, panels, validator)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> Spec: `docs/drop-in-v2/DESIGN.md` §3.7 (competition), §3.8 (analytics), plus
> `RUN-CONTRACTS.md`. Backend (migration 015, API routes, PCGH codec, HMAC tickets,
> baseline validation) is DONE — this plan wires it into the game and UI.

**Goal:** A player can pick Time Trial or Daily Line, ski, have the run recorded, submit it with a ticket, see themselves on the leaderboard, and race downloaded ghosts; the server re-simulation validator gates Daily Line integrity.

**Architecture:** Recorder samples sim state in `GameRuntime`'s fixed-step loop → `encodeGhost` (existing codec). Mode flow: `sessions` API issues ticket at run start; `runs` API receives result+ghost. React panels live beside the existing HUD (`components/drop-in/hud/`). Ghost playback is a render-only consumer of `decodeGhost` output.

**Tech Stack:** existing PCGH codec (`lib/game/replay/codec.ts`), route handlers under `app/api/drop-in/`, zustand UiBridge (15Hz), React 19 HUD, node:test, Playwright.

## Global Constraints

- Sim core purity: recorder must not mutate `SimulationState`; ghost rendering must never feed back into simulation. eslint import fences stay intact.
- All existing tests (374 unit / 9+ Playwright) stay green after every task.
- Ghost samples are quantized via `quantizeGhostSample` before comparison in tests (codec is lossy by design).
- API payload ceiling 128 KB (existing route constraint); `MAX_KEYFRAMES = 20000`, `SYNC_INTERVAL_SECONDS = 5` — respect codec constants, never redefine them.
- HUD components use the `pc-*` poster design tokens (no legacy dark-theme tokens).
- Anonymous play must keep working: nickname flow per DESIGN §3.7 (sanitizeNickname server-side), auth "claim score" is an upsell, never a wall.
- Samples never gate the first frame; network calls never block `GameRuntime.start()`.
- Query overrides follow the `nopost` dev-gate pattern.

---

### Task A1: Ghost recorder wired into the runtime

**Files:**
- Create: `lib/game/replay/recorder.ts`, `lib/game/replay/recorder.test.ts`
- Modify: `lib/game/runtime/GameRuntime.ts` (sample in the fixed-step loop; expose finished-run payload), `lib/game/runtime/UiBridge.ts` (surface `runRecording` availability on finish)

**Interfaces:**
- Produces: `class GhostRecorder { begin(nowSimTime: number): void; sample(state: SimulationState, simTime: number): void; finish(): GhostSample[] | null; readonly recording: boolean }` — samples at the codec's sample rate (derive Hz from `GHOST_DELTA_FRAME_BYTES` budget: 30 Hz target, decimating the 120 Hz loop 4:1), caps at `MAX_KEYFRAMES`, converts state (`pos` m → cm ints, `yaw` via `quantizeYaw`, pose flags from `onGround`/`crouch`/`crash`) into `GhostSample`s.
- Consumes: `GhostSample`, `encodeGhost`, `MAX_KEYFRAMES` from `codec.ts`; run lifecycle events (`events.reset`, `state.finished`).

Steps: failing unit tests (decimation ratio; cap; pose flags; reset discards) → implement → wire into `GameRuntime` step loop (recording starts when a competitive run starts, finishes on `state.finished`) → full suite green → commit.

### Task A2: Ghost renderer (translucent poster-ink rider)

**Files:**
- Create: `lib/game/rendering/GhostRenderer.ts`, tests in `rendering.test.ts`
- Modify: `lib/game/rendering/Renderer.ts` (optional ghost track), `lib/game/runtime/GameRuntime.ts` (pass ghost + sim clock)

**Interfaces:**
- Produces: `class GhostRenderer { setGhost(ghost: DecodedGhost | null): void; update(simTime: number): void; dispose(): void }` — interpolates between samples (linear pos, shortest-arc yaw), renders a simplified translucent rider (poster ink `#2a1f14`, opacity 0.45, no shadows, no spray), hidden before first/after last sample.
- Consumes: `DecodedGhost`/`decodeGhost`; a simplified copy of `SkierRenderer`'s rig construction (shared geometry helper extraction is allowed).

Steps: failing interpolation tests (midpoint position, yaw wrap at ±π, out-of-range hidden) → implement → integrate render-only → suite green → commit.

### Task A3: Mode selection + session flow (Time Trial / Daily Line)

**Files:**
- Create: `components/drop-in/hud/ModeSelect.tsx`, `lib/game/competition/session-client.ts` (+tests)
- Modify: `components/drop-in/DropInGame.tsx`, `lib/game/runtime/UiBridge.ts`, `lib/game/config/modes.ts` (only if a field is missing)

**Interfaces:**
- Produces: `requestRunSession(input: { resortSlug: string; mode: CompetitiveRunMode; trailId: string }): Promise<RunSessionTicket | { error: string }>` (fetch wrapper over `POST /api/drop-in/sessions`, zod-parsed response, abortable); `ModeSelect` renders Free Ski / Time Trial / Daily Line cards (poster tokens), Daily Line shows today's course from ticket payload.
- Consumes: `CompetitiveRunMode`, `RunDefinition` (`config/modes.ts`), ticket response schema (`lib/game/server/run-ticket.ts` — mirror its payload type client-side, do not import server module into client bundle).

Steps: failing tests for `session-client` (parses good ticket, rejects malformed, network error surfaces `{error}`) → implement → UI wiring behind Start screen → Playwright: mode select visible, Free Ski unaffected → commit.

### Task A4: Results submission + leaderboard/ghost panels

**Files:**
- Create: `components/drop-in/hud/LeaderboardPanel.tsx`, `components/drop-in/hud/SubmitRunCard.tsx`, `lib/game/competition/run-client.ts` (+tests)
- Modify: `components/drop-in/hud/ResultsDialog.tsx` (embed SubmitRunCard for competitive runs), `DropInGame.tsx`

**Interfaces:**
- Produces: `submitRun(input: { ticket: string; result: RunResultPayload; ghost: Uint8Array; nickname?: string }): Promise<SubmitOutcome>` (multipart/base64 per existing `runs` route contract — read `app/api/drop-in/runs/route.ts` and match exactly); `fetchLeaderboard(input: { resortSlug: string; courseId: string; mode: CompetitiveRunMode }): Promise<LeaderboardRow[]>`; `fetchGhost(runId: string): Promise<DecodedGhost>`; panels render top-20 + own row, "race this ghost" action feeds Task A2's `setGhost`.
- Consumes: A1's recorder output, A3's ticket, `decodeGhost`.

Steps: failing client tests (round-trip against handler fixtures in `lib/game/server/__fixtures__`) → implement clients → panels → Playwright: play → submit (mocked route) → row appears → commit.

### Task A5: Server re-simulation validator enabled

**Files:**
- Modify: `lib/game/server/validate-run.ts` (+test), `lib/game/server/courses.ts` (real startZ/finishZ so `startFinishChecked` becomes true — values from the baked course data, see `P5-RUN-SELECTION.md`)
- Create: tampered fixtures under `lib/game/server/__fixtures__/`

**Interfaces:**
- Produces: `resimulateGhost(ghost: DecodedGhost, course: ServerCourse, config: SimulationConfig): ResimVerdict` behind env flag `DROP_IN_RESIM=1` — steps the pure core against the ghost trajectory and rejects when divergence exceeds physical plausibility (speed/accel envelopes already in validate-run constants; add trajectory-consistency: per-segment accel within `MAX_ACCEL_CMS2`/`MAX_DECEL_CMS2`, start/finish inside course gates).
- Consumes: pure core (`stepSimulation` allowed server-side — it is pure TS), existing rejection codes.

Gate (from PLAN.md): accepts 100% of honest fixture runs; rejects all tampered fixtures (time edit, teleport, speed hack, replayed nonce). Steps: create honest + 4 tampered fixtures → failing tests → implement → gate assertions green → commit.

### Task A6: PostHog taxonomy

**Files:**
- Create: `lib/game/analytics/events.ts` (+test: event names/props match DESIGN §3.8 table verbatim)
- Modify: `GameRuntime` analytics hooks, panels from A3/A4

**Interfaces:**
- Produces: typed `trackDropIn(event: DropInEvent): void` wrapper over the site's existing PostHog client (`NEXT_PUBLIC_POSTHOG_KEY` guard — no-op when unset).
- Consumes: DESIGN §3.8 event table (mode_selected, run_started, run_finished, run_submitted, leaderboard_viewed, ghost_raced + props).

Steps: failing name/prop test from the DESIGN table → implement → wire call sites → suite green → commit.

**Phase gate (orchestrator):** E2E play → submit → appear on board (route mocked in CI, real Supabase on preview); validator gate assertions; browser visual review of panels; merge `--no-ff`.
