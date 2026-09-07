# Snowboard and snow handling — physics contract 3

Integrates the earlier snowboard strategy into current main's signed-condition,
input-tape replay architecture. Keeps the newer full-mountain terrain and physical
lifts. Physics remains pure TypeScript at 120Hz. PHYSICS_VERSION advances from 2
to 3; COURSE_VERSION remains 3. Historical v1 fields and trajectories must remain
bit-identical. Updated v2 numeric fixtures intentionally pin the new contract;
snowboard fixtures cover both stances on five surfaces.

## Player behavior

- Gear selection chooses actual ski or snowboard physics. Regular and Goofy use
  the same directional controls, with opposite visual stance and duck bindings.
- Broader heel turns, tighter toe turns, a camera swing up to 15 degrees (disabled
  by reduced-motion preference), charged ollies with up to 25% more pop, spins,
  and hold/release grabs. Minor opposing downhill catches stumble for 400ms;
  high-energy catches wipe out for 1.4 seconds. Grabs score only on safe landings.
- Powder plowing uses quadratic drag with signed snow depth controlling immersed
  area; groomers grip predictably; ice drifts and takes longer to brake; slush
  slows the rider. Surface selection is available in Free Ride. Live surfaces
  follow groomed corridors, fresh off-piste snow and shaded morning ice. Audio
  uses the same local surface decision.
- Ground collision height is the canonical terrain sampler; the previous extra
  powder height pad is removed. No mutable snow/track collision surface exists.
- A bounded starting assist operates below 2.5m/s, helping through shallow terrain
  wrinkles up to eight degrees without propelling uphill on steeper faces. Tuck
  reduces air resistance rather than adding the former constant motor force.
- Server tickets sign rider mode and stance; startup/restart compatibility checks
  reject mismatched equipment, surface or conditions. Server replay reconstructs
  exactly that configuration. Changing gear returns to Free Ride before selecting
  a new ranked mode. Existing version-filtered boards begin a new physics cohort.

## Verification and artifacts

`npm test`, `npx tsc --noEmit`, and a production build are release checks. Tests
include full ski/snowboard runs on all three real resorts using keyboard and touch
inputs, submission acceptance and tamper rejection, v1 bit equality, snowboard
golden traces, controlled surface comparisons, and mobile browser hold/release
and heap checks. The unchanged Daily Line input tape finishes under frozen weather.

Controlled tests start at 20m/s on flat snow: braking to below 1m/s takes roughly
8.1m powder, 11.9m groomed and 31.3m ice. These are gameplay tuning measurements,
not claims of a calibrated biomechanical simulator.

Local ignored artifacts are under `artifacts/drop-in-forest/snow-v3/`: screenshots,
WebM clips and debug snapshots for powder/groomed/ice, desktop WebGPU and mobile
backends. Recordings use scripted keyboard play in headed Chromium; they are not
human feel approval or measurements on physical phone hardware. Controlled metric
comparisons use identical fixed-tick inputs; video timing follows browser frames.

Mobile keeps the batched terrain mesh, caps DPR at 1.5 and shader quality at 2,
and omits the articulated rider's separate shadow draws. Gate poles share one
instanced draw per pair. These address resource overruns observed in the mobile
recording; they do not change collision geometry. The mobile governor cannot
upgrade beyond its resource ceiling. The source review should scrutinize physics,
configuration/signing/replay consistency and these bounded rendering changes.

## Completed checks (2026-09-07)

- `npm test`: 1,353 passed, zero failed. All 68 historical v1 traces unchanged;
  170 snowboard golden scenarios added. Full ski/snowboard replay and HTTP
  acceptance/tamper checks cover the three committed resorts.
- `npx tsc --noEmit`: passed. Production `npm run build`: passed.
- Headed browser checks: desktop/mobile locker passed; mobile snow hold/release
  and both rider heap checks passed. Retained growth over 10 seconds after GC:
  skis 312,437 bytes, snowboard 404,930 bytes (budget 2,097,152).
- Mobile WebGPU sampled active frames: 74–78 draws, 141,500–143,048 triangles,
  approximately 53.3 MB texture allocation. These are Pixel 7 viewport emulation
  on the host GPU, not measurements from a physical Pixel 7.
- Production WebGPU gameplay recording: no browser errors, with charged ollie,
  grab, landing and braking snapshots. Local clip:
  `artifacts/drop-in-forest/snow-v3/packed-webgpu/gameplay.mp4`.
- Autoreview: `autoreview --mode local --prompt-file docs/reviews/snowboard-snow-v3.md`
  completed seven bounded review passes at its default P0 scope with no actionable
  findings; TruffleHog clean. A subsequent integration-test adjustment excludes
  uniform-color gate poles from the existing scenery vertex-color assertion.
