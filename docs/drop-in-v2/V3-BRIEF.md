# Drop In v3 — Overhaul Brief (handoff prompt)

> Paste everything below the line into a fresh coding-agent session opened at
> `~/projects/peakcam` (or a clean clone of `jaredschueler07/peakcam`). Read
> `docs/drop-in-v2/BACKGROUND.md` first if you want the story; the brief is
> self-contained.

---

Overhaul **Drop In**, the arcade ski-descent game inside PeakCam (Next.js + TypeScript,
three.js r185 with WebGPU + WebGL backends), into something that looks, reads and *feels*
like a real descent of a real mountain. The spec below is fixed. Your build will be
played on camera on a Mac Mini (Apple Silicon, WebGPU) and on a mid-range Android phone
(WebGL), and judged in about sixty seconds of screen time on how it looks and how it
feels to ski. Go all out — but go all out *inside this codebase*, not beside it.

## Context you must absorb before touching anything

- The game is `lib/game/**` (≈28k lines of TypeScript), `components/drop-in/**`, and the
  route `app/resorts/[slug]/drop-in`. Read `docs/drop-in-v2/DESIGN.md`, `STATUS.md`,
  `TERRAIN-SAMPLING.md`, `BUDGETS.md`, and `P2-GATE-VISUAL-FIXES.md` before planning.
- `public/drop-in/engine.html` is the **v1 iframe prototype**. It is still the default
  engine on the public route; v2 renders only with `?engine=v2`. **Do not improve v1.**
  Your deliverable is v2 becoming good enough to be the default, and v1 being deleted.
- `lib/game/{core,physics,terrain}` is a **pure-TypeScript, deterministic, fixed-step
  120 Hz simulation** with no React/DOM/three/network imports (ESLint import fences
  enforce this). The same code runs in the browser, in `node:test`, and in the
  server-side run validator (`lib/game/server/validate-run.ts`) that re-simulates
  submitted input tapes for anti-cheat. **Determinism is non-negotiable.** Any physics
  or terrain change you make must remain bit-reproducible from a seed + input tape.
- Physics today: v1 model (`integrator.ts`) is what players feel; `integrator-v2.ts`
  (carve/air/landing/surface) is merged flag-off behind `?phys=v2`, both on one core
  (`integrator-core.ts`) with a `CarveModel` seam. Golden fixtures pin both
  (`lib/game/physics/__fixtures__`, `integrator-golden.test.ts`).
- Terrain today: real DEMs baked per resort by `scripts/bake-resort.ts` (Breckenridge
  USGS 3DEP 1 m, Heavenly 3DEP 10 m, Portillo Copernicus GLO-30; GDAL, UTM per resort;
  assets in `public/game/terrain/*.br`, ~1.1 MB/resort), sampled by a bicubic
  heightfield with analytic normals and corridor-damped micro-detail
  (`real-heightfield.ts`). Coordinate convention **gameZ = −assetY**. Six curated OSM
  runs per resort, real lift lines, landmarks, a pre-baked 30 km far-field wedge mesh.
- Leaderboards are versioned run contracts. If you change anything a run's outcome
  depends on, bump `PHYSICS_VERSION` and/or `COURSE_VERSION` so old boards segment.
  Never silently invalidate existing scores.
- Test commands: `npm test` (node:test, ~800 tests), `npx tsc --noEmit`, Playwright e2e
  against a **production build** (`next build && next start -p 3100`; default project
  pins `gfx=webgl` because SwiftShader renders WebGPU black; `PLAYWRIGHT_WEBGPU=1
  --headed` for the hardware project). The e2e suite includes canvas-luminance guards
  pinned to `?weather=0` — keep them and re-baseline deliberately, never loosen them.
- Dev levers already live: `?gfx`, `?nopost`, `?snowdbg`, `?csmdbg`, `?treedbg`,
  `?cam`, `?weather`, `?phys`, `?e2espawn`. Use them to bisect instead of theorising.
- **Operating truth from the last four sessions: unit tests and sandboxed agents cannot
  see rendering bugs.** Every visual change gets played in a real browser with real GPU
  and screenshotted at the *failing* view before it is called done.

## Requirements

1. **Trails that are the real trails.** Today six curated OSM polylines per resort route
   the runs and the rest of the mountain is skiable ungroomed heightfield. Rebuild the
   trail layer so that a skier who knows Breckenridge recognises Peak 8 and the Imperial
   bowls, someone who knows Heavenly recognises Gunbarrel and the Nevada side, and
   Portillo reads as Roca Jack and the Plateau above Laguna del Inca. That means: the
   full named-run network from OSM (`piste:type=downhill`, with `piste:difficulty` and
   `name`), correct trail widths and grooming state per difficulty, trail edges that are
   *cut* into the terrain (a groomed run is a corridor with a bank, cat-track berm and
   tree-line, not a painted stripe), trail signs at junctions with real names and
   difficulty markers, boundary ropes, and off-piste that is genuinely slower and
   heavier than groomed unless it's a powder day. Runs must be selectable by name for
   Time Trial and must carry real top/bottom elevations in the HUD. Bake it; do not
   compute it at runtime.
2. **Topography you can read at speed.** The heightfield is real but the near-field
   surface is too smooth to sell scale. Add baked, seed-stable meso-detail: moguls on
   ungroomed blacks, wind-lip and cornice geometry on ridgelines, rock bands where the
   DEM slope exceeds the angle of repose, tree wells, and corduroy on freshly groomed
   runs (visible in the snow normal map, not just a texture tile). Sightlines matter: a
   first-time player must be able to see where the run goes and where the next
   junction is. Landmarks (yellow hotel, Laguna del Inca, Tenmile ridgeline, Lake Tahoe)
   stay and get real silhouettes. Far field stays baked. The whole terrain budget per
   resort stays under 3 MB brotli.
3. **Lifts that are the real lifts.** Real lift lines already exist as polylines. Make
   them real lifts: correct type per OSM `aerialway=*` (chair with correct chair count,
   gondola, platter/va-et-vient at Portillo), tower spacing from the data, catenary sag,
   chairs that move at a plausible line speed and *can be ridden* — skiing into the
   loading zone at a base station boards you, rides you up with the camera on the
   chair, and drops you at the top station on the correct unload ramp. That is how
   Free Ride laps work; delete any teleport-to-top mechanic. Lift names show on
   stations and on the minimap.
4. **Physics with weight, still arcade, still deterministic.** Ship physicsV2 as the
   default and make it excellent. Edges must bite progressively with a controllable
   slide and counter-steer; a tuck must matter; skidding across ice must sound and feel
   different from carving packed powder; landing aligned with the fall line must be
   rewarded and landing flat must cost speed and stability; deep powder must slow and
   float you with spray, groomed must be fast and quiet. Add terrain-reactive camera
   (FOV punch on speed, roll on carve, shake on hard landings) and a skier rig whose
   pose reads the edge angle, the tuck and the air. **Constraints:** stay on
   `integrator-core.ts`, keep the fixed 120 Hz step and seeded RNG, extend the golden
   fixture set for every new surface/behaviour, keep v1 parity fixtures passing under
   `phys=v1`, bump `PHYSICS_VERSION` to 2, and make the server validator accept and
   re-simulate v2 tapes. If it doesn't feel good on a keyboard *and* on a phone with
   touch, nothing else here matters.
5. **Live conditions drive more than the badge.** `buildConditionsSnapshot` already
   maps PeakCam data to a weather preset and a surface enum. Extend it so 24h snowfall
   sets powder depth off-piste (with a corresponding spray/float response), NWS wind
   sets wind-affected snow on exposed ridgelines and drift particles, temperature vs.
   time-of-day sets ice on north-facing groomers in the morning, and visibility drives
   the fog envelope. Daily Line locks all of it to the resort's real morning snapshot.
6. **Graphics that look shipped, in the poster palette.** GTAO, physical sky, godrays,
   CSM and KTX2 snow textures exist — use them properly rather than adding more. Fix
   the two known Phase 10 blockers (rung captured at construction so the thermal
   governor can't shed SkyMesh/textures on step-down; no AA on WebGPU rungs 0/1). Add
   real trees (CC0 conifer/pine impostors with species per resort: lodgepole at
   Breckenridge, Jeffrey pine at Heavenly, none above treeline at Portillo) placed from
   OSM `natural=wood` and the DEM treeline, real rock, time-of-day and alpenglow
   presets, ski tracks that persist in the snow and deform the normal map, and spray
   that reads as snow, not smoke. The WebGL fallback must render the same scene one rung
   lower, never a different scene. No untextured primitives anywhere in view.
7. **Sixty locked frames per second** at rung 4 on the Mac Mini under WebGPU with the
   full trail network, lifts, trees and weather on screen, and a stable 30+ at rung 1
   on the Android phone under WebGL. `BUDGETS.md` is the contract. Profile with the
   existing perf telemetry, fix what drops, keep the heap-growth guard (<2 MB/10 s) and
   the zero-allocation frame path.
8. **Audio through the existing engine.** Edge chatter that tracks edge angle and
   surface, wind that tracks speed and exposure, lift bull-wheel hum at stations,
   landing thumps, trail-sign clatter on collision, all mixed under the CC0 sample set
   already in `public/game/audio`. No new hotlinked audio; new samples must be CC0 with
   provenance in `CREDITS.md`.
9. **HUD and structure.** Keep the React HUD, the modes (Free Ride, Time Trial, Daily
   Line), tickets, ghosts and leaderboards exactly as they work today. Add the run name
   and elevation readout, a lift-ride overlay, a per-junction trail-sign prompt, and a
   results card that names the run and the conditions it was skied in. One line of
   on-screen control instructions; playable within ten seconds of load; pointer lock
   stays a progressive enhancement, never a gate.
10. **Rollout, not just a branch.** Finish Phase 10: server-side surface derivation
    (the client-chosen `surface` claim is a known leaderboard hole — derive it on the
    server from the conditions snapshot), CI running unit + e2e on every PR, an
    accessibility pass on the shell and HUD, then flip v2 to the default route, delete
    `public/drop-in/engine.html` and the iframe host, and remove `?engine=v2`. Migrate
    or version-segment existing leaderboard rows; do not drop them.
11. **QA it by actually skiing it.** Full runs on all three resorts, all three modes,
    both backends, keyboard and touch. Board and ride every lift. Confirm the
    server validator accepts a legitimate v2 run and rejects a tampered tape. Confirm
    the luminance guards pass at `?weather=0` on both backends and that a real-GPU
    screenshot at 750 ms, 5 s and 30 s into a run looks like a shipped game at each
    resort. Fix what breaks.

## How to work

- Plan first, in `docs/drop-in-v2/V3-PLAN.md`: phases, each with a gate that a human can
  verify in a browser. Bake pipeline changes come before rendering changes; physics
  changes come with fixtures in the same commit.
- Small branches per phase off `main`, `--no-ff` merges into `feat/drop-in-v3`,
  conventional commit messages, `git diff main...HEAD --stat` checked before every
  merge. Do not touch anything outside the game, the route, the bake scripts and their
  docs without saying why.
- Log every session in `docs/drop-in-v2/SESSION-<date>.md` in the same shape as the
  existing logs: what shipped, what needs Jared, what was learned. Update `STATUS.md`.
- Anything that needs a human (Vercel env vars, Supabase migrations, a feel-gate
  playtest, a licence decision) goes in a **Needs Jared** list — keep going on
  everything else.
- $0 on new tooling or assets. CC0 / public-domain / already-licensed only, with
  provenance recorded.

Work autonomously. Do not ask for anything until a phase gate is ready to be played.

**DONE when:** a first-time player loads `/resorts/breckenridge/drop-in` with no query
string, is skiing a recognisable Peak 8 within ten seconds, can ride the Imperial
SuperChair back up, feels the difference between corduroy and yesterday's powder, holds
60 fps on the Mac Mini and 30+ on a phone, submits a Daily Line run that the server
re-simulates and accepts, and the v1 engine no longer exists in the repo.