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
  resorts: ResortWithData[]
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
          baseDepth: snow?.base_depth ?? null,
          snow24h: snow?.new_snow_24h ?? null,
          snow48h: snow?.new_snow_48h ?? null,
          trailsOpen: snow?.trails_open ?? null,
          trailsTotal: snow?.trails_total ?? null,
          liftsOpen: snow?.lifts_open ?? null,
          liftsTotal: snow?.lifts_total ?? null,
          camCount: resort.cams.length,
          conditions: snow?.conditions ?? null,
        },
      };
    }),
  };
}

// ── Condition Colors ─────────────────────────────────────────

const CONDITION_COLORS: Record<ConditionRating, string> = {
  great: "#2ECC8F",
  good: "#60C8FF",
  fair: "#8AA3BE",
  poor: "#f87171",
};

export function conditionColor(rating: ConditionRating): string {
  return CONDITION_COLORS[rating];
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
