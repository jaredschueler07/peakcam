# Drop In v3 acceptance record

Local integration: `feat/drop-in-v3`, isolated worktree `.worktrees/drop-in-v3`,
original base `de795d4`; final tested gameplay commit `aed2b3d`. The primary checkout's snowing-now changes are not part
of this branch. No push, deployment, database migration or scheduled capture was
performed. This record distinguishes local automated evidence from release gates.

## Terrain and simulation

| Resort | Selectable named pieces | Complete lifts | Forest sites | Terrain/catalog/landmarks/LOD plus shared pine atlas |
|---|---:|---:|---:|---:|
| Breckenridge | 230 | 34 | 6,130 | 1,788,898 B |
| Heavenly | 128 | 23 | 7,331 | 1,784,614 B |
| Portillo | 6 | 15 | 0 | 1,673,902 B |

All terrain totals are below the brief's 3 MB ceiling. Core packs retain the
stricter existing 1.5 MiB guard. A conservative bound using every production
JavaScript chunk, including unrelated routes, plus the largest core pack is
2.73 MB Brotli, below the 3.5 MB engine-plus-terrain budget. Source widths,
grooming, speed and occupancy defaults are documented in bake provenance;
missing OSM coverage is not represented as surveyed completeness.

The fixed 120 Hz simulation uses PHYSICS_VERSION=2 and COURSE_VERSION=3.
Historical v1 parity fixtures remain. Replay tests exercise genuine quantized
keyboard/touch tapes and actual run-handler acceptance for all three resorts
using in-memory dependencies. A separate honest Daily Line roundtrip issues
a signed morning-weather ticket, finishes Imperial Bowl in 3,377 fixed ticks,
and receives HTTP 201 from authoritative submission replay. Tampered inputs,
poses, scores and signed environment values are rejected. These are not deployed leaderboard writes.

## Local validation

- Merged unit tests: 1,099 passed. TypeScript and production build pass.
- TypeScript and pure-core import fences pass; the fence run reports nine
  existing unused-destructuring warnings, no errors.
- Production browser suite: 43/43 passed after rendering and heap corrections.
  All six weather=0 luminance guards pass without threshold changes. Retained
  heap grew by 453,347 B over ten seconds (44,132,066 → 44,585,413 B). The original 2 MiB guard is unchanged.
- Every mapped lift passed accelerated browser boarding, continuous simulation
  traversal and actual-terminal unloading: 72/72, maximum endpoint error below
  1e-12 m. Imperial SuperChair takes 333.83 simulated seconds. Acceleration does
  not constitute 72 human-paced rides.
- Full real-input matrix: 36/36 passed, with no browser errors or debug
  mutations. It exposed and verified the fix for Tuck replacing the steering
  pointer. All runs start at the course top and finish through normal physics.
- All six sampled storm views pass the draw/triangle limits, including mobile
  DPR 2. Final contact-corrected captures were inspected at 750 ms, 5 seconds
  and 30 seconds on both backends, plus reversible 4→1→4 quality transitions.

## Sampled rendering budgets

| Resort | Desktop WebGPU rung 4 draws / triangles | Texture bytes | Mobile WebGL rung 1 draws / triangles |
|---|---:|---:|---:|
| Breckenridge | 142 / 218,893 | 115,188,580 | 73 / 119,769 |
| Heavenly | 102 / 188,394 | 117,988,180 | 59 / 96,292 |
| Portillo | 126 / 311,900 | 114,493,800 | 72 / 148,889 |

Desktop p95 is 9.8–10.0 ms. The mobile viewport uses the same M4 GPU, so its
9.9–10.1 ms p95 is not an Android result. Counts are sampled active frames,
not a proof covering every possible viewpoint.

## Evidence method

Hardware: Apple M4, 10 CPU cores, 16 GB RAM, 120 Hz display. Production server
uses port 3113. Headed Chromium uses actual WebGPU/WebGL, verified from runtime
backend state. Whole-frame draw/triangle counters include scene, shadows and
post processing. WebGPU reports texture bytes; WebGL exposes counts, so no
claim of measured WebGL GPU texture bytes is made.

Thirty-second storm runs measure desktop WebGPU rung 4 at 1365×900 and mobile
WebGL rung 1 at 390×844 with DPR 2 (780×1688 drawing buffer). Mobile viewport/touch emulation runs on the M4 GPU;
its frame times cannot certify Android performance. Forced quality pins are
used only for renderer profiling, never the full-run input matrix.

The full-run matrix covers three resorts × three modes × two backends × two
input schemes. It starts at the real course top, steers with keyboard events
or multi-touch events, and finishes through normal simulation. Debug movement,
accelerated ticks and ranked mutations are forbidden. Session issuance is mocked
for UI coverage; authenticated acceptance is tested separately through the run
handler. No mock ticket is submitted to a deployed service.

Cold-load profile: empty browser cache, 10 Mbps down, 1 Mbps up, 100 ms latency.
The final runtime reached no-query Breckenridge in 2.78 seconds from navigation
(0.31 seconds after Start), actual WebGPU. Poster/module overlap and delaying
audio sample transfers until graphics readiness removed the critical waits. Terrain preloads are
reused without duplicate requests. This passes both the ten-second brief goal and the stricter three-second
navigation-to-ready budget on the stated profile.

## Needs Jared / unclosed release gates

- Actual Android rung-1 WebGL performance and GPU memory, plus keyboard/phone
  feel and listening playtests.
- Apply migration 017, configure ticket signing and cron authorization, and
  schedule morning-snapshot capture. Daily Line deliberately falls back to
  offline when a trusted morning snapshot is unavailable.
- Configure production CI secrets and deploy after review. Funnel conversion
  and production fatal-error rates require live telemetry.

## Reproduce locally

Run from the isolated worktree. Use the existing environment configuration for
the production build; never commit keys. Install Chromium if absent with
`npx playwright install chromium`. Build with `npm ci` and `npm run build`, then
keep `npm run start -- --hostname 127.0.0.1 --port 3113` running in another terminal.
Run GPU checks serially with the browser visible and no competing GPU workload.

```sh
npm test
npx tsc --noEmit
npx eslint lib/game/core lib/game/physics lib/game/terrain
PLAYWRIGHT_WEBGPU=1 npx playwright test --project=chromium --project=chromium-webgpu --project=chromium-heap --workers=1
BASE_URL=http://127.0.0.1:3113 node --import tsx .superpowers/sdd/V3-PLAN/full-runs-browser-qa.mjs --run
node .superpowers/sdd/V3-PLAN/lift-browser-qa.mjs
node .superpowers/sdd/V3-PLAN/gpu-final.mjs
node .superpowers/sdd/V3-PLAN/gpu-scenarios.mjs
node .superpowers/sdd/V3-PLAN/cold-load-qa.mjs
```

The five committed QA scripts regenerate raw JSON and screenshots beside the
scripts. Compact final measurements are committed in [V3-QA-DATA.json](V3-QA-DATA.json).
The full-run driver uses Imperial Bowl, Milky Way and Plateau from their actual
tops, across every mode/backend/input combination; it does not ski every catalog
trail. Lift traversal intentionally uses accelerated fixed ticks. Renderer probes
pin quality and weather. These methods are separate from the unmodified-input
full-run matrix and the server replay unit tests.
