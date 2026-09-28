import type { Cam, ConditionRating, SnowReport } from "@/lib/types";

/**
 * Great-circle distance and the "Nearby resorts" ranking for /resorts/[slug]
 * (growth-audit S2). Pure functions over the resort list the ISR page already
 * holds — no fetching, no Date.now, no locale — so the rendered output is a
 * function of the data alone and node:test can pin it down.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** IUGG mean Earth radius (6371.0088 km) in statute miles. */
export const EARTH_RADIUS_MILES = 3958.7613;

const DEG_TO_RAD = Math.PI / 180;

/**
 * Haversine distance in miles between two lat/lng points. Good to ~0.3% on a
 * spherical Earth, which is plenty for "17 mi away"; NaN in either point
 * yields NaN rather than throwing, so callers filter on `Number.isFinite`.
 */
export function haversineMiles(a: GeoPoint, b: GeoPoint): number {
  const lat1 = a.lat * DEG_TO_RAD;
  const lat2 = b.lat * DEG_TO_RAD;
  const dLat = lat2 - lat1;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  // Clamp: rounding can push h a hair past 1 for antipodes, and asin(>1) is NaN.
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

/**
 * Whole miles for display. Anything that rounds to zero reads "<1 mi" rather
 * than "0 mi" — two resorts sharing a base area are close, not co-located.
 */
export function formatMiles(miles: number): string {
  const rounded = Math.round(miles);
  return rounded < 1 ? "<1 mi" : `${rounded} mi`;
}

// ── Nearby ranking ───────────────────────────────────────────────────────────

/** The subset of a resort row the ranking needs; ResortWithData satisfies it. */
export interface NearbyResortLike extends GeoPoint {
  slug: string;
  name: string;
  is_active: boolean;
  cams: Pick<Cam, "is_active">[];
}

export interface NearbyOptions {
  /** How many neighbours to return. */
  limit?: number;
  /** Farthest neighbour to consider, inclusive. */
  maxMiles?: number;
}

export const NEARBY_DEFAULT_LIMIT = 5;
export const NEARBY_DEFAULT_MAX_MILES = 150;

export interface NearbyHit<T extends NearbyResortLike = NearbyResortLike> {
  resort: T;
  /** Exact great-circle distance from the origin resort. */
  miles: number;
}

/** Lower-case, accent-stripped text so "Las Leñas" sorts with the L's. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function compareName(a: string, b: string): number {
  const fa = fold(a);
  const fb = fold(b);
  if (fa !== fb) return fa < fb ? -1 : 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

function hasActiveCam(resort: NearbyResortLike): boolean {
  return resort.cams.some((cam) => cam.is_active);
}

/**
 * The closest active resorts to `origin`, nearest first. `origin` itself is
 * excluded by slug, as is anything inactive or without finite coordinates.
 *
 * Order is by *displayed* distance — whole miles, as `formatMiles` shows
 * them — so two resorts the card labels "12 mi" are a tie, and the tie goes
 * to the one with a live cam (the reason a visitor would click through), then
 * to the exact distance, then to name so the list never flips between
 * renders. The exact `miles` is still returned for the compare link and tests.
 */
export function nearbyResorts<T extends NearbyResortLike>(
  origin: Pick<NearbyResortLike, "slug" | "lat" | "lng">,
  all: readonly T[],
  { limit = NEARBY_DEFAULT_LIMIT, maxMiles = NEARBY_DEFAULT_MAX_MILES }: NearbyOptions = {},
): NearbyHit<T>[] {
  if (limit <= 0 || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) return [];

  const hits: NearbyHit<T>[] = [];
  for (const resort of all) {
    if (resort.slug === origin.slug || !resort.is_active) continue;
    if (!Number.isFinite(resort.lat) || !Number.isFinite(resort.lng)) continue;
    const miles = haversineMiles(origin, resort);
    if (!Number.isFinite(miles) || miles > maxMiles) continue;
    hits.push({ resort, miles });
  }

  hits.sort((a, b) => {
    const byShownDistance = Math.round(a.miles) - Math.round(b.miles);
    if (byShownDistance !== 0) return byShownDistance;
    const byCam = Number(hasActiveCam(b.resort)) - Number(hasActiveCam(a.resort));
    if (byCam !== 0) return byCam;
    if (a.miles !== b.miles) return a.miles - b.miles;
    return compareName(a.resort.name, b.resort.name);
  });

  return hits.slice(0, limit);
}

// ── Card summaries ───────────────────────────────────────────────────────────

/**
 * What the resort page ships to the client for each neighbour. The page
 * computes these server-side from the full list so the client bundle never
 * sees the other ~147 resorts and their cam rows — only these ≤5 rows.
 */
export interface NearbyResortSummary {
  slug: string;
  name: string;
  /** Exact distance; the card rounds it with `formatMiles`. */
  miles: number;
  baseDepth: number | null;
  newSnow24h: number | null;
  /** Active cams only. */
  camCount: number;
  rating: ConditionRating | null;
}

/** The subset of a resort row the summary needs; ResortWithData satisfies it. */
export interface NearbySummaryResortLike extends NearbyResortLike {
  cond_rating: ConditionRating | null;
  snow_report: Pick<SnowReport, "base_depth" | "new_snow_24h"> | null;
}

const RATINGS = new Set<string>(["great", "good", "fair", "poor"]);

/** Guards against whatever the DB actually holds — the column is text with a CHECK, not an enum in JS. */
function isRating(value: unknown): value is ConditionRating {
  return typeof value === "string" && RATINGS.has(value);
}

/** Non-finite numbers (a NaN from a bad import) become null so the card shows "—", not "NaN″". */
function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function summarizeNearby<T extends NearbySummaryResortLike>(hits: readonly NearbyHit<T>[]): NearbyResortSummary[] {
  return hits.map(({ resort, miles }) => ({
    slug: resort.slug,
    name: resort.name,
    miles,
    baseDepth: finiteOrNull(resort.snow_report?.base_depth),
    newSnow24h: finiteOrNull(resort.snow_report?.new_snow_24h),
    camCount: resort.cams.filter((cam) => cam.is_active).length,
    rating: isRating(resort.cond_rating) ? resort.cond_rating : null,
  }));
}
