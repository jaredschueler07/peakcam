# Drop In v2 — Design

> 2026-08-01 · Design lead: Claude (orchestrator) · Research: Claude Opus ×2 (terrain, rendering), Codex gpt-5.6-sol (architecture) — full reports in `./research/`.
> Direction chosen by Jared: **arcade physics + real resort identity + live-conditions integration**, production/enterprise grade.

## 1. Vision

When someone checks Portillo's snow report on PeakCam and clicks **Drop In**, they ski a
stylized-but-real Portillo — the actual Andean fall line above Laguna del Inca, the real
Roca Jack, under *today's actual conditions*. Not photoreal: the Alto's Odyssey /
Lonely Mountains tier of craft, wearing PeakCam's retro ski-poster identity.

The game is a marketing surface for the data product, and the data product makes the
game different every day. That loop is the whole point.

### Design pillars

1. **Real mountains, arcade heart.** Terrain baked from real DEMs; trails route where the
   real runs go; each resort's landmark on the horizon (Portillo: the yellow hotel +
   Laguna del Inca; Breckenridge: the Tenmile ridgeline + town glow; Heavenly: Lake Tahoe
   filling the view). The v1 physics feel — anisotropic carve friction, slope-projected
   gravity, natural air off convex lips — ports **intact**. It already feels right.
2. **Ski today's mountain.** Live PeakCam data (snow depth, 24h snowfall, cond_rating,
   NWS weather) selects the default weather preset, tunes the snow surface physics, and
   badges the start card. Powder day in real life = powder day in the game.
3. **Premium stylized, not photoreal.** Real lighting, post-processing, atmosphere, and
   sound design — inside the poster palette, never fighting it.
4. **Enterprise-grade build.** Deterministic TypeScript simulation core, tests and golden
   fixtures, perf budgets with device tiers, telemetry, server-validated leaderboards, CI.

### Non-goals (v2)

Multiplayer · terrain park/rails · character customization · more than 3 resorts
(but every per-resort input is data, so resort #4 is a bake away) · photorealism ·
WebGPU (revisit at postprocessing v7) · native apps.

## 2. Player experience

### Modes

| Mode | What it is | Leaderboard |
|---|---|---|
| **Free Ride** | v1's endless descent, polished. Weather cycling, lift laps, trick scoring. | No (personal best only) |
| **Time Trial** | One named real run, fixed seed/weather, gated start→finish. | Yes — per resort × trail |
| **Daily Line** | One shared daily challenge: server-issued seed + course, weather locked to that resort's real morning conditions. One ranked score per user per day. | Yes — global, resets daily |

Time Trial and Daily Line are finite, versioned run contracts (`physics_version`,
`course_version`) — the leaderboard prerequisite. Free Ride never submits.

### Scoring (deepen, don't bloat)

Keep: spins, airtime, gate combos, speed bonus. Add:
- **Grabs** — hold a key in air, style points scale with hold duration + rotation.
- **Clean-landing multiplier** — landing aligned with the slope multiplies the trick banked.
- **Near-miss** — grazing a tree/rock at speed feeds the combo meter.
- **Powder-line bonus** — sustained off-piste in fresh snow (powder days only, closing the
  live-data loop).
- **Combo meter with decay** — visible bank + timer; crash loses the bank, not the run
  (Free Ride). Tricks score only in Free Ride and Daily Line; in Time Trial, time is
  truth (no trick-to-time conversion — YAGNI).

### The identity moments (per resort)

- **Portillo** — start gate by the yellow hotel; Laguna del Inca teal below; va-et-vient
  platter as the lift; condors circling; Spanish-language trail signage; "Viento Blanco"
  weather name. Above-treeline starkness — rock, wind lines, no forest.
- **Breckenridge** — above-treeline bowls into lodgepole corridors; Tenmile Range
  silhouette; town lights far below at dusk; Imperial SuperChair.
- **Heavenly** — Lake Tahoe *is* the skybox to the north (the real Gunbarrel view);
  Jeffrey pine forest density; gondola; California/Nevada line marker as an easter egg.

### Onboarding

First run auto-starts in Free Ride on the resort's easiest real run, three timed tooltip
prompts (carve → tuck → jump), skippable. No walls of text. Pointer lock is an
*enhancement offered after* the first successful carve, never a gate.

## 3. Architecture (decided)

Full detail: `research/codex-architecture-report.md`. Summary of the decisions I'm
adopting, including conflict resolutions:

### 3.1 The iframe dies; the simulation core is the trust boundary

- Server Component route (validation/metadata) → `DropInClientBoundary` ("use client",
  `next/dynamic ssr:false`) → `DropInGame` (poster shell, React HUD) → on Start,
  `import("@/lib/game/runtime/createGame")` loads three.js + runtime. Two-level code
  split: the main site never loads game code; the route loads a small shell; the engine
  loads on intent.
- **`lib/game/core/` + `physics/` + `terrain/` are pure TypeScript** — no React, DOM,
  three.js, or network imports. Fixed-step 120 Hz simulation (kept from v1),
  `InputFrame`-driven, seeded RNG, deterministic. Same code runs in the browser, in
  `node:test`, and in the server-side run validator.
- React owns the runtime's *lifetime*, never its frames. HUD reads a Zustand vanilla
  store updated at 10–20 Hz by a `UiBridge`; discrete events (crash, gate, finish) go
  through a typed emitter. Minimap is an imperatively-drawn canvas.
- Input: adapters (keyboard / pointer-drag / pointer-lock / touch / tilt-opt-in /
  gamepad) normalize into one `InputFrame` per fixed step. **Pointer lock is a
  progressive enhancement** — requested only on direct gesture, all rejection paths
  caught and reported, game fully playable without it. This retires the
  `WrongDocumentError` class of failure found in v1.

### 3.2 Version sequencing (conflict resolution)

Codex: stay on three r169 during migration parity. Rendering: pin three 0.185.1 +
postprocessing 6.39.4 (peer-dep ceiling `< 0.186`). **Both:** migrate at r169 with
golden-fixture parity, then bump to the 0.185.1 + 6.39.4 matched pair as the *first
commit of the polish phase*, with its own visual/perf check. Never mix the migration
and the upgrade in one change.

### 3.3 Terrain: real DEM macro + procedural micro (my synthesis)

The DEM gives the mountain its true shape at 4–6 m/px; that's the identity. But 4–6 m
is too coarse for gameplay texture — v1's chatter, rollers, and micro-bumps come from
fine noise. So `terrainHeight(x,z)` becomes:

```
height = bicubic(heightfield, x, z)            // real mountain, baked
       + microDetail(x, z)                     // seeded fbm, amplitude ~0.3–0.8 m,
                                               // wavelengths < DEM cell size only,
                                               // damped on groomed trail corridors
```

Deterministic (seeded), pure, and shared by mesh, physics, props, minimap, and the
server validator — preserving v1's single-height-function invariant.

- **Bake pipeline** (`scripts/bake-resort.ts`, run manually, output committed): AWS
  Terrain Tiles terrarium z14 → 1024² heightfield; Copernicus GLO-30 COG for Portillo
  (better morphology than SRTM there — measured). Boxes: 4096 m Portillo, **6144 m**
  Breck/Heavenly. 0.1 m vertical quantum.
- **Runtime format** (conflict resolution — terrain report suggested PNG16, Codex
  suggested binary): **quantized `.u16` little-endian binary + JSON sidecar, served
  brotli-precompressed** (~1.15 MB/resort). Rationale: browser PNG decode via canvas
  readback is 8-bit — it would silently destroy the 16-bit precision. The PNG16 stays
  as a committed, inspectable artifact of the bake.
- **Trails/lifts**: Overpass API (GET + `out geom`), RDP 6 m, delta-encoded JSON
  (3.5–18 KB/resort), draped onto the heightfield at load. Real names, real difficulty,
  `difficultyConvention` carried (a Chilean "advanced" ≠ Colorado "advanced").
- **Licensing** (shipped in a Credits panel + assets LICENSE file): USGS/Tilezen line,
  the prescribed Copernicus "produced using…" line, and OSM ODbL attribution; the baked
  trails JSON is treated as an ODbL Derivative Database (extraction script + JSON
  published under ODbL). FABDEM explicitly rejected (non-commercial license).

### 3.4 Rendering (decided stack)

WebGL2 · three 0.185.1 + postprocessing 6.39.4 (matched pair) · MeshStandardMaterial +
`onBeforeCompile` snow (triplanar boot-generated detail normal → world-hash glint →
fresnel rim → wrap-diffuse with **blue shadow tint** — the four-layer stack, cheapest
first) · CSM shadows (3 cascades desktop / 1 mobile) · upgraded gradient-dome sky
(3-stop + cloud band + sun halo; physical sky rejected — fights the poster palette) ·
custom height fog with view-direction tint · trail deformation via ping-ponged RG16F
render target (~60 m window; tracks kill glint + read smoother/bluer) · single
EffectPass post chain: restrained Bloom → **32³ poster-palette LUT** → Vignette → SMAA →
speed-scaled ChromaticAberration; DoF on menus only · instanced props with 3 LOD pools +
billboard forest beyond 150 m (boot-baked atlas) + per-instance color jitter · GPU
particle spray/snowfall (analytic, no readback) · FOV kick + damped shake + speed lines
off one shared speed uniform.

Assets philosophy: procedural textures (DataTextures, boot-baked atlases, generated LUT)
everywhere possible; authored assets reserved for the rider model and landmark
silhouettes (meshopt glTF + KTX2/UASTC when used). Hard ceiling: **< 64 MB texture
memory on mobile Safari** (tab-crash cliff, not a slowdown).

Performance: hand-rolled quality ladder (rungs drop post/cascades/glint before
resolution; pixelScale last), seeded from device signals, corrected by the existing
closed-loop FPS controller. Budgets: <150/<80 draw calls, <400k/<150k tris,
16.6/33.3 ms frames. p50/p95 frame time + final rung reported once per run to PostHog.

### 3.5 Audio direction

Layered: wind bed (speed + altitude scaled) · carve/edge noise layer (surface-dependent:
powder hiss vs hardpack scrape) · impact/landing thumps · UI/trick stingers · sparse
ambient per resort (wind gusts at Portillo, lift hum, birds in Heavenly's pines).
Real CC0/licensed samples (streamed `.ogg`, loaded post-Start, post-gesture) *layered
over* the existing procedural WebAudio graph, which remains as the zero-download
fallback and the reactive glue (it already tracks speed/carve/air state).

### 3.6 Live conditions (`ConditionsSnapshot`)

Fetched server-side in the route (same `lib/supabase.ts` read path as the rest of the
site — no client fetching), passed as props, embedded in the run ticket for Daily Line.

| Real data | In-game effect |
|---|---|
| `snow_24h ≥ 8"` (the site's powder threshold) | "POWDER DAY" start-card stamp; powder surface: deeper spray, softer landings, −top speed, powder-line bonus zones active |
| `cond_rating` poor/icy | Firm surface: +top speed, twitchier steering, longer skid, ice sheen + scrape audio |
| NWS: snowing / windy | Snowfall weather preset default; wind drives particle drift + audio bed |
| Base depth | Rock/obstacle exposure density (thin cover = more exposed hazards) |
| No data (offseason/gap) | Deterministic per-resort default; card says "classic conditions" |

Physics effects are quantized into a small enum (`surface: powder|packed|firm|ice`,
`weather: 0..n`) stamped into `course_version` inputs — so leaderboard runs stay
comparable and replays deterministic.

### 3.7 Leaderboards, ghosts, anti-cheat

Codex's design adopted wholesale: `drop_in_runs` table (migration 012) with
accepted/rejection_code, versioned rows, partial leaderboard index; **no client INSERT
policy** — a Route Handler validates and inserts with the service key; server-issued
HMAC run tickets (nonce, seed, versions, expiry); binary ghost format ("PCGH", ~10 Hz
delta keyframes + periodic absolute sync frames, ~25–32 KB per 3-min run, stored as
`bytea`); validation ladder: baseline sanity bounds at launch → **server re-simulation
of the input trace through the same pure core** before rankings become consequential.
Client-signed payloads explicitly rejected as security theater.

### 3.8 Analytics

Codex's PostHog taxonomy adopted: `drop_in_opened → load_started → ready → started →
control_activated → run_finished → run_submitted` funnel + pointer-lock-result,
leaderboard/ghost events, settings changes. Standard props include quality_tier,
control_scheme, versions, coarse perf metrics. Never per-frame/per-input events.

## 4. Testing & CI

- `node:test` via tsx (house pattern; no vitest). Expand glob for `lib/game/**`.
- **Golden parity fixtures captured from v1 before migration**: terrain samples, input
  traces → expected state hashes/final score. The migration has a parity contract.
- Determinism suite: thousands of fixed steps, identical under different frame pacing —
  catches `Math.random()`/wall-clock leaks into simulation.
- Unit surface: PRNG sequences, heightfield decode + sampling continuity, trail
  drape, physics bounds, scoring, replay codec round-trips, run validator
  accept/reject fixtures, input dead zones/rising edges, disposal via fakes.
- Playwright (Chromium; WebKit periodically): route renders sans iframe, keyboard-only
  play, forced pointer-lock rejection stays playable, touch viewport shows controls,
  WebGL-unavailable error path, clean unmount, main-site routes never fetch game chunks.
- CI: `lint → test → build → playwright`, traces on failure.

## 5. Rollout

1. v2 develops behind the existing route with an engine flag (`?engine=v2` → internal
   default → percentage rollout).
2. Promotion gates: funnel parity or better vs v1 (`opened→ready→started`), fatal error
   rate < 0.5%, p75 ≥ 55 fps desktop / ≥ 30 fps iPhone-12-class, first-ready < 3 s on
   4G, per-resort payload ≤ 3.5 MB brotli (engine chunk + terrain pack).
3. 100% → delete `engine.html`, vendored three, sync script, drift tests, `/drop-in/`
   CORS header; three-upgrade ADR already done in polish phase.
4. Marketing beat: "Ski today's conditions" — the Daily Line launch is the announcement.

## 6. Open risks

| Risk | Mitigation |
|---|---|
| Real terrain is less "designed" than v1's tuned procedural runs — real slopes have flats and awkward benches | Corridor selection favors sustained fall lines (OpenSkiMap elevation profiles guide the pick); micro-detail layer + gate placement do the game-design work; anti-stall assist already exists in the ported physics |
| DEM resolution disparity (Portillo 30 m vs US 10 m) reads as quality gap | Portillo uses Copernicus + slightly stronger micro-detail amplitude; its above-treeline starkness hides DEM softness better than forests would |
| Feature scope creep across 8 phases | Each phase lands behind the flag, is independently shippable, and has explicit acceptance gates (see PLAN.md) |
| Supabase auth friction on leaderboards | Anonymous runs allowed (nickname, no persistence guarantees); auth upsell only on "claim this score" |
