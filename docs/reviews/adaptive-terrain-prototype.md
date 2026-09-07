# Adaptive terrain prototype review

Request: implement the Breckenridge adaptive mesh; delegate recorded adversarial
A/B testing to Hermes with DeepSeek V4 Flash at maximum effort. Base 51a45fc,
branch ship/drop-in-v3, target main. This is a query-opt-in prototype.

Owner: rendering only. Preserve shared immutable height, 120Hz physics, source
packs, course versions, v1 goldens, Three r185 nodeFactories/WebGL boundary.
AdaptiveTerrainMesh owns clipped quadtree cells and explicit stitched edges.
AdaptiveTerrainStream owns two fixed buffers, incremental rebuilds and atomic
swaps. TerrainRenderer owns visibility/material/disposal and active contact.
FarFieldRenderer must clip to the active mesh bounds during a pending build.
Full mobile scene budgets still need recorded testing, though terrain triangle
count is below the baseline. No source-accuracy or device-certification claim.

Review the mesh index/contact agreement, all join/border cases, streaming and
quality transitions, bounded persistent buffers, resource ownership, opt-in
isolation and debug-only reporting. Offline measurement and docs are in scope.
Hermes artifacts are ignored local evidence; no third-party messages or external
tickets. Do not broaden into unrelated existing rendering/frame allocations.

## Review disposition and verification

The P1 review alleged that direct teardown skips the inactive adaptive buffer.
Rejected after tracing the existing call chain: TerrainRenderer.dispose() calls
its disposeInactiveMaterials() hook, which calls adaptive.disposeInactiveGeometry(),
before disposing the active geometry. The scene-owned teardown uses the same
hook. No behavioral patch is needed. An inline ownership comment and a focused
regression test now exercise both paths after both buffers have actually been
rendered, asserting exactly one disposal per geometry. The independent stream
test also asserts both buffers are released exactly once.

The full 1,396-test suite passed before the final clipping/teardown regression
additions; the added cases and related suites passed separately. TypeScript,
ESLint and production build passed. Build logs include existing user_conditions
schema warnings unrelated to this rendering prototype. Offline results and
limitations are in docs/terrain/ADAPTIVE-PROTOTYPE.md. Browser A/B evidence is
produced separately by Hermes on the verified deployed commit.
