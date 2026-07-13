// ─────────────────────────────────────────────────────────────
// PeakCam — Map Utility Functions
// Pure functions for GeoJSON conversion, condition colors,
// bounding box computation, and default view state.
// ─────────────────────────────────────────────────────────────

import type { ResortWithData, ConditionRating } from "@/lib/types";

// ── Types ────────────────────────────────────────────────────

export interface ResortFeatureProperties {
  slug: string;
  name: string;
  state: string;
  region: string;
  condRating: ConditionRating;
  offSeason: boolean;
  baseDepth: number | null;
  snow24h: number | null;
  snow48h: number | null;
  trailsOpen: number | null;
  trailsTotal: number | null;
  liftsOpen: number | null;
  liftsTotal: number | null;
  camCount: number;
  conditions: string | null;
}

// ── Off-season heuristic ─────────────────────────────────────
//
// A resort is "off-season" when the current month falls in the local warm half
// of the year. This is a DISPLAY heuristic only (no schema/data change): it lets
// summer resorts render as a neutral "Off-season" marker instead of a false red
// "Poor" dot — the rating engine still scores base depth as usual.
//
// Hemisphere comes from latitude. Northern ski season is treated as Nov–Apr,
// Southern (Andes) as May–Oct — a clean symmetric split. Deliberately crude at
// the shoulders (an early-Nov opening or summer glacier skiing may misclassify);
// the tradeoff is zero new data and full reversibility.
export function isOffSeason(lat: number, date: Date): boolean {
  const month = date.getMonth() + 1; // 1–12
  const northern = lat >= 0;
  const inSeason = northern
    ? month >= 11 || month <= 4 // Nov–Apr
    : month >= 5 && month <= 10; // May–Oct
  return !inSeason;
}

export interface ResortFeature {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [longitude: number, latitude: number];
  };
  properties: ResortFeatureProperties;
}

export interface ResortFeatureCollection {
  type: "FeatureCollection";
  features: ResortFeature[];
}

export type MapMetric = "baseDepth" | "snow24h" | "conditions";

// ── GeoJSON Conversion ───────────────────────────────────────

export function resortsToGeoJSON(
  resorts: ResortWithData[],
  now: Date = new Date()
): ResortFeatureCollection {
  return {
    type: "FeatureCollection",
    features: resorts.map((resort) => {
      const snow = resort.snow_report;
      return {
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [resort.lng, resort.lat] as [number, number],
        },
        properties: {
          slug: resort.slug,
          name: resort.name,
          state: resort.state,
          region: resort.region,
          condRating: resort.cond_rating,
          offSeason: isOffSeason(resort.lat, now),
          baseDepth: snow?.base_depth ?? null,
          snow24h: snow?.new_snow_24h ?? null,
          snow48h: snow?.new_snow_48h ?? null,
          trailsOpen: snow?.trails_open ?? null,
          trailsTotal: snow?.trails_total ?? null,
          liftsOpen: snow?.lifts_open ?? null,
          liftsTotal: snow?.lifts_total ?? null,
          camCount: resort.cams.length,
          conditions: snow?.conditions 
            ? (snow.conditions.includes("||") ? snow.conditions.split("||")[1] : snow.conditions)
            : null,
        },
      };
    }),
  };
}

// ── Condition Colors ─────────────────────────────────────────

// Earth palette — matches MapView markers and ConditionBadge
const CONDITION_COLORS: Record<ConditionRating, string> = {
  great: "#3c5a3a",   // pc-forest
  good:  "#6d8a4a",   // pc-good (moss)
  fair:  "#e2a740",   // pc-mustard
  poor:  "#a93f20",   // pc-alpen-dk
};

export function conditionColor(rating: ConditionRating): string {
  return CONDITION_COLORS[rating];
}

/** Neutral fill for off-season / closed markers and chips (hue-neutral bark). */
export const OFF_SEASON_COLOR = "#b59b74";

/** "3h ago" / "just now" from an ISO timestamp; null if absent/unparseable. */
export function timeAgo(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ── Metric Display ───────────────────────────────────────────

export function metricValue(
  props: ResortFeatureProperties,
  metric: MapMetric
): string {
  switch (metric) {
    case "baseDepth":
      return props.baseDepth != null ? `${props.baseDepth}"` : "—";
    case "snow24h":
      return props.snow24h != null ? `${props.snow24h}"` : "—";
    case "conditions": {
      const label =
        props.condRating.charAt(0).toUpperCase() + props.condRating.slice(1);
      return label;
    }
  }
}

export function metricLabel(metric: MapMetric): string {
  switch (metric) {
    case "baseDepth":
      return "Base Depth";
    case "snow24h":
      return "24h Snow";
    case "conditions":
      return "Condition";
  }
}

// ── Bounding Box ─────────────────────────────────────────────

/**
 * Computes a [west, south, east, north] bounding box for an array of resorts.
 * Adds 10% padding on each side. Returns null if the array is empty.
 */
export function resortBounds(
  resorts: ResortWithData[]
): [west: number, south: number, east: number, north: number] | null {
  if (resorts.length === 0) return null;

  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  for (const r of resorts) {
    if (r.lng < west) west = r.lng;
    if (r.lng > east) east = r.lng;
    if (r.lat < south) south = r.lat;
    if (r.lat > north) north = r.lat;
  }

  const lngPad = (east - west) * 0.1 || 1;
  const latPad = (north - south) * 0.1 || 1;

  return [west - lngPad, south - latPad, east + lngPad, north + latPad];
}

// ── Default View State ───────────────────────────────────────

export const DEFAULT_VIEW_STATE = {
  longitude: -108,
  latitude: 41.5,
  zoom: 4,
  pitch: 0,
  bearing: 0,
} as const;
