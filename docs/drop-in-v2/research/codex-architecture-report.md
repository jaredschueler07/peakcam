# Drop In enterprise rebuild — migration and architecture recommendation

**Recommendation:** replace the iframe with a client-only React shell that lazily loads an imperative TypeScript game runtime. Keep simulation state entirely outside React, preserve the existing deterministic 120 Hz fixed-step model, and expose only throttled HUD snapshots and discrete lifecycle events to React.

Use a strangler migration: first extract and characterize the current terrain/physics behavior without changing Three.js or gameplay; then port rendering, input, HUD, and backend features behind a rollout flag. Do not combine the architectural migration with a Three.js upgrade.

## 1. Current-state findings

The current implementation has several strong foundations worth preserving:

- A deterministic procedural mountain shared by rendering, collision, props, and minimap through `terrainHeight()` and `terrainNormal()` in [engine.html](/Users/maestro_admin/projects/peakcam/public/drop-in/engine.html:607).
- A fixed simulation step of `1/120` second with an accumulator and spiral-of-death cap in [engine.html](/Users/maestro_admin/projects/peakcam/public/drop-in/engine.html:2519).
- Adaptive pixel ratio based on measured FPS.
- Instanced vegetation and streamed terrain tiles rather than one enormous scene.
- Web Audio initialization only after a user gesture.
- Accessible DOM-based start controls and touch controls.
- Explicit WebGL, module-loading, and unsupported-resort failure reporting.

The primary architectural liabilities are:

1. Resort configuration is duplicated between [lib/drop-in.ts](/Users/maestro_admin/projects/peakcam/lib/drop-in.ts:1) and three embedded profile blocks in [engine.html](/Users/maestro_admin/projects/peakcam/public/drop-in/engine.html:317). The existing test catches drift, but duplication remains the source of truth problem.

2. Nearly every subsystem shares global mutable state: Three.js objects, input state, simulation state, DOM nodes, sound, scoring, and scene streaming.

3. Physics directly depends on `THREE.Vector3`, making deterministic Node-side validation and server replay harder.

4. Input devices mutate one global `keys` map. There is no normalized input model or gamepad support.

5. React/engine communication requires `postMessage`, source/origin verification, and iframe loading backstops in [DropInFrame.tsx](/Users/maestro_admin/projects/peakcam/components/drop-in/DropInFrame.tsx:19).

6. Pointer lock is attempted from an iframe context. Although failure is caught, lock loss is part of the pause condition, and iframe/browser policy differences remain a failure source.

7. The game has no canonical finish condition. Terrain streams indefinitely; restart and lift reset time/score. A trustworthy leaderboard first requires explicit competitive run definitions.

8. [next.config.ts](/Users/maestro_admin/projects/peakcam/next.config.ts:6) still describes an opaque sandboxed iframe, while the actual iframe is deliberately not sandboxed. That CORS configuration becomes unnecessary after removal of the static engine.

9. The tests described as “vitest-style” are actually Node’s built-in `node:test` runner executed through `tsx`. Preserve that lightweight pattern rather than introducing Vitest without a separate need.

## 2. Target application boundary

The Server Component route should continue validating the resort and generating metadata. It should render a small Client Component containing `next/dynamic(..., { ssr: false })`; Next.js requires `ssr:false` to live inside a Client Component. This keeps the game out of SSR and separates its code from unrelated site routes. [Next.js documents this client-boundary requirement directly.](https://nextjs.org/docs/app/guides/lazy-loading)

```text
app/resorts/[slug]/drop-in/page.tsx
    │ Server Component: profile lookup, 404, metadata
    ▼
components/drop-in/DropInClientBoundary.tsx
    │ "use client"; next/dynamic, ssr:false
    ▼
components/drop-in/DropInGame.tsx
    │ lightweight poster, React HUD, controls, errors
    │ user presses Start
    ▼
import("@/lib/game/runtime/createGame")
    │ route/start-only chunk
    ▼
Three.js + renderer + simulation runtime
```

Use two levels of code splitting:

- Route entry: `DropInClientBoundary` dynamically loads `DropInGame`.
- Start gesture: `DropInGame` dynamically loads `lib/game/runtime/createGame`, whose render modules statically import `three`.

This means visiting unrelated pages loads none of the game code; visiting the Drop In route loads only its small shell; Three.js and the full runtime load when the player expresses intent.

## 3. Concrete file layout

```text
app/
  api/
    drop-in/
      sessions/route.ts             # Issues short-lived run tickets
      runs/route.ts                 # Validates and records completed runs
      leaderboard/route.ts          # Optional cached public read API
      ghosts/[runId]/route.ts       # Binary ghost response
  resorts/[slug]/drop-in/
    page.tsx

components/drop-in/
  DropInClientBoundary.tsx          # "use client"; next/dynamic ssr:false
  DropInGame.tsx                    # Runtime ownership and lifecycle
  DropInLoadingPoster.tsx
  DropInErrorBoundary.tsx
  hud/
    DropInHUD.tsx
    Speedometer.tsx
    RunStatus.tsx
    TrailStatus.tsx
    MinimapCanvas.tsx               # Imperative Canvas2D, not React per-frame
    PauseDialog.tsx
    ResultsDialog.tsx
    LeaderboardPanel.tsx
  input/
    TouchControls.tsx
    TiltPermissionDialog.tsx
    ControlHints.tsx

lib/
  drop-in.ts                        # Public app-facing exports/re-exports
  game/
    config/
      schema.ts                     # Zod schemas and TS types
      profiles.ts                   # One source of resort/game configuration
      modes.ts                      # time_trial, score_attack definitions
      versions.ts                   # physics/config/ghost format versions
    core/
      types.ts                      # Plain Vec3/scalar state; no browser/Three
      math.ts
      rng.ts
      clock.ts                      # FixedStepClock
      events.ts                     # Typed runtime event contracts
      simulation.ts                 # init/step/reset
      scoring.ts
      run-lifecycle.ts
    physics/
      skier.ts
      collision.ts
      integrator.ts
      constants.ts
    terrain/
      heightfield.ts                # Pure sampleHeight/sampleNormal
      noise.ts
      trails.ts
      obstacles.ts
      formats.ts                    # Baked height/trail binary decoders
    input/
      types.ts                      # Normalized InputFrame
      InputManager.ts
      KeyboardAdapter.ts
      PointerLockAdapter.ts
      TouchAdapter.ts
      TiltAdapter.ts
      GamepadAdapter.ts
    replay/
      recorder.ts
      player.ts
      codec.ts
      validation.ts
    runtime/
      createGame.ts                 # Lazy-loaded composition root
      GameRuntime.ts                # RAF, lifecycle, start/stop/dispose
      UiBridge.ts                   # Throttled snapshots + domain events
    rendering/
      Renderer.ts
      SceneFactory.ts
      TerrainRenderer.ts
      WorldStreamer.ts
      SkierRenderer.ts
      EffectsRenderer.ts
      CameraController.ts
      WeatherRenderer.ts
      QualityController.ts
      loaders/
        AssetManifestLoader.ts
        TerrainAssetLoader.ts
        ModelLoader.ts
    audio/
      AudioEngine.ts
      ProceduralSoundBank.ts
    state/
      hudStore.ts                   # Zustand vanilla store; UI projection only
      selectors.ts
    server/
      run-ticket.ts                 # server-only signing/verification
      validate-run.ts               # bounds and authoritative replay
      run-schema.ts

public/game/
  assets/
    v1/
      manifest.<hash>.json
      shared/
        basis/
          basis_transcoder.js
          basis_transcoder.wasm
        skier.<hash>.glb
        snow.<hash>.ktx2
        audio/
          ...
      ski-portillo/
        terrain.<hash>.u16
        terrain.<hash>.json
        trails.<hash>.json
      breckenridge/
        ...
      heavenly/
        ...

scripts/
  bake-game-terrain.ts
  validate-game-assets.ts
  game-determinism.test.ts

supabase/migrations/
  012_drop_in_runs.sql

tests/e2e/
  drop-in.spec.ts

playwright.config.ts
```

Keep source art and high-resolution intermediate assets outside `public`, for example under `assets/game/source/`. Only optimized, deployable outputs belong in `public/game/assets`.

## 4. Module boundaries and loop ownership

### Pure core

`simulation.ts`, physics, terrain sampling, scoring, and replay codecs must not import:

- React
- DOM APIs
- Three.js
- Web Audio
- PostHog
- Supabase

Represent vectors as plain numeric structures or tightly controlled mutable structures:

```ts
interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface InputFrame {
  steer: number;       // -1..1
  tuck: number;        // 0..1
  brake: number;       // 0..1
  jumpHeld: boolean;
  jumpPressed: boolean;
  restartPressed: boolean;
  trailPressed: boolean;
}
```

The core API should resemble:

```ts
createSimulation(config, seed): SimulationState;
stepSimulation(state, input, fixedDt, world): SimulationEvents;
resetSimulation(state, runDefinition): void;
```

Use injected scratch vectors or module-local scratch objects to avoid allocations. Rendering can copy the resulting scalar state into Three.js objects.

### Runtime

`GameRuntime` owns:

- `requestAnimationFrame`
- the fixed-step accumulator
- the renderer
- input polling
- sound
- replay recording
- visibility/pause state
- resource disposal
- runtime event emission

React owns the lifetime of one `GameRuntime`, not its frame updates:

```ts
useEffect(() => {
  const runtime = await createGame({ canvas, profile, uiBridge });
  return () => runtime.dispose();
}, [profile.slug]);
```

The cleanup must cancel RAF, remove every listener, exit pointer lock when appropriate, stop/disconnect audio nodes, abort asset requests, and dispose geometries, materials, textures, and the renderer.

### React versus in-canvas UI

Use React/DOM for:

- Start/loading/error screens
- Speed, time, score, combo, trail, altitude
- Pause and control-help dialogs
- Touch controls and tilt calibration
- Results, leaderboard, authentication prompts
- Settings and accessibility controls

Use Three.js for:

- Terrain, skier, props, lift, weather, gates
- Particles, tracks, world-space markers
- Camera and lighting

Keep the minimap as a DOM `<canvas>` managed imperatively. React should mount it, but `MinimapCanvas` should draw through a ref on the UI update cadence.

This provides responsive layout, accessibility, localization, and conventional focus handling without turning the render loop into React work.

## 5. Preventing React rerenders in the game loop

Use a combination of a vanilla Zustand store and typed events, not one mechanism for everything.

- The simulation remains ordinary mutable engine state.
- `UiBridge` copies a small immutable HUD projection into a Zustand vanilla store at **10–20 Hz**, matching the current 50 ms HUD throttle.
- React components subscribe to narrow selectors such as `speedKmh`, `score`, or `isPaused`.
- Discrete events—crash, gate passed, run finished, pointer-lock failure—travel through a typed event emitter and may immediately update the UI store or analytics.
- Camera pose, particle arrays, terrain streaming, key state, and per-step position never enter React or Zustand.
- Do not call React state setters from RAF.

Zustand 5 exposes a vanilla store suitable for this separation and has no runtime dependencies. The current release is 5.0.14. [Package source/version.](https://www.npmjs.com/package/zustand)

A small hand-written typed emitter is sufficient; no event-bus package is needed.

## 6. Competitive modes must be explicit

Before adding a leaderboard, define finite and versioned run contracts:

```ts
interface RunDefinition {
  mode: "time_trial" | "score_attack";
  resortSlug: DropInResortSlug;
  trailId: string;
  seed: number;
  startZ: number;
  finishZ: number;
  durationLimitMs?: number;
  physicsVersion: number;
  courseVersion: number;
}
```

Recommended initial modes:

- `time_trial`: one selected trail, fixed weather/seed, fixed start and finish, lift disabled, restart begins a new session. Primary ordering is `time_ms ASC`, then score.
- `score_attack`: fixed 120-second or fixed-vertical session. Primary ordering is `score DESC`, then `time_ms`.
- Keep the current endless/free-ride mode, but do not submit it to the competitive leaderboard.

Physics version, course version, and asset/config hash must be stored with every run. Old ghosts may remain viewable without remaining comparable to a changed course.

## 7. Input architecture

### Normalization and arbitration

Each adapter writes into an `InputManager`, which emits one normalized `InputFrame` per fixed simulation step.

For analog steering:

- Apply a configurable dead zone, initially about `0.12`.
- Remap the remaining range to `[-1, 1]`.
- Use the most recently active analog source.
- Treat keyboard steering as a digital override while held.
- Detect actions on rising edges so holding a gamepad button does not repeatedly restart or change trail.

Persist the preferred control scheme locally, but switch automatically when another device produces meaningful input.

### Pointer lock

Moving the canvas into the top-level document removes the iframe document/policy boundary responsible for `WrongDocumentError`.

Pointer lock should be a progressive enhancement:

1. Request it only inside a direct pointer or keyboard activation.
2. Attempt `requestPointerLock({ unadjustedMovement: true })`.
3. If unsupported or rejected, retry without options.
4. Catch the returned rejection as well as synchronous exceptions.
5. Report the DOM exception name to analytics.
6. Continue with keyboard, unlocked pointer-drag, touch, or gamepad.
7. Do not freeze the whole simulation merely because pointer lock was denied.
8. On `pointerlockchange`, distinguish user escape from browser denial; show a pause/control prompt only when mouse-lock was the active scheme.

An unlocked fallback can use horizontal pointer drag with pointer capture. Avoid absolute cursor position because players eventually reach the screen edge.

### Keyboard

- Attach listeners to the game container or `window` only while the game is active.
- Ignore shortcuts when focus is inside a button, input, dialog, or leaderboard.
- Clear held input on `blur`, `visibilitychange`, pause, and disposal.
- Preserve arrows plus WASD.
- Keep start/reacquire available through Enter.
- Provide rebindable actions later through the adapter configuration, without exposing DOM key names to physics.

### Touch

Default to an accessible virtual steering pad or horizontal thumb zone. Keep explicit buttons for tuck, brake, jump, trail, lift/free-ride only, and restart.

For optional device tilt:

- Ask permission from a direct gesture where required.
- Calibrate neutral roll when enabled.
- Filter sensor noise with a low-pass filter.
- Clamp and remap roll to `[-1, 1]`.
- Provide a visible recenter action.
- Never make tilt the only touch scheme.
- Respect safe-area insets and device rotation.

### Gamepad

Poll `navigator.getGamepads()` from RAF, but sample the normalized result at fixed steps.

Suggested standard mapping:

- Left stick X or D-pad: steer
- Right trigger / A: tuck
- Left trigger / B: brake
- A / south button: jump
- Shoulder buttons: switch trail
- Start: pause
- Y: restart after confirmation

Handle connection/disconnection and display the detected mapping. Unknown/non-standard mappings should fall back to keyboard rather than guessing destructive actions.

## 8. Asset pipeline on Vercel

### Deployment placement

Use versioned, content-hashed static assets:

```text
/public/game/assets/v1/<resort>/<logical-name>.<content-hash>.<ext>
```

Suggested formats:

| Asset | Format | Notes |
|---|---|---|
| Physics terrain | `.u16` plus JSON metadata | Quantized height samples; quick deterministic CPU decoding |
| GPU height/normal texture | KTX2/Basis | Optional; avoid decoding image pixels for physics |
| Trail definitions | JSON initially; binary later if needed | Validate during build with Zod |
| Models | `.glb` | Prefer meshopt-compressed glTF |
| Textures | `.ktx2` | Include Basis transcoder assets |
| Short SFX | `.ogg` plus `.mp3` fallback if needed | Procedural Web Audio can remain for wind/carve |
| Music/ambience | streamed `.ogg`/`.m4a` | Load only after user starts and enables audio |
| Manifest | versioned JSON | File URLs, hashes, byte sizes, bounds, format versions |

A GPU KTX2 heightmap does not replace the physics heightfield unless the CPU can decode the exact same values cheaply. Retain a compact integer heightfield for simulation and validation.

### Caching

For hashed files:

```http
Cache-Control: public, max-age=31536000, immutable
```

For a stable manifest alias, either:

- give it a content-hashed name and embed that name in the game chunk, or
- use short caching with revalidation.

Vercel automatically caches static files on its CDN; hashed names allow them to persist safely across deployments. Browser immutability still requires an explicit header. [Vercel CDN caching documentation.](https://vercel.com/docs/caching/cdn-cache)

Do not reuse filenames for changed content. That is more important than cache purging.

Consider object storage/CDN rather than the deployment artifact when individual terrain packages become large or independently released. Vercel’s documented CDN cache criteria include a 10 MB response ceiling, so split large terrain into tiles/chunks rather than one large file.

### Loading behavior

- Preload only the manifest after the game shell mounts.
- Begin Three/runtime/assets on Start, or optionally during idle time after the poster becomes interactive.
- Load the selected resort package only.
- Show byte-weighted progress using manifest sizes.
- Use `AbortController` during navigation.
- Load lower-resolution terrain first if a later art pass creates multiple LODs.
- Cache parsed shared geometries/textures inside one runtime instance; do not leave global WebGL objects across route unmounts.

After the iframe is retired:

- Delete `public/drop-in/engine.html` and vendored `three.module.js`.
- Delete `drop-in:sync-three`.
- Remove the `/drop-in/:path*` CORS header.
- Keep route-level `robots` metadata on the actual Next.js page.

## 9. Supabase leaderboard design

### Schema

Use the existing UUID `resorts.id` as the foreign key, while storing the course/config versions needed to interpret the run.

```sql
create table drop_in_runs (
  id                  uuid primary key default gen_random_uuid(),
  resort_id           uuid not null references resorts(id) on delete restrict,
  user_id             uuid references auth.users(id) on delete set null,

  mode                text not null
                      check (mode in ('time_trial', 'score_attack')),
  trail_id            text not null,
  time_ms             integer not null
                      check (time_ms between 1000 and 1800000),
  score               integer not null
                      check (score between 0 and 100000000),

  physics_version     smallint not null,
  course_version      integer not null,
  ghost_version       smallint not null,
  tick_hz             smallint not null
                      check (tick_hz between 10 and 240),

  run_nonce           uuid not null unique,
  ghost_data          bytea not null,
  ghost_sha256        bytea not null,
  ghost_keyframes     integer not null
                      check (ghost_keyframes between 2 and 20000),

  accepted            boolean not null default false,
  rejection_code      text,
  validation_metrics  jsonb not null default '{}'::jsonb,

  started_at          timestamptz not null,
  finished_at         timestamptz not null,
  created_at          timestamptz not null default now(),

  check (finished_at >= started_at),
  check (
    (accepted and rejection_code is null)
    or
    (not accepted and rejection_code is not null)
  )
);

create index drop_in_runs_leaderboard_idx
  on drop_in_runs
  (resort_id, mode, trail_id, physics_version, course_version,
   score desc, time_ms asc)
  where accepted;

create index drop_in_runs_user_idx
  on drop_in_runs (user_id, created_at desc)
  where user_id is not null;

create index drop_in_runs_created_idx
  on drop_in_runs (created_at desc);
```

For time trials, the public query must explicitly sort by `time_ms ASC, score DESC`. For score attack, sort by `score DESC, time_ms ASC`; do not rely on one shared index ordering for semantic correctness.

If ghost blobs remain approximately 20–60 KB, `bytea` is simpler and transactionally tied to the run. Move them to a private Supabase Storage bucket only if they grow materially, need independent lifecycle rules, or database bandwidth becomes significant. Storage is RLS-controlled by default and supports signed URLs for private objects. [Supabase Storage access model.](https://supabase.com/docs/guides/storage/buckets/fundamentals)

### RLS

Do not permit browser clients to insert authoritative leaderboard rows directly.

```sql
alter table drop_in_runs enable row level security;

create policy "Public accepted leaderboard runs"
  on drop_in_runs for select
  to anon, authenticated
  using (accepted = true);

create policy "Users can read their own rejected runs"
  on drop_in_runs for select
  to authenticated
  using (user_id = (select auth.uid()));
```

Define no client `INSERT`, `UPDATE`, or `DELETE` policy. A Next.js Route Handler validates submissions and inserts using a server-only Supabase secret/service credential. Supabase distinguishes `anon` and `authenticated` database roles, and `auth.uid()` is the normal policy identity primitive. [Supabase RLS documentation.](https://supabase.com/docs/guides/database/postgres/row-level-security)

Return only public leaderboard fields. Do not expose `validation_metrics`, nonce, detailed rejection reason, or raw user identity in the public view/API.

### Anti-cheat

A client-side secret or “client-signed run payload” is not meaningful—the player controls the JavaScript and can extract or bypass it.

Use server-issued run tickets:

1. `POST /api/drop-in/sessions` requests a run.
2. Server chooses the course seed and returns a short-lived HMAC-signed token containing:
   - nonce
   - resort/mode/trail
   - physics and course versions
   - seed
   - issued/expiry timestamps
   - authenticated user ID when present
3. Client submits that ticket plus replay/ghost data.
4. Server verifies signature, expiry, nonce uniqueness, and user binding.
5. Server validates the replay and derives score/time itself.
6. Server inserts the accepted or rejected record.

Validation levels:

- **Baseline:** schema/size limits, rate limits, duration bounds, coordinate bounds, maximum speed/acceleration, legal start/finish, monotonic tick sequence, course/version match, ghost hash, and one-time nonce.
- **Recommended:** record normalized input frames and re-run the pure physics core server-side. Compare final time, score, checkpoints, and periodic state hashes within documented tolerances.
- **Advanced:** retain rejected-run telemetry, detect impossible distributions, and flag repeated accounts/device sessions.

The signed ticket proves that the server issued a particular challenge; it does not prove that the client executed honestly. Authoritative re-simulation is the strongest practical control enabled by extracting the physics core.

Use body limits—approximately 128 KB initially—plus per-IP/session/user rate limiting. Keep signing keys server-only in Vercel environment variables and support key rotation through a `kid`.

## 10. Ghost replay format

Use a versioned binary format rather than JSON arrays.

Suggested header:

```text
magic             4 bytes  "PCGH"
format_version    u8
physics_version   u16
course_version    u32
sample_hz         u8       e.g. 10
flags             u16
seed              u32
origin_x_cm       i32
origin_y_cm       i32
origin_z_cm       i32
keyframe_count    u16/u32
```

Suggested keyframe at 10 Hz:

```text
delta_ticks       u8/u16
delta_x_cm        i16
delta_z_cm        i16
ground_offset_cm  i16      skier Y relative to sampled terrain
yaw               u16      maps 0..65535 to 0..2π
speed_cms         u16
pose_flags        u8       airborne, tucked, braking, crashed
```

Use absolute synchronization frames periodically, for example every five seconds, so one damaged delta does not corrupt the remainder.

At roughly 14–18 bytes × 10 Hz × 180 seconds, a three-minute ghost is around 25–32 KB before compression. That is small enough for `bytea`. Interpolate ghost visuals between keyframes; never feed ghost keyframes back into competitive physics.

Store the replay-critical input stream or state hashes separately when server re-simulation is required. A visual ghost trace alone is insufficient evidence of legal gameplay.

## 11. Testing and CI

### Keep the current unit-test style

Continue using:

```ts
import { test } from "node:test";
import assert from "node:assert";
```

The existing `tsx --test` setup is adequate. Expand the test glob because `lib/*.test.ts` will not discover nested `lib/game/**/*.test.ts`.

Unit-test:

- PRNG golden sequences.
- `terrainHeight(x,z)` golden samples for every resort/config version.
- Terrain normal direction, normalization, and boundary continuity.
- Trail center/corridor sampling.
- Fixed-step clock behavior after long frames.
- Physics determinism from seed + input trace.
- Identical result under different render-frame pacing.
- Tuck/brake/steer bounds and speed cap.
- Jump charge, landing, crash recovery, lift/free-ride behavior.
- Obstacle generation and collision determinism.
- Gate crossing, missed gates, combo expiry, and score derivation.
- Run start/finish rules.
- Replay encode/decode round trips and corrupted-input rejection.
- Quantization error bounds.
- Server validator acceptance of known-good fixtures and rejection of impossible traces.
- Profile/config schema validation.
- Input dead zones and rising-edge actions.
- Resource disposal through fakes/spies.

Commit several short “golden run” fixtures captured from the current engine. They should encode input, expected periodic state hashes, final position, time, and score. This gives the migration a parity contract.

Keep rendering tests narrow: object construction, disposal, and asset-decoder tests. Pixel-perfect Three/WebGL unit tests will be brittle.

### Playwright smoke tests

Add Chromium smoke coverage for:

- Valid resort route renders a start control and no iframe.
- Unsupported resort returns 404.
- Start loads a canvas and reaches `running`.
- Keyboard-only start and steering work.
- Forced pointer-lock rejection leaves the game playable.
- Escape/pause and resume behavior.
- Touch viewport displays touch controls.
- WebGL-unavailable path shows an actionable error.
- Route navigation unmounts cleanly with no console/page errors.
- One mocked run completion opens results and submits once.
- Main site routes do not request the Three/game runtime chunks.
- No unexpected third-party game asset origins are requested.

Run WebKit touch smoke periodically, especially for audio and device-orientation permission behavior.

### CI sequence

```text
npm ci
npm run lint
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
```

Upload Playwright trace, screenshot, and console logs on failure. Add a deterministic test that executes thousands of fixed steps; this catches accidental introduction of `Math.random()`, wall-clock time, or render-dependent inputs into simulation.

## 12. PostHog event taxonomy

Preserve the existing three events for funnel continuity, then add stage-specific events. Do not emit per-frame, per-gate, or per-input events directly to PostHog.

| Event | Trigger |
|---|---|
| `drop_in_opened` | Route/client shell mounted |
| `drop_in_load_started` | Runtime import begins |
| `drop_in_ready` | Runtime and required assets are playable |
| `drop_in_started` | Player begins a run |
| `drop_in_control_activated` | First meaningful input; once per session |
| `drop_in_pointer_lock_result` | Lock acquired, denied, unsupported, or lost |
| `drop_in_run_finished` | Canonical finish/crash/quit/timeout |
| `drop_in_run_submitted` | Submission accepted/rejected/network failure |
| `drop_in_leaderboard_viewed` | Panel opened |
| `drop_in_ghost_selected` | Ghost chosen |
| `drop_in_ghost_finished` | Player finishes with ghost active |
| `drop_in_settings_changed` | Quality, motion, audio, or control scheme changed |
| `drop_in_failed` | Fatal failure, preserving current event |

Standard properties:

```text
resort
mode
trail_id
game_version
physics_version
course_version
asset_version
control_scheme
pointer_lock_state
quality_tier
reduced_motion
authenticated
load_stage
failure_code
run_end_reason
time_ms
score
ghost_enabled
submission_status
```

For load events, include `runtime_load_ms`, `asset_load_ms`, and aggregate downloaded bytes. For run results, include coarse performance metrics such as median FPS and minimum quality tier, not raw frame samples.

Primary funnels:

```text
opened → ready → started → control_activated → run_finished → run_submitted
```

Secondary funnels:

```text
leaderboard_viewed → ghost_selected → started → run_finished
```

Avoid raw user agent, IP, exact input traces, ghost bytes, or high-cardinality exception text as PostHog properties. Use enumerated failure codes plus an observability product for stack traces.

## 13. Package changes

Pin exact versions during the migration:

| Package | Version | Placement | Recommendation |
|---|---:|---|---|
| `three` | `0.169.0` | dependencies | Move from devDependencies; preserve r169 during parity work |
| `@types/three` | `0.169.0` | devDependencies | Match the migration runtime exactly |
| `zustand` | `5.0.14` | dependencies | HUD projection store only |
| `zod` | `4.4.3` | dependencies | Config, asset manifest, API payload validation |
| `@playwright/test` | `1.61.1` | devDependencies | Browser smoke tests |

The latest Three release is 0.185.1, but upgrading from r169 while decomposing a 2,645-line monolith would confound renderer changes with migration regressions. Upgrade in a separate ADR and visual/performance test cycle after parity. [Current Three release.](https://www.npmjs.com/package/three)

Do not add initially:

- React Three Fiber: the existing engine is imperative and performance-sensitive; introducing another renderer abstraction does not simplify the migration.
- Rapier/Cannon: replacing the tuned custom skier physics would change gameplay and undermine replay parity.
- Howler: the existing procedural Web Audio design is sufficient.
- Vitest: `node:test` already covers the pure TypeScript core.
- A third-party event emitter: a typed local emitter is trivial.

## 14. Migration order

### Phase 0 — define parity and competitive rules

1. Capture golden terrain samples and deterministic input traces from the current engine.
2. Define `time_trial`, `score_attack`, finish conditions, course versions, and submission limits.
3. Add performance budgets: runtime chunk size, first-ready latency, median FPS, memory, and asset bytes.
4. Keep the iframe production path untouched.

### Phase 1 — establish one source of truth

1. Expand `lib/drop-in.ts` into typed game profiles or move profiles to `lib/game/config/profiles.ts`.
2. Add the missing fall, relief, trail geometry, forest, weather, and visual values.
3. Validate profiles with Zod at build/test time.
4. Generate or temporarily embed the old engine profile block from that source if the iframe must remain during migration.

### Phase 2 — extract deterministic core

1. Port math, RNG, trail functions, terrain sampling, obstacles, physics, scoring, and fixed clock.
2. Remove Three.js from core types.
3. Add golden and determinism tests.
4. Ensure renderer cadence cannot change simulation results.

This is the most important phase for both maintainability and anti-cheat.

### Phase 3 — client shell and runtime lifecycle

1. Add `DropInClientBoundary` and `DropInGame`.
2. Introduce `GameRuntime`, `InputManager`, `UiBridge`, and disposal contracts.
3. Dynamically load the runtime after Start.
4. Render a minimal scene before porting all visual detail.

### Phase 4 — renderer parity

Port in risk order:

1. Terrain tiles and camera.
2. Skier.
3. Props and deterministic collision.
4. Gates, markers, ramps, and lift.
5. Weather, particles, tracks, and adaptive resolution.
6. WebGL context-loss recovery and disposal.

Stay on Three r169.

### Phase 5 — input and React HUD

1. Keyboard plus pointer-drag.
2. Pointer lock with rejection fallback.
3. React HUD and imperative minimap.
4. Touch thumb steering.
5. Optional calibrated tilt.
6. Standard gamepad mapping.
7. Accessibility and reduced-motion validation.

### Phase 6 — finite runs, ghosts, and leaderboard

1. Implement versioned run lifecycle.
2. Add recorder and binary ghost codec.
3. Add the migration and read-only leaderboard.
4. Add run-ticket and submission Route Handlers.
5. Start with sanity validation, then enable server re-simulation before ranking becomes consequential.

### Phase 7 — rollout

1. Select engine through an internal flag or percentage rollout.
2. Compare `opened → ready → started`, fatal errors, load time, FPS, and run completion against the iframe.
3. Maintain a per-session escape hatch to the legacy engine during early rollout.
4. Promote to 100% after parity and error-rate thresholds hold.

### Phase 8 — removal

1. Delete the iframe host behavior and `postMessage` bridge.
2. Delete `engine.html`, vendored Three.js, sync script, and static-engine drift tests.
3. Remove the `/drop-in/*` CORS header.
4. Replace `getDropInGameUrl()` with route/config APIs.
5. Run the Three r169-to-current upgrade as a separate change.

## Final decision summary

The target should remain a custom imperative Three.js game, not become a React-rendered scene. React is the application shell and accessible HUD; `GameRuntime` is the real-time owner; the pure fixed-step simulation is the shared trust boundary for browser play, deterministic tests, ghosts, and server validation.

The highest-value architectural move is not merely removing the iframe. It is extracting the deterministic simulation from Three.js and the DOM. That single boundary resolves the testing problem, makes normalized multi-device input practical, enables server-side anti-cheat, and prevents React from entering the game loop.
