/**
 * lib/game/rendering/nearFieldReach.ts
 * ────────────────────────────────────
 * The streamed near-field tile grid's dimensions, and the one number derived from them that other
 * subsystems need: how far from the player that grid can still be drawing.
 *
 * Dependency-free on purpose. `TerrainRenderer` owns the grid but drags in three.js and the snow
 * materials, and `fogCurve.ts` — which must stay importable from the WebGL fog path, where a
 * `three/webgpu` reach is forbidden — needs the reach to place its long-range envelope. Putting the
 * constants here gives both one definition instead of a copied literal.
 */

/** Metres per tile edge. */
export const TILE_SIZE = 200;
/** Tiles per side of the square grid. */
export const GRID_SIZE = 5;
/** Tiles kept either side of the player's own column. */
export const GRID_HALF = 2;
/**
 * Tile rows kept behind the player. The grid is biased downhill, so this — not `GRID_HALF` —
 * bounds the *guaranteed* coverage; `scripts/bake-far-field.ts` sizes the far field from it.
 */
export const Z_TILES_BEHIND = 1;

/**
 * The furthest a **streamed terrain tile** pixel can be from the player, in metres.
 *
 * Scope matters here: this bounds the tile grid and nothing else. Lift towers, the lift cable and
 * trail markers (`WorldRenderer`) are drawn with no proximity limit at all and routinely sit
 * kilometres away, so "within `NEAR_FIELD_MAX_REACH_M`" is not the same as "near the player".
 * `fogCurve.ts` relies on the narrow claim only.
 *
 * The grid covers `dx ∈ [-GRID_HALF, GRID_HALF]` and `dz ∈ [-Z_TILES_BEHIND, GRID_SIZE-1-Z_TILES_BEHIND]`
 * in tile indices, and the player sits somewhere inside their own tile — so the worst case is the
 * player at one corner of their tile and the pixel at the far corner of the grid:
 *
 *   maxX = (GRID_HALF + 1) · TILE_SIZE                  = 600 m
 *   maxZ = (GRID_SIZE - Z_TILES_BEHIND) · TILE_SIZE     = 800 m
 *   reach = hypot(maxX, maxZ)                           = 1000 m
 *
 * Anything beyond this is far field, sky, or one of the unfiltered world objects above — but it is
 * never a terrain tile. Note the measurement is from the *player*; the fog shaders measure from the
 * *camera*, which sits up to `MAX_CAMERA_PULLBACK_M` further back.
 */
export const NEAR_FIELD_MAX_REACH_M = Math.hypot(
  (GRID_HALF + 1) * TILE_SIZE,
  (GRID_SIZE - Z_TILES_BEHIND) * TILE_SIZE,
);
