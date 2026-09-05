# Immutable DEM inputs for network/relief rebakes

These are the committed pre-v3 `.height.u16.br` files from main, copied without
modification. Decode using `public/game/terrain/<slug>.meta.json` (same centre,
grid, minZ and quantum). Source/license details remain in that metadata and
`public/game/terrain/LICENSE.md`: Breckenridge USGS 3DEP 1 m; Heavenly USGS 3DEP
1/3 arc-second seamless; Portillo Copernicus GLO-30.

Keeping the source separate makes repeated offline detail baking idempotent.
Never use the detailed runtime DEM as the next bake's source. To update a DEM,
use bake-resort.ts with --skip-trails, review it, replace this input, then run the
mountain network bake and advance COURSE_VERSION.
