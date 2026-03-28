# Map Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat Leaflet map with a MapLibre GL JS-powered interactive map featuring 3D terrain, data-badge markers, clustering, weather overlays, a full-page map view, and mobile support.

**Architecture:** Migrate from Leaflet (DOM-based, 2D) to MapLibre GL JS (WebGL, 3D) via `react-map-gl`. The map lives in two contexts: a sidebar on the browse page and a dedicated full-page `/map` route. Markers use GeoJSON source layers with data-driven styling. Weather radar comes from RainViewer (free, no key). Terrain tiles from MapTiler free tier.

**Tech Stack:** MapLibre GL JS, react-map-gl, @maplibre/maplibre-gl-js, supercluster (clustering), MapTiler terrain tiles, RainViewer radar API

---

## File Structure

```
lib/
  map-utils.ts              — CREATE — GeoJSON builder, marker color logic, fit-bounds helpers
  weather-radar.ts           — CREATE — RainViewer API client (fetch radar timestamps + tile URLs)

components/
  map/
    MapView.tsx              — CREATE — Core MapLibre map component (shared between sidebar + fullpage)
    MapMarker.tsx            — CREATE — Data-badge marker layer (GeoJSON symbol + HTML overlay)
    MapPopupCard.tsx         — CREATE — Rich popup card on marker click (snow stats, condition, cam count)
    MapBottomSheet.tsx       — CREATE — Mobile bottom sheet for marker selection
    MapControls.tsx          — CREATE — Custom controls (metric toggle, layer toggles, fullscreen)
    MapWeatherOverlay.tsx    — CREATE — RainViewer radar tile layer with toggle
    index.ts                 — CREATE — Barrel export

  browse/
    ResortMap.tsx             — DELETE — Old Leaflet component (replaced by MapView)
    BrowsePage.tsx            — MODIFY — Swap ResortMap import to new MapView

app/
  map/
    page.tsx                 — CREATE — Full-page map route (server component)

  globals.css                — MODIFY — Add maplibre-gl CSS import, remove leaflet CSS import
  layout.tsx                 — NO CHANGE

.env.local.example           — MODIFY — Add NEXT_PUBLIC_MAPTILER_KEY
tailwind.config.ts           — MODIFY — Add bottom-sheet animation keyframes
next.config.ts               — MODIFY — Add maplibre transpile config if needed
package.json                 — MODIFY — Add new deps, remove leaflet
```

---

## Task 1: Install Dependencies & Configure Environment

**Files:**
- Modify: `package.json`
- Modify: `.env.local.example`
- Modify: `app/globals.css`
- Modify: `next.config.ts`

- [ ] **Step 1: Install MapLibre GL JS and react-map-gl**

```bash
npm install maplibre-gl react-map-gl supercluster
npm install --save-dev @types/supercluster
```

Note: Do NOT uninstall leaflet yet — the old map still uses it. We'll remove it after the swap.

- [ ] **Step 2: Add MapTiler API key to env example**

Add to `.env.local.example`:
```
# Map tiles (MapTiler free tier — 300k sessions/mo)
NEXT_PUBLIC_MAPTILER_KEY=your_maptiler_api_key_here
```

Also add the actual key to `.env.local` if available. If no key is available, the map component should fall back to a free tile source (Carto Dark Matter raster).

- [ ] **Step 3: Update globals.css — add maplibre CSS, keep leaflet for now**

In `app/globals.css`, add `maplibre-gl` CSS import at the top (alongside the existing leaflet import — we'll remove leaflet later):

```css
@import "maplibre-gl/dist/maplibre-gl.css";
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.local.example app/globals.css
git commit -m "chore: add maplibre-gl, react-map-gl, supercluster deps"
```

---

## Task 2: Create Map Utilities (`lib/map-utils.ts`)

**Files:**
- Create: `lib/map-utils.ts`

This module provides pure functions used by all map components. No React, no side effects.

- [ ] **Step 1: Create `lib/map-utils.ts`**

```typescript
import type { ResortWithData, ConditionRating } from "./types";

// ── GeoJSON builder ──────────────────────────────────────────────

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

export type ResortFeature = GeoJSON.Feature<GeoJSON.Point, ResortFeatureProperties>;
export type ResortFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Point, ResortFeatureProperties>;

/** Convert ResortWithData[] to GeoJSON FeatureCollection for MapLibre. */
export function resortsToGeoJSON(resorts: ResortWithData[]): ResortFeatureCollection {
  return {
    type: "FeatureCollection",
    features: resorts
      .filter((r) => r.lat && r.lng)
      .map((r): ResortFeature => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [r.lng, r.lat], // GeoJSON is [lng, lat]
        },
        properties: {
          slug: r.slug,
          name: r.name,
          state: r.state,
          region: r.region,
          condRating: r.cond_rating,
          baseDepth: r.snow_report?.base_depth ?? null,
          snow24h: r.snow_report?.new_snow_24h ?? null,
          snow48h: r.snow_report?.new_snow_48h ?? null,
          trailsOpen: r.snow_report?.trails_open ?? null,
          trailsTotal: r.snow_report?.trails_total ?? null,
          liftsOpen: r.snow_report?.lifts_open ?? null,
          liftsTotal: r.snow_report?.lifts_total ?? null,
          camCount: r.cams.filter((c) => c.is_active).length,
          conditions: r.snow_report?.conditions ?? null,
        },
      })),
  };
}

// ── Marker colors ────────────────────────────────────────────────

/** Condition rating → design system color (matches tailwind.config.ts). */
const CONDITION_COLORS: Record<ConditionRating, string> = {
  great: "#2ECC8F", // powder green
  good:  "#60C8FF", // ice blue / cyan
  fair:  "#8AA3BE", // muted blue
  poor:  "#f87171", // red
};

export function conditionColor(rating: ConditionRating): string {
  return CONDITION_COLORS[rating] ?? "#8AA3BE";
}

/** Marker display value based on selected metric. */
export type MapMetric = "baseDepth" | "snow24h" | "conditions";

export function metricValue(props: ResortFeatureProperties, metric: MapMetric): string {
  switch (metric) {
    case "baseDepth":
      return props.baseDepth != null ? `${props.baseDepth}"` : "—";
    case "snow24h":
      return props.snow24h != null ? `${props.snow24h}"` : "—";
    case "conditions":
      return props.condRating?.charAt(0).toUpperCase() + props.condRating?.slice(1) ?? "—";
  }
}

export function metricLabel(metric: MapMetric): string {
  switch (metric) {
    case "baseDepth": return "Base Depth";
    case "snow24h": return "24h Snow";
    case "conditions": return "Condition";
  }
}

// ── Bounds ────────────────────────────────────────────────────────

/** Compute [west, south, east, north] bounding box from resorts. */
export function resortBounds(resorts: ResortWithData[]): [number, number, number, number] | null {
  const valid = resorts.filter((r) => r.lat && r.lng);
  if (valid.length === 0) return null;

  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const r of valid) {
    if (r.lng < west) west = r.lng;
    if (r.lng > east) east = r.lng;
    if (r.lat < south) south = r.lat;
    if (r.lat > north) north = r.lat;
  }

  // Add small padding
  const lngPad = (east - west) * 0.1 || 1;
  const latPad = (north - south) * 0.1 || 1;
  return [west - lngPad, south - latPad, east + lngPad, north + latPad];
}

// ── Tile URLs ────────────────────────────────────────────────────

/** MapTiler dark terrain style URL (requires API key). */
export function mapTilerStyleUrl(apiKey: string | undefined): string {
  if (apiKey) {
    return `https://api.maptiler.com/maps/landscape-dark/style.json?key=${apiKey}`;
  }
  // Fallback: free Carto dark matter (no terrain, but works without key)
  return "";
}

/** Carto Dark Matter raster tile URL (fallback — no API key needed). */
export const CARTO_DARK_TILES = "https://{s}.basemaps.cartocdn.com/dark_matter/{z}/{x}/{y}{r}.png";

// ── Default view state ───────────────────────────────────────────

export const DEFAULT_VIEW_STATE = {
  longitude: -108,
  latitude: 41.5,
  zoom: 4,
  pitch: 0,
  bearing: 0,
} as const;
```

- [ ] **Step 2: Commit**

```bash
git add lib/map-utils.ts
git commit -m "feat(map): add map utility functions — GeoJSON builder, colors, bounds"
```

---

## Task 3: Create Weather Radar Client (`lib/weather-radar.ts`)

**Files:**
- Create: `lib/weather-radar.ts`

- [ ] **Step 1: Create `lib/weather-radar.ts`**

RainViewer provides free precipitation radar tiles with no API key. We fetch their timestamp index, then use the latest radar frame as a tile layer.

```typescript
// ─────────────────────────────────────────────────────────────
// RainViewer Radar — Free precipitation radar tile overlay
// No API key required. Tiles update every ~10 minutes.
// Docs: https://www.rainviewer.com/api.html
// ─────────────────────────────────────────────────────────────

interface RainViewerMaps {
  radar: { past: { time: number; path: string }[]; nowcast: { time: number; path: string }[] };
}

interface RainViewerResponse {
  generated: number;
  host: string;
  radar: RainViewerMaps["radar"];
}

export interface RadarFrame {
  /** Unix timestamp of this radar frame */
  time: number;
  /** Full tile URL template — plug into a MapLibre raster source */
  tileUrl: string;
}

const RAINVIEWER_API = "https://api.rainviewer.com/public/weather-maps.json";

/**
 * Fetch the latest radar frame URLs from RainViewer.
 * Returns the most recent past frame + any nowcast frames.
 * Each URL is a raster tile template: `{tileUrl}/{z}/{x}/{y}/2/1_1.png`
 */
export async function getRadarFrames(): Promise<RadarFrame[]> {
  try {
    const res = await fetch(RAINVIEWER_API, { next: { revalidate: 300 } }); // cache 5 min
    if (!res.ok) return [];
    const data: RainViewerResponse = await res.json();

    const host = data.host;
    const frames: RadarFrame[] = [];

    // Past radar frames (last ~2 hours)
    for (const frame of data.radar.past.slice(-6)) {
      frames.push({
        time: frame.time,
        tileUrl: `${host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`,
      });
    }

    // Nowcast (forecast) frames
    for (const frame of data.radar.nowcast) {
      frames.push({
        time: frame.time,
        tileUrl: `${host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`,
      });
    }

    return frames;
  } catch {
    console.warn("[PeakCam] Could not fetch radar data from RainViewer");
    return [];
  }
}

/**
 * Get just the latest single radar frame tile URL.
 * Use this for a simple "show radar" toggle.
 */
export async function getLatestRadarTileUrl(): Promise<string | null> {
  const frames = await getRadarFrames();
  if (frames.length === 0) return null;
  // Use the most recent past frame (most accurate)
  const pastFrames = frames.filter((f) => f.time <= Date.now() / 1000);
  return pastFrames.length > 0 ? pastFrames[pastFrames.length - 1].tileUrl : frames[0].tileUrl;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/weather-radar.ts
git commit -m "feat(map): add RainViewer radar client for weather overlay"
```

---

## Task 4: Create Core MapView Component

**Files:**
- Create: `components/map/MapView.tsx`

This is the heart of the new map. It renders a MapLibre GL JS map with `react-map-gl`, handles GeoJSON sources, marker rendering, and accepts props for the sidebar vs full-page contexts.

- [ ] **Step 1: Create `components/map/MapView.tsx`**

```tsx
"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import Map, {
  Source,
  Layer,
  NavigationControl,
  GeolocateControl,
  ScaleControl,
  Popup,
  type MapRef,
  type ViewStateChangeEvent,
  type MapLayerMouseEvent,
} from "react-map-gl/maplibre";
import maplibregl from "maplibre-gl";
import type { ResortWithData } from "@/lib/types";
import type { ResortFeatureProperties, MapMetric } from "@/lib/map-utils";
import {
  resortsToGeoJSON,
  conditionColor,
  metricValue,
  resortBounds,
  DEFAULT_VIEW_STATE,
} from "@/lib/map-utils";
import { MapPopupCard } from "./MapPopupCard";
import { MapControls } from "./MapControls";
import { MapWeatherOverlay } from "./MapWeatherOverlay";

// ── Tile style (MapTiler dark terrain or Carto fallback) ─────────

function getMapStyle(apiKey: string | undefined): maplibregl.StyleSpecification | string {
  if (apiKey) {
    return `https://api.maptiler.com/maps/landscape-dark/style.json?key=${apiKey}`;
  }
  // Fallback raster style — Carto Dark Matter (no terrain, but free)
  return {
    version: 8 as const,
    name: "carto-dark",
    sources: {
      "carto-dark": {
        type: "raster" as const,
        tiles: [
          "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
          "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
          "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
        ],
        tileSize: 256,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      },
    },
    layers: [{ id: "carto-dark-layer", type: "raster" as const, source: "carto-dark" }],
  };
}

// ── Props ─────────────────────────────────────────────────────────

interface MapViewProps {
  resorts: ResortWithData[];
  hoveredSlug?: string | null;
  onResortHover?: (slug: string | null) => void;
  onResortClick?: (slug: string) => void;
  /** "sidebar" = browse page sidebar, "fullpage" = /map route */
  variant?: "sidebar" | "fullpage";
  /** Initial radar tile URL (fetched server-side) */
  radarTileUrl?: string | null;
  className?: string;
}

// ── Component ─────────────────────────────────────────────────────

export function MapView({
  resorts,
  hoveredSlug,
  onResortHover,
  onResortClick,
  variant = "sidebar",
  radarTileUrl = null,
  className = "",
}: MapViewProps) {
  const mapRef = useRef<MapRef>(null);
  const maptilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  const mapStyle = useMemo(() => getMapStyle(maptilerKey), [maptilerKey]);

  const [viewState, setViewState] = useState(DEFAULT_VIEW_STATE);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [metric, setMetric] = useState<MapMetric>("baseDepth");
  const [showRadar, setShowRadar] = useState(false);
  const [cursor, setCursor] = useState<string>("grab");

  // Build GeoJSON from resorts
  const geojson = useMemo(() => resortsToGeoJSON(resorts), [resorts]);

  // Find selected resort for popup
  const selectedResort = useMemo(
    () => (selectedSlug ? resorts.find((r) => r.slug === selectedSlug) ?? null : null),
    [selectedSlug, resorts]
  );

  // Fit bounds when filtered resorts change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || resorts.length === 0) return;

    const bounds = resortBounds(resorts);
    if (!bounds) return;

    map.fitBounds(bounds as [number, number, number, number], {
      padding: variant === "sidebar" ? 40 : 80,
      duration: 800,
    });
  }, [resorts, variant]);

  // ── Interaction handlers ────────────────────────────────────────

  const onMouseEnter = useCallback(() => setCursor("pointer"), []);
  const onMouseLeave = useCallback(() => {
    setCursor("grab");
    onResortHover?.(null);
  }, [onResortHover]);

  const onMouseMove = useCallback(
    (e: MapLayerMouseEvent) => {
      if (e.features && e.features.length > 0) {
        const slug = e.features[0].properties?.slug;
        if (slug) onResortHover?.(slug);
      }
    },
    [onResortHover]
  );

  const onClick = useCallback(
    (e: MapLayerMouseEvent) => {
      if (e.features && e.features.length > 0) {
        const props = e.features[0].properties as ResortFeatureProperties;
        setSelectedSlug(props.slug);

        // Fly to the clicked resort
        const coords = (e.features[0].geometry as GeoJSON.Point).coordinates;
        mapRef.current?.flyTo({
          center: [coords[0], coords[1]],
          zoom: Math.max(mapRef.current?.getZoom() ?? 6, 8),
          duration: 600,
        });
      } else {
        setSelectedSlug(null);
      }
    },
    []
  );

  const handlePopupClose = useCallback(() => setSelectedSlug(null), []);

  const handleViewResort = useCallback(
    (slug: string) => {
      onResortClick?.(slug);
    },
    [onResortClick]
  );

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className={`relative w-full h-full ${className}`}>
      <Map
        ref={mapRef}
        {...viewState}
        onMove={(e: ViewStateChangeEvent) => setViewState(e.viewState)}
        mapLib={maplibregl}
        mapStyle={mapStyle}
        cursor={cursor}
        interactiveLayerIds={["resort-markers"]}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onMouseMove={onMouseMove}
        onClick={onClick}
        attributionControl={true}
        reuseMaps
      >
        {/* Navigation controls */}
        <NavigationControl position="top-right" showCompass visualizePitch />
        {variant === "fullpage" && <GeolocateControl position="top-right" />}
        <ScaleControl position="bottom-left" />

        {/* Resort markers — circle layer */}
        <Source id="resorts" type="geojson" data={geojson}>
          <Layer
            id="resort-markers"
            type="circle"
            paint={{
              "circle-radius": [
                "case",
                ["==", ["get", "slug"], hoveredSlug ?? ""],
                10,
                7,
              ],
              "circle-color": [
                "match",
                ["get", "condRating"],
                "great", "#2ECC8F",
                "good", "#60C8FF",
                "fair", "#8AA3BE",
                "poor", "#f87171",
                "#8AA3BE",
              ],
              "circle-stroke-width": [
                "case",
                ["==", ["get", "slug"], hoveredSlug ?? ""],
                2.5,
                1.5,
              ],
              "circle-stroke-color": [
                "case",
                ["==", ["get", "slug"], hoveredSlug ?? ""],
                "#ffffff",
                "rgba(255,255,255,0.3)",
              ],
              "circle-opacity": 0.9,
            }}
          />

          {/* Data labels at higher zoom */}
          <Layer
            id="resort-labels"
            type="symbol"
            minzoom={6}
            layout={{
              "text-field": [
                "case",
                ["!=", ["get", "baseDepth"], null],
                ["concat", ["to-string", ["get", "baseDepth"]], '"'],
                "—",
              ],
              "text-size": 11,
              "text-offset": [0, -1.8],
              "text-anchor": "bottom",
              "text-font": ["Open Sans Bold"],
              "text-allow-overlap": false,
            }}
            paint={{
              "text-color": "#E8F0F8",
              "text-halo-color": "#080D14",
              "text-halo-width": 1.5,
            }}
          />

          {/* Resort name labels at high zoom */}
          <Layer
            id="resort-name-labels"
            type="symbol"
            minzoom={8}
            layout={{
              "text-field": ["get", "name"],
              "text-size": 12,
              "text-offset": [0, 1.2],
              "text-anchor": "top",
              "text-font": ["Open Sans Semibold"],
              "text-allow-overlap": false,
              "text-max-width": 10,
            }}
            paint={{
              "text-color": "#8AA3BE",
              "text-halo-color": "#080D14",
              "text-halo-width": 1,
            }}
          />
        </Source>

        {/* Weather radar overlay */}
        {showRadar && radarTileUrl && (
          <MapWeatherOverlay tileUrl={radarTileUrl} />
        )}

        {/* Selected resort popup */}
        {selectedResort && (
          <Popup
            longitude={selectedResort.lng}
            latitude={selectedResort.lat}
            onClose={handlePopupClose}
            closeButton={true}
            closeOnClick={false}
            anchor="bottom"
            offset={16}
            maxWidth="320px"
            className="peakcam-maplibre-popup"
          >
            <MapPopupCard
              resort={selectedResort}
              onViewResort={handleViewResort}
            />
          </Popup>
        )}
      </Map>

      {/* Custom controls overlay */}
      <MapControls
        metric={metric}
        onMetricChange={setMetric}
        showRadar={showRadar}
        onToggleRadar={() => setShowRadar((v) => !v)}
        radarAvailable={!!radarTileUrl}
        variant={variant}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/map/MapView.tsx
git commit -m "feat(map): create core MapView component with MapLibre GL JS"
```

---

## Task 5: Create MapPopupCard Component

**Files:**
- Create: `components/map/MapPopupCard.tsx`

Rich popup shown when a marker is clicked. Shows snow stats, condition badge, cam count, and a link to the detail page.

- [ ] **Step 1: Create `components/map/MapPopupCard.tsx`**

```tsx
"use client";

import type { ResortWithData } from "@/lib/types";
import { conditionColor } from "@/lib/map-utils";

interface Props {
  resort: ResortWithData;
  onViewResort: (slug: string) => void;
}

export function MapPopupCard({ resort, onViewResort }: Props) {
  const snow = resort.snow_report;
  const color = conditionColor(resort.cond_rating);
  const camCount = resort.cams.filter((c) => c.is_active).length;

  return (
    <div className="min-w-[240px]">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="text-text-base font-semibold text-sm leading-tight">{resort.name}</h3>
          <p className="text-text-muted text-xs mt-0.5">{resort.region}, {resort.state}</p>
        </div>
        <span
          className="px-2 py-0.5 rounded text-[10px] font-bold shrink-0 uppercase"
          style={{
            backgroundColor: `${color}20`,
            color,
            border: `1px solid ${color}40`,
          }}
        >
          {resort.cond_rating}
        </span>
      </div>

      {/* Snow stats grid */}
      {snow && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="bg-bg/60 rounded px-2 py-1.5 text-center">
            <div className="text-powder font-mono font-bold text-base leading-none">
              {snow.base_depth ?? "—"}
            </div>
            <div className="text-text-muted text-[9px] mt-0.5">base&quot;</div>
          </div>
          <div className="bg-bg/60 rounded px-2 py-1.5 text-center">
            <div className="text-cyan font-mono font-bold text-base leading-none">
              {snow.new_snow_24h ?? "—"}
            </div>
            <div className="text-text-muted text-[9px] mt-0.5">24h&quot;</div>
          </div>
          <div className="bg-bg/60 rounded px-2 py-1.5 text-center">
            <div className="text-text-base font-mono font-bold text-base leading-none">
              {snow.trails_open != null && snow.trails_total != null
                ? `${snow.trails_open}/${snow.trails_total}`
                : "—"}
            </div>
            <div className="text-text-muted text-[9px] mt-0.5">runs</div>
          </div>
        </div>
      )}

      {/* Footer: cam count + view button */}
      <div className="flex items-center justify-between pt-2 border-t border-border">
        {camCount > 0 && (
          <span className="text-text-muted text-xs">
            {camCount} live cam{camCount !== 1 ? "s" : ""}
          </span>
        )}
        <button
          onClick={() => onViewResort(resort.slug)}
          className="ml-auto text-cyan text-xs font-semibold hover:underline cursor-pointer"
        >
          View Resort &rarr;
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/map/MapPopupCard.tsx
git commit -m "feat(map): add MapPopupCard for rich marker click popups"
```

---

## Task 6: Create MapControls Component

**Files:**
- Create: `components/map/MapControls.tsx`

Custom overlay controls for metric toggle (base depth / 24h snow / condition), radar toggle, and terrain toggle.

- [ ] **Step 1: Create `components/map/MapControls.tsx`**

```tsx
"use client";

import type { MapMetric } from "@/lib/map-utils";
import { metricLabel } from "@/lib/map-utils";

interface Props {
  metric: MapMetric;
  onMetricChange: (metric: MapMetric) => void;
  showRadar: boolean;
  onToggleRadar: () => void;
  radarAvailable: boolean;
  variant: "sidebar" | "fullpage";
}

const METRICS: MapMetric[] = ["baseDepth", "snow24h", "conditions"];

export function MapControls({
  metric,
  onMetricChange,
  showRadar,
  onToggleRadar,
  radarAvailable,
  variant,
}: Props) {
  return (
    <div className="absolute top-3 left-3 z-10 flex flex-col gap-2">
      {/* Metric toggle */}
      <div className="flex gap-1 bg-surface/90 backdrop-blur-md border border-border rounded-lg p-1">
        {METRICS.map((m) => (
          <button
            key={m}
            onClick={() => onMetricChange(m)}
            className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors duration-150 ${
              metric === m
                ? "bg-cyan/20 text-cyan border border-cyan/30"
                : "text-text-muted hover:text-text-subtle border border-transparent"
            }`}
          >
            {metricLabel(m)}
          </button>
        ))}
      </div>

      {/* Radar toggle */}
      {radarAvailable && (
        <button
          onClick={onToggleRadar}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-lg border transition-colors duration-150 backdrop-blur-md ${
            showRadar
              ? "bg-alpenglow/20 border-alpenglow/40 text-alpenglow"
              : "bg-surface/90 border-border text-text-muted hover:text-text-subtle"
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          Radar {showRadar ? "ON" : "OFF"}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/map/MapControls.tsx
git commit -m "feat(map): add MapControls with metric toggle and radar switch"
```

---

## Task 7: Create MapWeatherOverlay Component

**Files:**
- Create: `components/map/MapWeatherOverlay.tsx`

- [ ] **Step 1: Create `components/map/MapWeatherOverlay.tsx`**

```tsx
"use client";

import { Source, Layer } from "react-map-gl/maplibre";

interface Props {
  tileUrl: string;
}

/**
 * RainViewer radar tile overlay.
 * Renders as a semi-transparent raster layer on top of the base map.
 */
export function MapWeatherOverlay({ tileUrl }: Props) {
  return (
    <Source
      id="weather-radar"
      type="raster"
      tiles={[tileUrl]}
      tileSize={256}
    >
      <Layer
        id="weather-radar-layer"
        type="raster"
        paint={{
          "raster-opacity": 0.5,
          "raster-fade-duration": 300,
        }}
      />
    </Source>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/map/MapWeatherOverlay.tsx
git commit -m "feat(map): add MapWeatherOverlay for RainViewer radar tiles"
```

---

## Task 8: Create MapBottomSheet Component (Mobile)

**Files:**
- Create: `components/map/MapBottomSheet.tsx`
- Modify: `tailwind.config.ts` (add slide-up keyframe)

- [ ] **Step 1: Add slide-up animation to tailwind config**

In `tailwind.config.ts`, inside `theme.extend.keyframes`, add:

```typescript
"slide-up": {
  "0%": { transform: "translateY(100%)" },
  "100%": { transform: "translateY(0)" },
},
```

And in `animation`:
```typescript
"slide-up": "slide-up 300ms ease-out",
```

- [ ] **Step 2: Create `components/map/MapBottomSheet.tsx`**

```tsx
"use client";

import type { ResortWithData } from "@/lib/types";
import { conditionColor } from "@/lib/map-utils";

interface Props {
  resort: ResortWithData;
  onClose: () => void;
  onViewResort: (slug: string) => void;
}

export function MapBottomSheet({ resort, onClose, onViewResort }: Props) {
  const snow = resort.snow_report;
  const color = conditionColor(resort.cond_rating);
  const camCount = resort.cams.filter((c) => c.is_active).length;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 lg:hidden"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden animate-slide-up">
        <div className="bg-surface border-t border-border rounded-t-2xl px-5 pt-3 pb-6 shadow-xl">
          {/* Drag handle */}
          <div className="flex justify-center mb-4">
            <div className="w-10 h-1 bg-border rounded-full" />
          </div>

          {/* Resort header */}
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h3 className="text-text-base font-semibold text-lg leading-tight">{resort.name}</h3>
              <p className="text-text-muted text-sm mt-0.5">{resort.region}, {resort.state}</p>
            </div>
            <span
              className="px-2.5 py-1 rounded text-xs font-bold uppercase shrink-0"
              style={{ backgroundColor: `${color}20`, color, border: `1px solid ${color}40` }}
            >
              {resort.cond_rating}
            </span>
          </div>

          {/* Snow stats */}
          {snow && (
            <div className="grid grid-cols-4 gap-2 mb-5">
              <div className="bg-bg/60 rounded-lg p-2.5 text-center">
                <div className="text-powder font-mono font-bold text-xl leading-none">{snow.base_depth ?? "—"}</div>
                <div className="text-text-muted text-[10px] mt-1">base&quot;</div>
              </div>
              <div className="bg-bg/60 rounded-lg p-2.5 text-center">
                <div className="text-cyan font-mono font-bold text-xl leading-none">{snow.new_snow_24h ?? "—"}</div>
                <div className="text-text-muted text-[10px] mt-1">24h&quot;</div>
              </div>
              <div className="bg-bg/60 rounded-lg p-2.5 text-center">
                <div className="text-text-base font-mono font-bold text-xl leading-none">{snow.new_snow_48h ?? "—"}</div>
                <div className="text-text-muted text-[10px] mt-1">48h&quot;</div>
              </div>
              <div className="bg-bg/60 rounded-lg p-2.5 text-center">
                <div className="text-text-base font-mono font-bold text-xl leading-none">
                  {snow.trails_open != null && snow.trails_total ? `${snow.trails_open}/${snow.trails_total}` : "—"}
                </div>
                <div className="text-text-muted text-[10px] mt-1">runs</div>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              onClick={() => onViewResort(resort.slug)}
              className="flex-1 py-3 bg-cyan/15 border border-cyan/30 rounded-xl text-cyan font-semibold text-sm hover:bg-cyan/25 transition-colors"
            >
              View Resort
            </button>
            {camCount > 0 && (
              <button
                onClick={() => onViewResort(resort.slug)}
                className="px-4 py-3 bg-surface2 border border-border rounded-xl text-text-subtle text-sm font-medium"
              >
                {camCount} Cam{camCount !== 1 ? "s" : ""}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/map/MapBottomSheet.tsx tailwind.config.ts
git commit -m "feat(map): add MapBottomSheet for mobile resort selection"
```

---

## Task 9: Create Barrel Export

**Files:**
- Create: `components/map/index.ts`

- [ ] **Step 1: Create `components/map/index.ts`**

```typescript
export { MapView } from "./MapView";
export { MapPopupCard } from "./MapPopupCard";
export { MapControls } from "./MapControls";
export { MapWeatherOverlay } from "./MapWeatherOverlay";
export { MapBottomSheet } from "./MapBottomSheet";
```

- [ ] **Step 2: Commit**

```bash
git add components/map/index.ts
git commit -m "feat(map): add barrel export for map components"
```

---

## Task 10: Create Full-Page Map Route (`/map`)

**Files:**
- Create: `app/map/page.tsx`

Server component that fetches resorts + radar data, renders a full-viewport map.

- [ ] **Step 1: Create `app/map/page.tsx`**

```tsx
import type { Metadata } from "next";
import { getAllResorts } from "@/lib/supabase";
import { getLatestRadarTileUrl } from "@/lib/weather-radar";
import { FullPageMap } from "./FullPageMap";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Interactive Ski Resort Map — PeakCam",
  description:
    "Explore 75+ ski resorts on an interactive map with live snow conditions, base depth, weather radar, and terrain visualization.",
  openGraph: {
    title: "Interactive Ski Resort Map — PeakCam",
    description: "Explore ski resorts on an interactive map with live snow data and weather radar.",
    url: "https://peakcam.io/map",
    type: "website",
  },
};

export default async function MapPage() {
  let resorts = await getAllResorts().catch(() => []);
  const radarTileUrl = await getLatestRadarTileUrl();

  return <FullPageMap resorts={resorts} radarTileUrl={radarTileUrl} />;
}
```

- [ ] **Step 2: Create `app/map/FullPageMap.tsx`** (client component wrapper)

```tsx
"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MapView } from "@/components/map";
import { MapBottomSheet } from "@/components/map/MapBottomSheet";
import type { ResortWithData } from "@/lib/types";

interface Props {
  resorts: ResortWithData[];
  radarTileUrl: string | null;
}

export function FullPageMap({ resorts, radarTileUrl }: Props) {
  const router = useRouter();
  const [selectedResort, setSelectedResort] = useState<ResortWithData | null>(null);

  const handleResortClick = useCallback(
    (slug: string) => {
      // On mobile: show bottom sheet. On desktop: navigate.
      if (window.innerWidth < 1024) {
        const resort = resorts.find((r) => r.slug === slug) ?? null;
        setSelectedResort(resort);
      } else {
        router.push(`/resorts/${slug}`);
      }
    },
    [resorts, router]
  );

  const handleViewResort = useCallback(
    (slug: string) => {
      router.push(`/resorts/${slug}`);
    },
    [router]
  );

  return (
    <div className="h-screen w-full relative bg-bg">
      {/* Back nav overlay */}
      <div className="absolute top-4 left-16 z-20">
        <Link
          href="/"
          className="flex items-center gap-1.5 px-3 py-2 bg-surface/90 backdrop-blur-md border border-border rounded-lg text-text-subtle text-sm hover:text-cyan transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Resorts
        </Link>
      </div>

      {/* Full-page map */}
      <MapView
        resorts={resorts}
        onResortClick={handleResortClick}
        radarTileUrl={radarTileUrl}
        variant="fullpage"
      />

      {/* Mobile bottom sheet */}
      {selectedResort && (
        <MapBottomSheet
          resort={selectedResort}
          onClose={() => setSelectedResort(null)}
          onViewResort={handleViewResort}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/map/page.tsx app/map/FullPageMap.tsx
git commit -m "feat(map): add full-page /map route with radar + mobile bottom sheet"
```

---

## Task 11: Swap BrowsePage to Use New MapView

**Files:**
- Modify: `components/browse/BrowsePage.tsx`

Replace the old Leaflet `ResortMap` dynamic import with the new `MapView` from `components/map`.

- [ ] **Step 1: Update BrowsePage.tsx imports**

Replace the dynamic import block at the top:

```tsx
// OLD — remove this:
const ResortMap = dynamic(() => import("@/components/browse/ResortMap"), {
  ssr: false,
  loading: () => ( ... ),
});

// NEW — replace with:
import dynamic from "next/dynamic";
const MapView = dynamic(
  () => import("@/components/map/MapView").then((m) => ({ default: m.MapView })),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full bg-surface animate-pulse rounded-xl flex items-center justify-center">
        <span className="text-text-muted text-sm">Loading map...</span>
      </div>
    ),
  }
);
```

- [ ] **Step 2: Update map rendering in BrowsePage JSX**

Find the map sidebar section and replace `<ResortMap ... />` with the new `MapView`:

```tsx
{/* Map sidebar */}
{showMap && (
  <div className="hidden lg:block sticky top-20 h-[calc(100vh-6rem)] rounded-xl overflow-hidden border border-border">
    <MapView
      resorts={filtered}
      hoveredSlug={hoveredSlug}
      onResortHover={setHoveredSlug}
      onResortClick={(slug) => { window.location.href = `/resorts/${slug}`; }}
      variant="sidebar"
    />
  </div>
)}
```

- [ ] **Step 3: Add "Map" nav link to Header**

In `components/layout/Header.tsx`, add the map route to `navLinks`:

```typescript
const navLinks = [
  { label: "Resorts",     href: "/" },
  { label: "Map",          href: "/map" },
  { label: "Compare",     href: "/compare" },
  { label: "Snow Report", href: "/snow-report" },
  { label: "About",       href: "/about" },
];
```

- [ ] **Step 4: Commit**

```bash
git add components/browse/BrowsePage.tsx components/layout/Header.tsx
git commit -m "feat(map): swap BrowsePage sidebar to MapView, add /map nav link"
```

---

## Task 12: Clean Up — Remove Old Leaflet Map

**Files:**
- Delete: `components/browse/ResortMap.tsx`
- Modify: `app/globals.css` (remove leaflet CSS import)
- Modify: `package.json` (remove leaflet deps)

- [ ] **Step 1: Delete old ResortMap**

```bash
rm components/browse/ResortMap.tsx
```

- [ ] **Step 2: Remove leaflet CSS import from globals.css**

Remove the line:
```css
@import "leaflet/dist/leaflet.css";
```

Also remove the Leaflet dark theme CSS overrides at the bottom of the file (the `.leaflet-container`, `.leaflet-popup-*`, `.leaflet-control-zoom`, `.peakcam-tooltip` blocks). Keep the `.peakcam-maplibre-popup` styles if added.

- [ ] **Step 3: Uninstall leaflet**

```bash
npm uninstall leaflet @types/leaflet
```

- [ ] **Step 4: Add MapLibre popup dark theme styles to globals.css**

```css
/* ── MapLibre dark popup overrides ── */
.peakcam-maplibre-popup .maplibregl-popup-content {
  background: #0E1825 !important;
  border: 1px solid rgba(232, 240, 248, 0.15) !important;
  border-radius: 12px !important;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6) !important;
  padding: 16px !important;
  color: #E8F0F8 !important;
}
.peakcam-maplibre-popup .maplibregl-popup-tip {
  border-top-color: #0E1825 !important;
}
.peakcam-maplibre-popup .maplibregl-popup-close-button {
  color: #4A6480 !important;
  font-size: 18px !important;
  right: 8px !important;
  top: 8px !important;
}
.peakcam-maplibre-popup .maplibregl-popup-close-button:hover {
  color: #E8F0F8 !important;
  background: transparent !important;
}
```

- [ ] **Step 5: Verify build**

```bash
npm run build
```

Expected: Build succeeds with no references to old Leaflet component.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(map): remove Leaflet, clean up old map component and styles"
```

---

## Task 13: Verify & Polish

- [ ] **Step 1: Run dev server and test**

```bash
npm run dev
```

Test checklist:
1. Browse page (`/`) — map sidebar renders with MapLibre
2. Markers show condition-colored circles
3. Hovering a card highlights the marker
4. Clicking a marker shows popup with snow data
5. Popup "View Resort" link navigates correctly
6. Filters update map markers (state, condition, fresh snow)
7. Map auto-fits bounds when filters change
8. `/map` route — full-page map renders
9. Metric toggle switches displayed labels
10. Radar toggle shows weather overlay (if data available)
11. Mobile viewport — bottom sheet appears on marker tap
12. Navigation controls (zoom, compass, geolocate on /map) work

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Fix any lint errors.

- [ ] **Step 3: Final commit if fixes needed**

```bash
git add -A
git commit -m "fix(map): lint fixes and polish"
```
