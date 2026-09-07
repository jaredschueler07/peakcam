# Terrain accuracy v4 review scope

User request: improve mountains toward survey-level accuracy and document repeatable
methodology for adding mountains. Branch: ship/drop-in-v3, based on 331491d.

Owner: offline terrain/vector bake, real sampler, source provenance and accuracy audit.
Correct invariants: same UTM coordinates for raster/vector; preserved source elevations;
no invented physical relief on real runs; one shared deterministic height function;
120 Hz and frozen v1 golden traces; course version increments for changed geometry.

Changes: UTM vector transform using pinned offline proj4, immutable source metadata and
fingerprints, no terrain edits or synthetic ramps, default micro-detail zero, rebaked
three source packs and landmarks, short-run gates stay on course, independent projection
probes and vertical checkpoint comparison CLI, documented methodology and limitations.

No survey-certification claim: existing sources were already resampled; no independent
survey checkpoints or delivery-specific datum evidence exist. Datums remain unverified.
Audit reports source fidelity and rejects inappropriate checkpoint comparisons. Full
reports have derived route measurements, explicitly not independent validation. Far
horizon, water levels, building dimensions and tree positions remain illustrative.

Non-goals: replacing missing source LiDAR, inventing control, changing skiing/snowboarding
solvers, 120 Hz, a new geospatial runtime architecture, redoing distant rendering, or
issuing a professional survey certificate. Proposal tolerances in methodology are
engineering targets only. Terrain fidelity cannot prove accuracy of OSM.

Review generated terrain changes against source equality, bake determinism and semantic
audits, not manual numerical review of every raster byte. All public and source assets
are non-secret. No credentials are part of this change.

Verification results will be appended after checks complete.

## Verification completed

- `npm test`: 1,368 passed, zero failures; 120 Hz/v1 golden fixtures unchanged.
  Existing full Daily Line issuance/replay test passed without changing its input driver.
- `npx tsc --noEmit`: passed. Focused ESLint: passed; bake-resort retains its existing
  unused `fromFile` warning. `npm run build`: passed (existing data-source warnings
  about user_conditions.submitted_at were emitted during prerendering).
- All three network rebakes `--verify`: byte-identical. Landmark `--verify`: identical.
  `npm run validate-game-assets`: all three passed, including PNG/u16 equality and pack budgets.
- `npm run audit-terrain -- all --summary`: 1,048,576 source samples preserved per
  resort, runtime physical offset zero, no invented ramps. Checked-in summary reproduces
  byte-for-byte. Sampled subcell overshoot: Portillo 0.1847 m, Breckenridge 0.1445 m,
  Heavenly 0.1904 m. These are not total accuracy estimates or worst-case guarantees.
- Independent GDAL projection regression probes: all nine within 1 mm.
- Eight headed Chromium production smoke playtests: three resorts × WebGL/WebGPU and
  Heavenly mobile emulation × both backends. Started through UI, normal input, moved
  63–116 m, no page errors, expected backend, no debug state mutation. Captures under
  `artifacts/drop-in-forest/terrain-v4/` (ignored). These are short automated playtests,
  not complete mountain traversals or physical-phone certification.
- Sampled mobile end frames: WebGL 61 draws/139,215 triangles; WebGPU 63/140,368.
  Breckenridge desktop end frames 151/152 draws exceed the 150 desktop target slightly;
  this pre-existing desktop over-budget condition is not claimed fixed by this work.
  Heap growth and texture memory were not reprofiled in this terrain pass.

Source review used the autoreview skill with:
`autoreview --mode local --prompt-file docs/reviews/terrain-accuracy-v4.md --output /tmp/terrain-review.md --json-output /tmp/terrain-review.json`.
The full-worktree attempt refused binary diffs before review. The exact changed text
sources, tests, manifests and summary were then reviewed in an isolated temporary Git
snapshot; generated raster binaries and large vector JSON were excluded explicitly.
They were verified separately by the decoding/hash/reproducibility checks above. Source
review completed clean (122,066-byte bundle, one pass, default P0 threshold, no findings).
No raster-pixel AI review or source-blind human playtesting claim is made.

Remaining survey acceptance work is explicit in docs/terrain/README.md. Neither code
review, reproducibility nor these playtests establishes surveyed positional accuracy.
