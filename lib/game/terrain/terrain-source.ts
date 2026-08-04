/**
 * lib/game/terrain/terrain-source.ts
 * ──────────────────────────────────
 * Chooses between the two terrain implementations.
 *
 *   procedural — `heightfield.ts`, the v1-parity path (sine trail corridors,
 *                fbm relief). Always available; the golden fixtures pin it.
 *   real       — `real-heightfield.ts`, baked DEM + micro-detail. Available
 *                only where the caller has already loaded the baked assets.
 *
 * Deliberately pure: this module never fetches. The runtime loads
 * `public/game/terrain/<slug>.height.u16(.br)` and `<slug>.trails.json` and
 * hands the results in already decoded from the wire (brotli undone, JSON
 * parsed). Keeping the fetch out means the same factory serves the browser
 * runtime, the tests, and the server-side run validator.
 */

import type { ResortGameProfile } from "../config/schema";
import type { TerrainSampler } from "../core/types";
import type { TerrainMeta, TrailsFile } from "./formats";
import { createProceduralTerrain } from "./heightfield";
import {
  createRealTerrain, type MicroDetailOptions, type RealTerrainSampler,
} from "./real-heightfield";

/** The baked pack for one resort, already in memory. */
export interface RealTerrainAssets {
  /** Contents of `<slug>.height.u16`, brotli already undone. */
  heightfield: ArrayBuffer;
  /** Parsed `<slug>.meta.json`. */
  meta: TerrainMeta;
  /** Parsed `<slug>.trails.json`. */
  trails: TrailsFile;
}

export type TerrainMode = "auto" | "procedural" | "real";

export interface TerrainSourceOptions {
  profile: ResortGameProfile;
  /** Defaults to `profile.terrainSeed`. */
  seed?: number;
  /**
   * `auto` (default) uses the real terrain when `assets` are supplied and falls
   * back to procedural otherwise. `real` throws when `assets` are missing —
   * use it where a silent fallback would be a bug worth surfacing.
   */
  mode?: TerrainMode;
  assets?: RealTerrainAssets | null;
  microDetail?: MicroDetailOptions;
}

export interface TerrainSource {
  kind: "procedural" | "real";
  /** The sampler the simulation talks to, whichever path was chosen. */
  sampler: TerrainSampler;
  /** Non-null only on the real path — real runs, lifts and DEM metadata. */
  real: RealTerrainSampler | null;
}

export function createTerrainSource(options: TerrainSourceOptions): TerrainSource {
  const { profile, assets = null } = options;
  const seed = options.seed ?? profile.terrainSeed;
  const mode = options.mode ?? "auto";

  if (mode === "real" && !assets) {
    throw new Error(`terrain mode "real" requested for ${profile.slug} without baked assets`);
  }

  if (mode !== "procedural" && assets) {
    if (assets.meta.slug !== profile.slug) {
      throw new Error(
        `baked assets are for ${assets.meta.slug}, not ${profile.slug}`,
      );
    }
    const real = createRealTerrain(assets.heightfield, assets.meta, assets.trails, {
      ...options.microDetail,
      profile,
      seed,
    });
    return { kind: "real", sampler: real, real };
  }

  return { kind: "procedural", sampler: createProceduralTerrain(profile, seed), real: null };
}
