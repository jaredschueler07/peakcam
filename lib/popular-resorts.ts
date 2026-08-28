/**
 * The curated "popular" ordering, shared by every surface that needs it.
 *
 * This used to live inside `components/browse/BrowsePage.tsx`, which is a
 * `"use client"` module — importing it anywhere else dragged Fuse.js and the
 * whole browse bundle along, so the 404 page kept its own hand-copied list
 * instead. Plain data with no imports, so a Server Component can pull it in
 * for free.
 */

/** Drives the "Popular" sort on the browse page. Order is the ranking. */
export const POPULAR_SLUGS: readonly string[] = [
  "vail",
  "aspen-snowmass",
  "park-city",
  "jackson-hole",
  "whistler-blackcomb",
  "mammoth",
  "breckenridge",
  "palisades-tahoe",
  "big-sky",
  "killington",
  "stowe",
  "alta",
  // South America launch — strongest cam coverage + name recognition
  "ski-portillo",
  "valle-nevado",
  "cerro-catedral",
  "las-lenas",
];

/** slug → position in `POPULAR_SLUGS`. Absent slugs sort after all of these. */
export const POPULAR_RANK: Record<string, number> = Object.fromEntries(
  POPULAR_SLUGS.map((slug, idx) => [slug, idx]),
);

export interface PopularResortLink {
  slug: string;
  /** Short pill label — deliberately shorter than the DB's `resorts.name`. */
  name: string;
}

/**
 * A hand-picked subset of the ordering above, with display names, for link
 * lists (the 404 page's "Popular mountains" pills). Kept short on purpose:
 * these are escape hatches, not a directory. Every slug here must appear in
 * `POPULAR_SLUGS` — `lib/popular-resorts.test.ts` enforces that.
 */
export const POPULAR_RESORTS: readonly PopularResortLink[] = [
  { slug: "vail", name: "Vail" },
  { slug: "breckenridge", name: "Breckenridge" },
  { slug: "park-city", name: "Park City" },
  { slug: "jackson-hole", name: "Jackson Hole" },
  { slug: "palisades-tahoe", name: "Palisades Tahoe" },
  { slug: "ski-portillo", name: "Portillo" },
];
