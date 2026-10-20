// ─────────────────────────────────────────────────────────────
// Public API v1 — the one place the routes touch Supabase.
//
// Everything comes through the cached catalogue read (`getAllResorts`, one
// hour, shared with the pages) plus two small lookups the catalogue does not
// carry: opening rows (migration 020) and resort_metadata elevations. Routes
// are ISR'd at 15 minutes on top, so a cold read happens at most four times
// an hour per route across the whole deployment.
// ─────────────────────────────────────────────────────────────

import { unstable_cache } from "next/cache";
import { getAllResorts, getResortElevationIndex, getResortOpenings, getResortStationsIndex } from "@/lib/supabase";
import type { ResortStationJoined, ResortWithData } from "@/lib/types";
import type { ResortOpening } from "@/lib/openings";
import type { ResortElevation, SerializeOptions } from "./serialize";

export interface PublicApiCatalog {
  resorts: ResortWithData[];
  openings: Map<string, ResortOpening>;
  elevations: Record<string, { base_ft: number | null; summit_ft: number | null }>;
  /** Station layer (migration 026) by resort id; `null` when the tables are not there yet. */
  stations: Record<string, ResortStationJoined[]> | null;
  now: Date;
}

// getResortOpenings() is a plain query (the /opening-dates page sits behind
// its own hourly ISR). The API routes are dynamic (see the route files), so
// the rows are cached here for the API's own 15-minute window.
const getOpeningsCached = unstable_cache(getResortOpenings, ["peakcam:public-api:openings:v1"], {
  revalidate: 900,
  tags: ["peakcam-resort-catalog"],
});

export async function loadPublicApiCatalog(): Promise<PublicApiCatalog> {
  const [resorts, openingRows, elevations, stations] = await Promise.all([
    getAllResorts(),
    getOpeningsCached(),
    getResortElevationIndex(),
    getResortStationsIndex(),
  ]);
  return {
    resorts,
    openings: new Map(openingRows.map((row) => [row.resort_id, row])),
    elevations,
    stations,
    now: new Date(),
  };
}

export function optionsFor(catalog: PublicApiCatalog, resort: ResortWithData): SerializeOptions {
  const elevationRow = catalog.elevations[resort.id];
  const elevation: ResortElevation | null = elevationRow
    ? { baseFt: elevationRow.base_ft, summitFt: elevationRow.summit_ft }
    : null;
  return {
    now: catalog.now,
    opening: catalog.openings.get(resort.id) ?? null,
    elevation,
    // An index that exists but has no row for this resort means "no station within 25 km": an empty list, not an absent block.
    observationStations: catalog.stations ? (catalog.stations[resort.id] ?? []) : null,
  };
}

/** Slugs are lowercase kebab-case; anything else is a 404 without a lookup. */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,99}$/.test(slug);
}

export function findResort(catalog: PublicApiCatalog, slug: string): ResortWithData | null {
  if (!isValidSlug(slug)) return null;
  return catalog.resorts.find((r) => r.slug === slug) ?? null;
}
