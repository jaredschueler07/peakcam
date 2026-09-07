# Breckenridge adaptive terrain acceptance — 2026-09-07

Prototype code: fc85b13912c967f1a9f19a6f4a6f59987dda6892, deployed to the public
production alias with opt-in `terrain=adaptive`. Normal visits retain uniform
geometry. No physics/source/version changes.

## Engineering result

One preallocated near mesh concentrates 1m spacing under the rider and reduces
mobile detail through 2/4/8/16/32m outer bands. Stitched fans share every neighbor
boundary vertex, including clipped 4:1 joins. The global grid stays fixed as
the rider moves; replacement buffers swap atomically after sliced CPU work.
Mobile far-field rendering uses the existing low topology and one visible batch.

Same-location comparisons at 495 points on five named routes reduce maximum
mobile contact error from 0.4172m to 0.0103m (RMSE 0.08769m to 0.001910m).
The reference is the existing immutable bicubic physics surface, not independent
surveyed ground. This is improved rendering accuracy, not survey certification.
Sampled near geometry peaks at 8,542 mobile / 50,834 desktop triangles, one draw.
The two-buffer stream and shared sample cache reserve 15,801,736 CPU bytes.
A 600-frame moving-stream exercise measures 0.0215m maximum sampled contact error.
These offline results do not establish a GPU or real-device performance bound.

## Recorded method and provenance

Hermes ran adversarial-ux-test/dogfood with DeepSeek V4 Flash via the deepseek
provider at maximum reasoning. Baseline ran first, followed by the A/B matrix,
then two rounds of mobile budget corrections and separate retests. No public
issues or messages were posted. Local artifacts preserve earlier failures.

Headed Chromium on an Apple M4 rendered all cases. Pixel 7 viewport/touch/DPR
emulation selects the app's mobile geometry policy, but is not phone hardware.
4 O'Clock (`osm:way:128932723:0`), skier, firm surface, weather off; sequential
66-second input timelines, backend and terrain mode asserted at runtime.
Warm GC heap windows span 10 seconds. Frame results exclude boot, screenshot
and explicit-GC windows. Real-time route distances drift; those recordings
are not identical-position causal comparisons. Deterministic replay and offline
same-position sampling provide the paired geometry/physics checks separately.

The first 20e0ec9 A/B matrix reached 206,492 mobile-adaptive scene triangles and
80 draws. The be19fa0 far-field correction reduced draws to 69 WebGL / 72 WebGPU
but still reached 170,044 / 153,381 triangles. Those are retained failures.
Final fc85b13 real-time results (sampled whole-scene maxima):

| Metric | WebGL2 | WebGPU | Mobile gate |
|---|---:|---:|---|
| Scene triangles | 147,392 | 130,535 | <150,000: both pass |
| Draw calls | 69 | 72 | <80: both pass |
| Texture bytes | unavailable | 50,153,731 (47.8 MiB) | <64 MiB: GPU pass, GL unmeasured |
| Retained heap / 10s | -6,017 B | +126,621 B | <2 MiB: both pass |
| Steady frame p95 | 9.1 ms | 9.2 ms | M4 observations only |
| Steady frames >50ms | 0 | 0 | no sampled rebuild hitch |
| Maximum contact error | 18.8 mm | 7.1 mm | current physical height reference |
| Near terrain triangles | 8,542 | 8,542 | included in scene count |
| Rebuild counter at end | 72 | 53 | repeated live transitions exercised |
| Application errors | 0 | 0 | console/page/request errors |

The WebGL recording covers 851m; WebGPU covers 654m, so their maxima are not
same-position comparisons. One-second debug polls sample geometry counts;
they are not exhaustive whole-mountain upper bounds. Texture byte evidence is
only available for WebGPU. Cold-start frame spikes remain (274ms WebGL, 100ms
WebGPU in the first five seconds); steady-state numbers exclude those spikes.

Local evidence root: `.agent-team/hermes-terrain/mobile-final/` (ignored).
Each backend has raw/summary JSON, a 66-second input log, and
`evidence/case-{1-mobile-adaptive-webgl,2-mobile-adaptive-webgpu}/gameplay.webm`
plus poster/initial/mid/end PNGs. Earlier `baseline/`, `ab/`, and
`mobile-followup/` remain untouched. Videos were confirmed on disk; the final
WebGL video is 78 seconds including setup. Main-agent inspection of final
WebGL mid and WebGPU end screenshots found no visible open ground crack;
this limited still inspection cannot certify temporal pop-free rendering.

## Code verification

All 1,402 tests and `npx tsc --noEmit` pass. Focused ESLint passes on changed
terrain files. Full lint reports existing vendored Basis decoder errors and
local ignored Hermes harness errors. Production build passed on retry after
an external /map data-fetch timeout. Structured autoreview completed clean
at its default P0 threshold using the final mobile-layout review scope.

## Remaining coverage

Actual mobile hardware, thermal throttling and battery use remain unmeasured.
WebGL texture byte accounting is unavailable from the current debug metrics.
Initial desktop-adaptive recordings reached 159 draws, beyond the <150 desktop
gate; the mobile changes do not address this. Keep the renderer opt-in until
coverage and full-scene budgets support broader rollout. Spatially watertight
joins do not prove that every distant silhouette change is temporally invisible.

## Final deterministic comparison

On fc85b13, both variants apply 5,400 identical 120Hz ticks and compare 45
milestones. Maximum position, velocity and simulation-time deltas are exactly
zero. Both finish this synthetic input sequence in the same crash state at
44.99999999999809 seconds. Adaptive rebuild counter reaches 77. Maximum sampled
contact error is 0.334318m uniform versus 0.007200m adaptive. This synthetic
replay calls the renderer after every tick; it is not a frame-rate benchmark.

The first recording attempt stalled because the harness awaited video save
before closing its browser context. That attempt remains under `attempt-1/`;
the repaired harness closes the context before saving and produced both videos.
The original matched screenshots at ticks 1200/2400/3600/4800 are obscured by
the debug pause dialog. A separate capture-only pass in `clear-pairs/` hides
only that dialog through test CSS; it does not resume simulation or change
quality/physics. The pause HUD remains stale, so screenshot labels use harness
tick counts. Original images and the unmodified real-time recordings remain
available. Clear-pair evidence is intentionally instrumented, not a UX view.
The clear-pair pass also matches all 45 milestones exactly, with the same
0.334318m / 0.007200m contact maxima; all eight tick-labeled images and both
videos are present. Main-agent inspection of the tick-2400 pair confirms the
pause dialog is absent and both show the same route position, with no open
near-ground crack visible. Distant silhouette detail differs by design; stills
do not establish invisible temporal transitions. A failed initial gate-path
lookup in the copied harness is preserved as `clear-pairs/det.log.1-gateerror`.

## Follow-up priorities

Keep the current rollout opt-in. First validate on physical iPhone/Pixel hardware
and widen route coverage, since the recorded WebGL triangle headroom is only
2,608 triangles. Then address cold-start stalls and the existing desktop draw
budget. The initial adversarial UX report also identifies a below-fold Start
button and an expert default run; these are retained findings outside this
terrain geometry change. Mobile HUD occlusion and sparse tree silhouettes are
visible in the retained images and warrant a separate presentation pass.
