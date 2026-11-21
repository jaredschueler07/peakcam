/**
 * Which resorts may head the homepage "Best right now" strip.
 *
 * Pure: the strip (components/browse/BrowsePage.tsx FeaturedRow) and the dated
 * leaders sentence above it (app/page.tsx) both call this, so the names in the
 * sentence are the names on the cards.
 *
 * The gate exists because the strip sends the most traffic to four pages. A
 * resort is a candidate only when
 *   - it has a snow report and a condition rating,
 *   - it is in season for its hemisphere (lib/map-utils isOffSeason), and
 *   - it has at least MIN_FEATURED_CAMS active resort cams. `ResortWithData.cams`
 *     holds active rows only (lib/supabase getAllResorts), so a cam the health
 *     check auto-disabled is already absent; DOT road cams (kind "approach")
 *     do not count, they show the highway, not the mountain.
 *
 * Operating status is not part of the gate: the homepage dataset does not
 * carry it and this module adds no query.
 */

import { isOffSeason } from "@/lib/map-utils";
import type { ResortWithData } from "@/lib/types";

export const MIN_FEATURED_CAMS = 2;
export const FEATURED_LIMIT = 4;

const CONDITION_ORDER: Record<string, number> = { great: 0, good: 1, fair: 2, poor: 3 };

type FeaturedResort = Pick<ResortWithData, "id" | "lat" | "cond_rating" | "snow_report" | "cams">;

/** Today's score per resort id; only the two fields the ranking reads. */
export type FeaturedScoreIndex = Readonly<Record<string, { score: number; rating: string } | undefined>>;

/** Active resort cams, road cams excluded. */
export function featuredCamCount(resort: Pick<ResortWithData, "cams">): number {
  return (resort.cams ?? []).filter((c) => c.is_active && c.kind !== "approach").length;
}

export function isFeaturedCandidate(resort: FeaturedResort, now: Date): boolean {
  if (!resort.snow_report || !resort.cond_rating) return false;
  // In-season only: a stale "great" on a summer-closed resort shouldn't
  // headline the strip (matches the map's off-season treatment).
  if (isOffSeason(resort.lat, now)) return false;
  return featuredCamCount(resort) >= MIN_FEATURED_CAMS;
}

/**
 * The strip's resorts, best first, at most `limit`. With a non-empty score
 * index the order is today's Snow Score (a resort without a score sorts last),
 * otherwise the condition rating; new snow in 24 h breaks ties either way.
 * Returns [] when none of the picks is better than "poor" (by score) or at
 * least "good" (by rating): an all-poor strip says nothing.
 */
export function pickFeatured<T extends FeaturedResort>(
  resorts: readonly T[],
  scores: FeaturedScoreIndex | null | undefined,
  now: Date,
  limit: number = FEATURED_LIMIT,
): T[] {
  const candidates = resorts.filter((r) => isFeaturedCandidate(r, now));
  const newSnow = (r: T) => r.snow_report?.new_snow_24h ?? 0;
  if (scores && Object.keys(scores).length) {
    const score = (r: T) => scores[r.id]?.score ?? -1;
    const sorted = [...candidates].sort((a, b) => score(b) - score(a) || newSnow(b) - newSnow(a)).slice(0, limit);
    return sorted.some((r) => (scores[r.id]?.rating ?? "poor") !== "poor") ? sorted : [];
  }
  const sorted = [...candidates]
    .sort((a, b) => (CONDITION_ORDER[a.cond_rating] ?? 99) - (CONDITION_ORDER[b.cond_rating] ?? 99) || newSnow(b) - newSnow(a))
    .slice(0, limit);
  return sorted.some((r) => r.cond_rating === "great" || r.cond_rating === "good") ? sorted : [];
}
