# Final mobile adaptive geometry budget correction

Base be19fa0. Live mobile-emulated recordings still failed the 150k triangle
gate (170,044 WebGL, 153,381 WebGPU), while draws and retained heap passed.
Reduce only opt-in mobile near geometry to 1/2/4/8/16/32m bands with radii
16/24/40/80/160m. Desktop, physics and source packs remain unchanged.

Keep the outer lattice fixed in world coordinates. The original 200m window
can clip a 32m leaf to 8m, so coarse fans now follow all actual neighbor edge
vertices, including quarter points. Rendered-height interpolation uses these
same vertices. Manifold, winding, area and triangle-contact tests cover the
join; an extra regression verifies distant points do not translate when the
rider center advances. All buffer storage remains preallocated.

Review geometry/contact agreement, clipped joins, default isolation and frame
allocations. Offline samples now peak at 8,542 mobile terrain triangles with
unchanged fine contact error. Final full-scene recordings are required before
claiming mobile acceptance. This remains an opt-in prototype.

Verification: all 1,402 tests and TypeScript pass. Focused ESLint passes for the
changed terrain files. Full ESLint reports existing vendored Basis decoder
errors and local ignored Hermes harness errors. Production build passes on
retry after an external /map data-fetch timeout. Autoreview (--mode local,
--prompt-file docs/reviews/adaptive-final-mobile-layout.md) completed clean at
its default P0 threshold, with no actionable findings.
