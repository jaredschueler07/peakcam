# Breckenridge adaptive terrain prototype

Status: opt-in engineering prototype. Enable on the real Breckenridge course with
`/resorts/breckenridge/drop-in?engine=v2&terrain=adaptive&weather=0&e2edebug=1`.
Omit `terrain=adaptive` for the uniform baseline. Other mountains and procedural
courses retain the uniform renderer. The switch changes presentation only;
120Hz physics, source packs, course/physics versions and validation are unchanged.
Finer tessellation resolves the current bicubic surface; it adds no survey data.

## Geometry and frame work

One active indexed mesh covers the same 1,000 × 1,000m tile window as before.
Desktop uses 1m spacing inside a 64m square, 2m inside 128m, 4m inside 256m,
and 8m outside. Mobile uses 1m inside 32m, 2m inside 128m, 4m inside 256m,
8m inside 512m, and 16m outside. The centre snaps to 32m desktop/16m mobile
world coordinates. The outer boundary clips to the original 200m tile window.

Every coarse/fine join shares exact corner and midpoint vertices, with a fan
on the coarse side. Tests verify upward winding, total covered area, two uses
of every internal edge, and exact interpolation of every actual triangle.
Normals and snow attributes use the same immutable world sample at shared
vertices. No skirts hide cracks. No physical surface is modified.

The live stream reserves two geometry buffers and a shared immutable-sample
cache at construction: 15,801,736 bytes of CPU backing storage. Only one mesh
is visible and drawn. Initial construction completes before play. During play,
the replacement is assembled in 2ms work slices (plus one indivisible coarse
cell), then swapped atomically. Until then, contact sampling and far-field
clipping both use the visible buffer. Shader quality changes reuse materials;
geometry, index arrays and cache storage are never allocated in the frame path.
Inactive geometry has an explicit disposal owner, including scene-owned cleanup.

This is spatial adaptation with atomic swaps, not a temporal geomorph. At normal
motion the rider remains within the fine region; fast movement or a teleport
can outrun the pending window. Debug contact error and recordings must detect
such cases. Large jumps can temporarily expose the underlying far field while
the new near mesh is prepared. Normals at LOD boundaries are source-consistent,
but remote silhouette changes still need visual review.

## Reproduce the engineering measurements

```sh
npx tsx scripts/measure-adaptive-terrain.ts docs/terrain/adaptive-prototype-report.json
node --import tsx --test lib/game/rendering/AdaptiveTerrainMesh.test.ts lib/game/rendering/TerrainRenderer.test.ts
```

The committed report samples the five longest named pieces at 33 positions,
centre and ±5m laterally: 495 identical spatial points per mesh comparison.
Mobile's maximum contact error drops from 0.417m (8m uniform) to 0.0103m;
RMSE drops from 0.0877m to 0.00191m. Desktop uses the same refined near surface.
The sampled maximum triangle count is 29,868 mobile / 50,834 desktop, one draw.
The old mobile terrain has 31,250 triangles. All figures here count terrain only.

A second offline exercise moves 600m at a simulated 30m/s and 30Hz. The actual
stream swaps its reserved buffers, and contact error is sampled while building.
The recorded host had p95 CPU work of ~2.03ms mobile/~2.01ms desktop, maximum
~4.38ms/~4.62ms, with a maximum moving contact error of ~0.0215m. These are CPU
observations on macOS arm64, not GPU frame rate, not actual mobile hardware,
and not guaranteed timing bounds. A 2ms slice can overshoot by one coarse cell.

## Recorded A/B acceptance

Hermes owns dogfooding under the user's requested DeepSeek V4 Flash/max profile.
The first test targets production with the adversarial-ux-test skill. Follow-up
runs compare baseline and prototype on the same deployed build, run, rider,
surface, weather and input sequence. Wall-clock keyboard runs can diverge with
frame scheduling; use the Free Ride deterministic tick debug API for identical
route-position snapshots and keep real-time performance runs separate.

Collect gameplay video, start/mid/seam/finish images, console errors, selected
route/config, actual GPU/backend, frame p50/p95, full-scene draw/triangle counts,
texture bytes where available, and post-warmup/post-GC 10-second heap growth.
`performance.rendererInfo.terrain` in the debug snapshot records active geometry,
physical/rendered height, contact error, rebuilds and per-frame terrain work.
Snapshots allocate intentionally for test instrumentation; do not poll them at
120Hz or include instrumentation churn as a renderer allocation claim.

Release budgets are in `docs/drop-in-v2/BUDGETS.md`: mobile <150k triangles,
<80 draws, <64MB textures and <2MB retained heap growth/10s. Docker software GPU
and a mobile viewport on a Mac are not iPhone/Pixel performance certification.
Keep the default uniform until recorded coverage supports wider rollout.
