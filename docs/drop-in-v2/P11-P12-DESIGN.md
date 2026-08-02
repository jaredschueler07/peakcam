# Drop In v2 — Phases 11 & 12: Graphics & Physics Foundation

> Design approved 2026-08-01 (Jared, via brainstorming session). Companion to
> `DESIGN.md`/`PLAN.md`; this document extends the phase plan with two new phases
> and re-sequences the remainder. Source research: a web-FPS architecture study
> (WebGPU / Wasm / WebTransport); this design adopts its architecture *principles*
> and explicitly rejects the implementations that conflict with Drop In's
> deterministic core (see §6).

## 1. Goals

1. **Visual fidelity uplift** — modern renderer ceiling (WebGPU), better snow,
   shadows, and weather at the top quality rungs.
2. **Performance headroom** — compressed GPU assets, zero-allocation frame path,
   shader pre-warm, thermal governance; directly de-risks the Phase 10 device matrix.
3. **Physics feel** — carving, air control, and per-surface response that make
   conditions *feel* different, inside the deterministic TS core.
4. **Longevity** — land on three.js's long-term path (WebGPURenderer + TSL), not a
   bespoke engine; keep the codebase maintainable by one owner + agents.

Non-goals: real-time multiplayer, GPU-driven culling/clustered lighting, replacing
the simulation with Wasm physics (§6).

## 2. Phase 11 — Renderer & Asset Modernization

### 2.1 WebGPURenderer + TSL migration

- Swap `lib/game/rendering/Renderer.ts` backend from `THREE.WebGLRenderer` to
  `WebGPURenderer` (`three/webgpu`). The class already accepts an injected
  `options.backend`; keep that seam so tests can inject either.
- WebGL2 fallback is **automatic** in three's WebGPURenderer (it selects the
  WebGL backend when WebGPU is unavailable). One codebase, two backends. A
  `?gfx=webgl` query override forces the fallback for debugging/Playwright.
- `renderer.init()` is async — the runtime start sequence gains an awaited
  renderer-ready step before the first frame (loading screen already exists).
- All custom materials/shaders port to **TSL node materials** (compile to WGSL and
  GLSL from one source):
  - Snow material stack (wrap-diffuse, blue shadow tint, rim, glint, triplanar
    detail) → TSL nodes. Fidelity uplift at high rungs: view-dependent sparkle
    (glint density by pixel footprint), stronger forward-scatter approximation.
  - Sky (3-stop gradient + cloud band), player-relative height fog (**preserve the
    Phase 6 lesson: fog reference must be player-relative, never absolute Y** —
    real terrain sits at ~3km).
  - Terrain, props, skier, weather particles, spray, tracks.
- Post chain: the `postprocessing` npm package is WebGL-only → **remove it**.
  Rebuild the poster look on three's native node-based `PostProcessing`:
  bloom, poster LUT, vignette, and chromatic aberration as TSL passes. Target is
  *visual parity first* (validated by the canvas-luminance e2e guard + screenshot
  review round), uplift second.
- CSM shadows: port `CsmShadows.ts` to three's node-pipeline `CSMShadowNode`
  (the WebGPU-native cascaded-shadow path; verify exact addon export against the
  pinned three 0.185.x during planning). Shadow quality (resolution/cascade
  count) becomes a quality-ladder dimension.
- `QualityController` 5-rung ladder is preserved; rung definitions gain
  WebGPU-only features (sparkle, denser weather, higher shadow res) that
  degrade cleanly on the WebGL backend.

### 2.2 Asset compression

- Textures → **KTX2 / Basis Universal** (UASTC for normal-ish data, ETC1S for
  albedo). `KTX2Loader` + transcoder wasm served from `public/game/`. Transcodes
  to ASTC on Apple/mobile, BC7 on desktop — VRAM stays compressed on-GPU (the
  iPhone Safari tab-kill mitigation).
- Meshes (if/when GLB assets appear) → **meshopt**; loaders already isolated under
  `lib/game/rendering/loaders/`.
- Bake pipeline (`scripts/bake-resort.ts`) extended to emit KTX2 where it emits
  textures today; committed assets under `public/game/` stay within BUDGETS.md
  size lines (update the budget table with per-asset ceilings).

### 2.3 Hot-path performance

- **Shader pre-warm**: `renderer.compileAsync(scene, camera)` for every quality
  rung's material set behind the loading screen, before Start is enabled. Kills
  first-encounter pipeline-compilation hitches (the research's biggest web-graphics
  risk, and three does it in one call).
- **Zero-allocation audit** of the per-frame path: spray/particles/tracks/weather
  must recycle from pre-allocated pools; no per-frame `new`, closures, array
  methods that allocate, or string building in `GameRuntime.frame`. Add an
  allocation smoke test (heap-delta sampling over N frames in Playwright) as a
  budget guard.
- **Thermal/frame governor**: extend `QualityController` — sustained frame-time
  regression (rolling p75 over budget for >5s) steps the ladder down one rung;
  recovery hysteresis steps back up after sustained headroom. Telemetry events
  already exist (Phase 6 perf telemetry) — governor decisions get logged there.

### 2.4 Explicitly deferred (documented future stages, not in scope)

- **SharedArrayBuffer / worker sim**: needs COOP/COEP, which would break YouTube
  cam embeds and cross-origin iframes site-wide; route-scoped isolation only if
  profiling ever shows main-thread contention.
- **OffscreenCanvas render worker**: revisit only with profiling evidence.
- Clustered Forward+ lighting, HZB/GPU culling, WebTransport: not applicable
  (one directional light, few hundred draws, no realtime netcode).

## 3. Phase 12 — Physics Feel (deterministic core)

### 3.1 physicsV2 model, flag-gated

- New `physicsV2` flag in the zod config source of truth (`lib/game/config/`),
  versioned like all sim-affecting config. **Flag off ⇒ bit-identical legacy
  behavior**: all existing parity fixtures and the 374-test suite stay green
  untouched.
- Model upgrades (all in pure TS, fixed-point-safe math per `core/math.ts`
  conventions, 120Hz fixed step):
  - **Carve dynamics**: steering input → edge angle; grip is a curve over edge
    angle + speed + surface, replacing scalar friction. Produces hold-a-carve
    behavior and speed-bleed on skid.
  - **Air control & landing**: limited in-air attitude authority; landing
    absorption window keyed to impact normal velocity (clean landing vs. speed
    check), feeding scoring events.
  - **Surface response**: Phase 9's surface enum (powder/packed/ice/spring) maps
    to distinct grip curves, drag, spray magnitude, and turn-in latency —
    conditions become gameplay, not just a poster stamp.
- Renderer/audio consume the same event stream (`UiBridge`/`RuntimeAudio`
  integration points from Phase 8 handoff notes) — carve intensity drives spray
  and edge audio without new coupling.

### 3.2 Determinism & competition integrity

- New golden fixtures captured for physicsV2 (same byte-deterministic capture
  harness as Phase 0); cross-platform replay test matrix mirrors
  `real-determinism.test.ts`.
- Run tickets/ghost headers already carry config version — server re-simulation
  validates with whichever model version the run declares. Leaderboards segment
  by config version (existing Phase 8 design covers this; verify, don't rebuild).
- Ghost playback of v1-model runs remains valid (replay uses recorded transforms,
  not re-simulation, per the PCGH codec).

## 4. Sequencing, gates, and process

Order: **Phase 8.3/8.4 → Phase 11 → Phase 12 → Phase 10.** Rationale: modes and
leaderboards are renderer-independent and unblock playtesting; the Phase 10 device
matrix and rollout gates must validate the *final* renderer and physics.

Gates per phase (same regime as PLAN.md):

- Phase 11 exit: visual parity screenshots approved in a real browser (budget 1–2
  orchestrator fix rounds — sandboxed agents cannot see rendering bugs), canvas
  -luminance e2e green on both backends, Playwright suite green with `?gfx=webgl`
  and default WebGPU (Chrome), BUDGETS.md updated and met, zero-allocation guard
  green, no `postprocessing` in the dependency tree.
- Phase 12 exit: legacy parity suite green with flag off; physicsV2 fixture suite
  green; Jared feel-check playtest sign-off (extends the existing fall-line gate).
- Tooling: Metal toolchain (`xcodebuild -downloadComponent MetalToolchain`) for
  GPU traces during Phase 11. WebKit-from-source and `webgpu-utils` are **not**
  used (Safari 26/STP ship WebGPU; three owns the WebGPU layer).

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| TSL post chain can't hit exact poster-look parity | Parity-first porting order (LUT → vignette → bloom → CA); screenshot diff review round; luminance e2e bounds |
| WebGPURenderer regressions vs r185 WebGL path | Backend override flag; Playwright runs on both backends; keep three at the 0.185.x/0.186 ceiling already pinned in Phase 6 |
| iOS Safari WebGPU quirks (limits, memory) | Query `adapter.limits` via three; KTX2 keeps VRAM compressed; quality ladder floor rung is WebGL-safe; device matrix in Phase 10 |
| physicsV2 breaks determinism subtly | Flag-gated; byte-deterministic fixtures on the new model; cross-platform replay tests; server re-sim validator |
| Scope creep toward the research's full FPS stack | §2.4/§6 record the deliberate rejections and their revisit conditions |

## 6. Rejected alternatives (recorded for posterity)

- **Custom Rust/Wasm engine + Jolt Physics**: discards the deterministic pure-TS
  sim that ghosts, HMAC run tickets, and server re-simulation are built on;
  multi-week rebuild for physics needs (one skier, analytic heightfield) far below
  Jolt's design point. Revisit only if the game ever needs many interacting rigid
  bodies.
- **Hand-rolled WebGPU renderer (webgpu-utils)**: rebuilds Phase 4/6 (articulated
  skier, weather, CSM, post chain) by hand for control the game doesn't need;
  three's TSL provides the WGSL path with WebGL fallback for free.
- **WebTransport/QUIC netcode**: no realtime multiplayer exists or is planned;
  ghosts are asynchronous by design.
