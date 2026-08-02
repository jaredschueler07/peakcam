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
 * The furthest a near-field pixel can ever be from the player, in metres.
 *
 * The grid covers `dx ∈ [-GRID_HALF, GRID_HALF]` and `dz ∈ [-Z_TILES_BEHIND, GRID_SIZE-1-Z_TILES_BEHIND]`
 * in tile indices, and the player sits somewhere inside their own tile — so the worst case is the
 * player at one corner of their tile and the pixel at the far corner of the grid:
 *
 *   maxX = (GRID_HALF + 1) · TILE_SIZE                  = 600 m
 *   maxZ = (GRID_SIZE - Z_TILES_BEHIND) · TILE_SIZE     = 800 m
 *   reach = hypot(maxX, maxZ)                           = 1000 m
 *
 * Anything beyond this is far field or sky. Nothing else can be.
 */
export const NEAR_FIELD_MAX_REACH_M = Math.hypot(
  (GRID_HALF + 1) * TILE_SIZE,
  (GRID_SIZE - Z_TILES_BEHIND) * TILE_SIZE,
);
