/**
 * lib/game/terrain/resorts.ts
 * ───────────────────────────
 * Per-resort bake extents, shared by `scripts/bake-resort.ts` and
 * `scripts/validate-game-assets.ts`. Dependency-free so the runtime can import
 * it too (the game needs the same centre/size to place the world).
 *
 * Numbers come from `docs/drop-in-v2/research/terrain-report.md`:
 *   - boxes: 4096 m at Portillo, 6144 m at Breckenridge/Heavenly (a 4 km box
 *     silently drops ~40% of Breck's runs)
 *   - Overpass bboxes and elevation bands: report §2
 */

export interface ResortBakeConfig {
  slug: string;
  name: string;
  /** Box centre `[lat, lon]`, degrees. */
  center: [number, number];
  /** Box edge length, metres. */
  sizeM: number;
  /** Overpass bbox `[south, west, north, east]`. */
  bbox: [number, number, number, number];
  /** OSM/OpenSkiMap difficulty convention the `piste:difficulty` values follow. */
  convention: "north_america" | "europe";
  /**
   * Resort-polygon elevation band `[min, max]` in metres (OpenSkiMap, report §2).
   * The bake box is larger than the polygon, so baked min/max legitimately
   * exceed this — validation only checks for plausible overlap.
   */
  elevationBand: [number, number];
  /** Copernicus GLO-30 1°×1° tile id, when the COG path is supported here. */
  copernicusTile?: string;
}

export const GRID = 1024;
export const QUANTUM = 0.1;
export const SOURCE_ZOOM = 14;
export const M_PER_DEG_LAT = 111132;

/** Metres per degree of longitude on the local ENU frame at `lat`. */
export function mPerDegLon(lat: number): number {
  return 111320 * Math.cos((lat * Math.PI) / 180);
}

export const RESORT_BAKE_CONFIGS: Record<string, ResortBakeConfig> = {
  "ski-portillo": {
    slug: "ski-portillo",
    name: "Portillo",
    center: [-32.842, -70.129],
    sizeM: 4096,
    bbox: [-32.9, -70.22, -32.76, -70.04],
    convention: "europe",
    elevationBand: [2577, 3349],
    copernicusTile: "S33_00_W071_00",
  },
  breckenridge: {
    slug: "breckenridge",
    name: "Breckenridge",
    center: [39.4749, -106.081],
    sizeM: 6144,
    bbox: [39.42, -106.15, 39.53, -106.01],
    convention: "north_america",
    elevationBand: [2917, 3910],
  },
  heavenly: {
    slug: "heavenly",
    name: "Heavenly",
    center: [38.9404, -119.912],
    sizeM: 6144,
    bbox: [38.89, -120.02, 38.97, -119.88],
    convention: "north_america",
    elevationBand: [2025, 3052],
  },
};

export const RESORT_SLUGS = Object.keys(RESORT_BAKE_CONFIGS);
