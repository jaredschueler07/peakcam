/**
 * Drop In — the curated arcade-descent pilot.
 *
 * This module is the single source of truth for which resorts expose the game
 * and what mountain each one plays like. It is a hand-maintained feature flag
 * on purpose: the pilot is three resorts, so a `drop_in_enabled` column plus a
 * migration would cost more than it buys. Everything the engine needs to
 * differentiate a mountain lives here and in the matching profile block inside
 * `public/drop-in/engine.html` — keep the two in sync when editing either.
 *
 * The engine is a static asset (no bundler, no imports), so it carries its own
 * copy of these numbers. This file is what the *app* reads: the map cards, the
 * route, and metadata.
 */

export interface DropInProfile {
  /** Resort slug — matches `resorts.slug`, and the engine's `?resort=` value. */
  slug: string;
  /** Display name shown on the game's start screen and the route metadata. */
  name: string;
  /** One-line poster subtitle for the start screen / loading state. */
  tagline: string;
  /** Cosmetic summit altitude, feet — drives the in-game altimeter. */
  summitElevationFt: number;
  /** Lift-served vertical, feet — drives the descent's vertical scale. */
  verticalDropFt: number;
  /** Deterministic terrain seed; distinct per resort so no two hills repeat. */
  terrainSeed: number;
  /** Primary accent hex for the game chrome and the site's Drop In control. */
  accent: string;
  /** Exactly six named runs, mirrored by the engine's TRAILS table. */
  trailNames: readonly string[];
}

/** The pilot roster. Order is intentional — Portillo shipped first. */
export const DROP_IN_RESORT_SLUGS: readonly string[] = [
  "ski-portillo",
  "breckenridge",
  "heavenly",
];

// Null-prototype: a plain literal resolves inherited members, so
// getDropInProfile("constructor") returned the Object constructor and
// generateMetadata then threw on profile.trailNames instead of 404ing.
const PROFILES: Record<string, DropInProfile> = Object.assign(Object.create(null), {
  "ski-portillo": {
    slug: "ski-portillo",
    name: "Portillo",
    tagline: "Andean fall line above Laguna del Inca",
    summitElevationFt: 10860,
    verticalDropFt: 2500,
    terrainSeed: 32836,
    accent: "#f5b32d",
    trailNames: [
      "Roca Jack",
      "Juncalillo",
      "El Plateau",
      "La Garganta",
      "Kilómetro Lanzado",
      "Las Vizcachas",
    ],
  },
  breckenridge: {
    slug: "breckenridge",
    name: "Breckenridge",
    tagline: "Above-treeline bowls off the Tenmile Range",
    summitElevationFt: 12998,
    verticalDropFt: 3398,
    terrainSeed: 39481,
    accent: "#3d7fd6",
    trailNames: [
      "Horseshoe Bowl",
      "Imperial Bowl",
      "Devil's Crotch",
      "Four O'Clock",
      "Whale's Tail",
      "Psychopath",
    ],
  },
  heavenly: {
    slug: "heavenly",
    name: "Heavenly",
    tagline: "Sierra pines and a 3,500-foot drop to the lake",
    summitElevationFt: 10067,
    verticalDropFt: 3500,
    terrainSeed: 38935,
    accent: "#6f5bd4",
    trailNames: [
      "Gunbarrel",
      "Ridge Run",
      "Milky Way Bowl",
      "Mott Canyon",
      "Olympic Downhill",
      "Killebrew Canyon",
    ],
  },
});

/** The profile for a pilot resort, or null for everything else. */
export function getDropInProfile(slug: string): DropInProfile | null {
  return PROFILES[slug] ?? null;
}

/** Whether a resort is part of the Drop In pilot. */
export function isDropInResort(slug: string): boolean {
  return getDropInProfile(slug) !== null;
}

/**
 * The static engine URL for a supported resort, or null. Unsupported slugs
 * never produce a URL, so the engine can treat a missing profile as a hard
 * failure rather than guessing a default mountain.
 */
export function getDropInGameUrl(slug: string): string | null {
  if (!isDropInResort(slug)) return null;
  return `/drop-in/engine.html?resort=${encodeURIComponent(slug)}`;
}

/** The in-app route that hosts the engine for a supported resort, or null. */
export function getDropInHref(slug: string): string | null {
  if (!isDropInResort(slug)) return null;
  return `/resorts/${slug}/drop-in`;
}
