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

/**
 * Production kill switch. Drop In is parked while the core product gets
 * focus (2026-09-17); the game code stays in the tree so the v3 engine branch
 * can keep merging cleanly. Set NEXT_PUBLIC_DROP_IN_ENABLED=true to bring back
 * every entry point (nav, resort/map buttons, hub, game pages, API routes,
 * sitemap) in one flip. Read at call time so tests can toggle it.
 */
export function isDropInEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DROP_IN_ENABLED === "true";
}

/** Uniform 404 for the Drop In API routes while the feature is parked. */
export function dropInDisabledResponse(): Response {
  return Response.json({ error: "Drop In is not available" }, { status: 404 });
}

/** The pilot roster. Order is intentional — Portillo shipped first. */
export const DROP_IN_RESORT_SLUGS: readonly DropInResortSlug[] = [
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
  if (!isDropInEnabled()) return null;
  return Object.prototype.hasOwnProperty.call(PROFILES, slug)
    ? PROFILES[slug as DropInResortSlug]
    : null;
}

/**
 * Every pilot profile, in roster order. The hub page and the "no Drop In here
 * yet" states render from this so the marketing surface can never advertise a
 * mountain the engine doesn't have — it is derived, never hand-listed.
 */
export function getDropInRoster(): DropInProfile[] {
  if (!isDropInEnabled()) return [];
  return DROP_IN_RESORT_SLUGS.map((slug) => PROFILES[slug]).filter(Boolean);
}

/** Whether a resort is part of the Drop In pilot. */
export function isDropInResort(slug: string): boolean {
  return getDropInProfile(slug) !== null;
}

export function getDropInGameUrl(slug: string): string | null {
  if (!isDropInResort(slug)) return null;
  return getDropInHref(slug);
}

export function getDropInHref(slug: string): string | null {
  if (!isDropInResort(slug)) return null;
  return `/resorts/${slug}/drop-in`;
}
