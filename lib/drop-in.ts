/** App-facing compatibility facade for the Drop In pilot. */

import { DROP_IN_GAME_PROFILES } from "./game/config/profiles";
import type { DropInResortSlug } from "./game/config/schema";

export interface DropInProfile {
  slug: string;
  name: string;
  tagline: string;
  summitElevationFt: number;
  verticalDropFt: number;
  terrainSeed: number;
  accent: string;
  trailNames: readonly string[];
}

/** The pilot roster. Order is intentional — Portillo shipped first. */
export const DROP_IN_RESORT_SLUGS: readonly string[] = [
  "ski-portillo",
  "breckenridge",
  "heavenly",
];

function toPublicProfile(slug: DropInResortSlug): DropInProfile {
  const gameProfile = DROP_IN_GAME_PROFILES[slug];
  return {
    slug: gameProfile.slug,
    name: gameProfile.name,
    tagline: gameProfile.siteTagline,
    summitElevationFt: gameProfile.summitElevationFt,
    verticalDropFt: gameProfile.verticalDropFt,
    terrainSeed: gameProfile.terrainSeed,
    accent: gameProfile.accent,
    trailNames: gameProfile.trailNames,
  };
}

const PROFILES: Record<DropInResortSlug, DropInProfile> = {
  "ski-portillo": toPublicProfile("ski-portillo"),
  breckenridge: toPublicProfile("breckenridge"),
  heavenly: toPublicProfile("heavenly"),
};

export { DROP_IN_GAME_PROFILES } from "./game/config/profiles";
export type { DropInResortSlug, ResortGameProfile } from "./game/config/schema";

export function getDropInProfile(slug: string): DropInProfile | null {
  return Object.prototype.hasOwnProperty.call(PROFILES, slug)
    ? PROFILES[slug as DropInResortSlug]
    : null;
}

export function isDropInResort(slug: string): boolean {
  return getDropInProfile(slug) !== null;
}

export function getDropInGameUrl(slug: string): string | null {
  if (!isDropInResort(slug)) return null;
  return `/drop-in/engine.html?resort=${encodeURIComponent(slug)}`;
}

export function getDropInHref(slug: string): string | null {
  if (!isDropInResort(slug)) return null;
  return `/resorts/${slug}/drop-in`;
}
