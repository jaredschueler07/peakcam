# Survey Terrain Buildout Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task in the existing isolated worktree. User has authorized both planning and execution; do not stop for another execution-choice prompt.

**Goal:** Establish an executable path from published source data to independently checked terrain, with measurable gates for every mountain and explicit dependencies for survey acceptance.

**Architecture:** Keep geospatial acquisition and evidence validation offline. The current shared 120 Hz runtime remains authoritative while source candidates, controls and resolution experiments are evaluated in separate files. Promote a new playable pack only after its evidence and error budget pass; tool completion must never imply surveyed accuracy.

**Tech Stack:** TypeScript/Node, Zod, GDAL/PROJ, pinned Proj4js, existing terrain sampler and Three.js mesh geometry.

**Spec:** `docs/terrain/README.md`.

## Global constraints

- Physics remains pure TypeScript at 120 Hz; v1 golden traces unchanged.
- One physical height function, identical on client and headless server.
- Real terrain receives no invented elevation offsets, ramps or noise.
- Mobile ceilings: <64 MB textures, <150k triangles, <80 draws; retained heap <2 MB/10s.
- Proposed engineering acceptance targets: 0.25 m vertical, 0.5 m horizontal. These are provisional project targets, not certification standards.
- Independent observations, known datums/epochs, coverage and rendered-surface error are prerequisites for any accuracy claim.
- Current public data may not meet the target. Acquisition/independent-survey dependencies remain open until evidence exists; do not fabricate substitute controls.

## Task 1: Recover source candidates and evidence

**Files:** create `scripts/discover-terrain-sources.ts`, `scripts/terrain-source-discovery.test.ts`, `docs/terrain/source-candidates.json`, `docs/terrain/SOURCE-ACQUISITION.md`.
**Interface:** export `queryProducts(slug, fetchImpl)` returning a dated source inventory with query URL, catalog product IDs, URLs, metadata URLs and bounds. Catalog intersection means candidate only, never valid raster coverage.

- [x] Add tests using a paginated TNM fixture; assert every page is retained, duplicate IDs rejected/deduplicated, HTTP errors and repeated pagination fail explicitly.
- [x] Implement requests against the current official TNM API with a timeout and bounded page count; preserve source IDs and metadata URLs. No runtime source replacement.
- [x] Run the CLI for Breckenridge and Heavenly, record the actual response date and catalog gaps; investigate official Portillo/Chile and Tahoe source leads with citations.
- [x] Probe at least one available Breckenridge original source window through GDAL, archive source metadata/hash and valid-data coverage. If a source is inaccessible, record the request and failure, and continue to the next independent candidate.
- [x] Document acquisition instructions and remaining legal/data/independent-control requirements. No outreach or paid purchase is authorized.

## Task 2: Executable acceptance gate and survey coverage

**Files:** create `scripts/terrain-readiness.ts`, `scripts/terrain-readiness.test.ts`, per-resort readiness records under `docs/terrain/readiness/`; modify `package.json` and methodology.
**Interface:** `assessReadiness(evidence)` consumes a strict versioned evidence record with input hashes, datum/epoch records, coverage fraction, independent controls, horizontal/vertical errors, mesh errors and independent reviewer status. Returns `ready-for-review` or `blocked` with machine-readable reasons. It never issues a survey certificate.

- [x] Test a complete synthetic record, missing datum, false independence, empty/sparse control, inadequate geographic coverage, failed horizontal/vertical/mesh tolerances, and invalid/nonfinite inputs.
- [x] Implement explicit gates, including at least 30 independently surveyed points and representative spread; these are project criteria and not a substitute for a professional sampling design.
- [x] Add real records with unknown metrics represented as null, never zero. CLI default report exits zero when report generation succeeds; `--require-ready` exits nonzero for blocked mountains.
- [x] Run all current mountains through the gate; preserve the exact failed criteria and required evidence.

## Task 3: Measure runtime and resolution error

**Files:** create `scripts/measure-terrain-resolution.ts`, `scripts/terrain-resolution.test.ts`, `scripts/measure-source-resolution.ts`, `scripts/source-resolution.test.ts`, `docs/terrain/resolution-report.json` and source-window evidence under `.agent-team/terrain-source-probes/` (not shipped).
**Interface:** offline `measureSurface(height, points, spacingM)` returns signed residual summaries comparing Float32 triangle interpolation against the reference height. The triangle split must match the existing renderer. Use source-window data as a separate reference when accessible.

- [x] Test exact planes, negative coordinates/tile boundaries, curved surfaces and nonfinite/outside coverage.
- [x] Sample representative named routes across each mountain, not only summit/base, at 4 m and 8 m renderer spacings; record maxima and percentiles per route and resort.
- [x] Run a source-window resolution experiment where actual 1 m data is available. Treat it as an engineering sample, not whole-mountain coverage or independent survey validation.
- [x] Record whether dense global geometry would fit the mobile triangle ceiling and specify the measured trigger for adaptive terrain. Do not increase production mesh density until it has a budget-compliant implementation and adequate source coverage.

## Task 4: Validation and rollout

**Files:** update this plan, methodology, acquisition guide and review report; change source/runtime assets only if the preceding promotion criteria pass.

- [x] Run focused tests for the new CLIs, complete `npm test`, `npx tsc --noEmit`, asset validation and deterministic report reproduction.
- [x] Run source review; independently exercise each CLI with valid, invalid and missing-evidence inputs. No browser retest is needed if runtime and assets stay unchanged; if changed, repeat all resort/backend playtests and mobile profiling.
- [x] Prepare verified tooling and documentation for the already-authorized main workflow; preserve the worktree.
- [ ] Advance course version and publish new terrain only for an evidence-supported accepted pack. If none qualifies, retain course v4 and list exactly which external source/survey inputs prevent this step.

## Execution ledger

Started from `137e07b`, clean `ship/drop-in-v3` worktree. Task status will be updated with actual evidence and outcomes; unchecked data-dependent promotion work remains open.


### Execution results — 2026-09-07

Tasks 1–3 are implemented and exercised. Task 4 checks and source review passed; integration is the final closeout action. Terrain promotion is not complete.

- Source discovery: 7 Breckenridge and 12 Heavenly USGS catalog candidates, with bounded
  pagination, raw-response hashes and timestamps. These are candidate counts only.
- Breckenridge: original 1 m native 1024² window recovered, 100% valid pixels.
- Heavenly: newer USGS candidate had no valid elevation at the 22 tested positions.
  Original OpenTopography 0.5 m Tahoe data was recovered; centre window 100% valid,
  21/22 representative positions valid. A 32 m square around the Dipper Bowl endpoint
  is entirely nodata in the original tile, so the gap is not just a VRT seam.
- Portillo: official-source leads documented, no suitable fine DTM established.
- Readiness: all three current packs correctly report `blocked`. The real records retain
  null original-delivery/datum/control evidence. Sampled mesh evidence is recorded and
  explicitly cannot satisfy a full-scope bound. `--require-ready` exits 2.
- Current mesh measurements (worst sampled error against physics): desktop/mobile
  Breckenridge 0.567/2.008 m, Heavenly 0.323/0.966 m, Portillo 0.283/0.652 m.
- Native-source local reduction at ~6 m: Breck RMS 0.111 m / sampled max 1.088 m;
  Heavenly RMS 0.134 m / sampled max 1.369 m. Local processing-loss experiments only.
- Uniform 1 m terrain over the streamed window needs 2,000,000 triangles; 2 m needs
  500,000. The measured result calls for adaptive geometry with bounded error and
  crack-free shared edges, not an unbudgeted global grid-density increase.
- Full suite: 1,390 tests passed. TypeScript, ESLint and production asset validation pass.
  Deterministic readiness and resolution reports reproduce byte-for-byte. No runtime,
  physics, terrain source pack or course-version changes in this buildout.

### Open promotion dependencies and next implementation sequence

1. Acquire full source deliveries and original metadata/hashes, beginning with Breck.
   Retain known NAD83 realization/epoch and verified transform grids before comparison
   with the current WGS84 local frame. Current window probes are insufficient evidence
   for whole-mountain promotion.
2. Resolve the documented Heavenly source hole using independently sourced measured
   data, or explicitly revise the playable coverage contract. Do not fill it from
   surrounding values and label the result surveyed.
3. Obtain a suitable Portillo bare-earth DTM and independently surveyed observations
   for all declared scopes. The checklist and command schema are in the acquisition guide.
4. Once reference coverage is accepted, implement adaptive physical/source tiling and
   rendered geometry, preserving bicubic continuity and client/server equality. Validate
   errors against that reference, especially seams and steep terrain; prove the mobile
   frame/heap/texture/triangle budgets before enabling it in production.
5. Submit the complete horizontal/vertical/control/mesh evidence for independent review.
   Only then prepare a versioned terrain-pack promotion and repeat replay/browser checks.

The empty/missing source and survey artifacts are real prerequisites, not work completed
by writing a plan or passing a software test. The current data has not earned a
survey-accuracy claim.
