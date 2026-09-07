# Survey terrain buildout review

User request: create a plan to build out survey-level mountain fidelity, then execute.
Base: 137e07b, ship/drop-in-v3. Plan:
docs/superpowers/plans/2026-09-07-survey-terrain.md.

Scope: offline source discovery/probing, engineering readiness checks, rendered-mesh and
original-source resolution measurements, reproducible reports and acquisition docs.
Production runtime, three baked terrain packs, physics, clock and course version are
unchanged. No professional survey certification, original source replacement, outreach,
purchase or unverified datum shift is authorized by this implementation.

Contracts: source catalog candidates are not valid-data coverage; source pixel probes
are not full-mountain coverage; processing residuals are not independent survey control.
Unknown evidence stays null. The readiness CLI binds active course/source fingerprints,
requires independent and spatially distributed control, checks horizontal/vertical
uncertainty plus mesh error allocation, and rejects a sampled maximum as a full-scope
error bound. Even a passing engineering record requests independent review, never a
certificate. Referenced artifacts and self-declared survey data still require human
inspection; the gate does not authenticate remote evidence.

Measurements: source-window experiments operate in native NAD83 frames without claiming
survey-grade WGS84 transformations. They point-sample and reconstruct local raster windows,
not the exact production GDAL warp. Render comparison uses Float32 vertices and the
existing triangle diagonal, with a test against actual TerrainRenderer contact sampling.
No mobile shader/runtime changes or new browser performance claims.

Review the code, meaningful failure cases and report/claim boundaries. Source acquisition
is bounded by timeouts, catalog pagination and pixel-window sizes. Network source probes
write only isolated offline evidence; none changes a live game pack.

Verification results are recorded in the plan execution ledger and appended here at closeout.

## Closeout evidence

- `npm test`: 1,390 passed, zero failures. A subsequent source-probe hardening change
  rejects undeclared implausible elevation sentinels; its focused tests also passed.
- `npx tsc --noEmit`, ESLint across all ten new script/test files, `git diff --check`:
  passed. `npm run validate-game-assets`: all three existing production packs passed.
- Readiness CLI: current mountains output `blocked`; `--require-ready` exits 2.
  Invalid data/unknown arguments fail instead of producing acceptance evidence.
- Current rendered-resolution, readiness, Breck source-window and Heavenly source-window
  reports all reproduced byte-for-byte. Source inventory remains a timestamped live
  observation and is expected to change upon requery; paginated fixture tests are offline.
- Renderer math is tested against actual TerrainRenderer high/low contact sampling,
  including negative coordinates and cell boundaries. No new browser or device-profile
  claims: runtime, visual assets and physics are unchanged.
- Actual original raster probes: Breck 1 m and Tahoe 0.5 m centre windows each fully
  valid; Dipper Bowl original 32 m square 0/4,096 valid. These are bounded samples,
  not complete source coverage or survey validation. Source references and hashes are
  in docs/terrain/SOURCE-ACQUISITION.md.
- Autoreview command:
  `/Users/maestro_admin/.agents/skills/autoreview/scripts/autoreview --mode local --prompt-file docs/reviews/survey-terrain-buildout.md --output /tmp/buildout-review.md --json-output /tmp/buildout-review.json`
  completed clean at default P0 threshold, one 165,061-byte pass, no findings; secret
  scan clean. Plan execution ledger and this verification prose were updated afterward.

Ready to ship the tools and documentation. New surveyed terrain promotion remains
blocked by actual source/control/transform/error-budget prerequisites, listed in the plan.
