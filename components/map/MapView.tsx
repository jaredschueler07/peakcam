"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import Map, {
  Source,
  Layer,
  NavigationControl,
  GeolocateControl,
  ScaleControl,
  Popup,
  type MapRef,
  type ViewState,
  type ViewStateChangeEvent,
  type MapLayerMouseEvent,
} from "react-map-gl/maplibre";
import maplibregl from "maplibre-gl";
import type { ResortWithData } from "@/lib/types";
import type { MapMetric } from "@/lib/map-utils";
import {
  resortsToGeoJSON,
  resortBounds,
  DEFAULT_VIEW_STATE,
} from "@/lib/map-utils";
import MapPopupCard from "./MapPopupCard";
import MapControls from "./MapControls";
import MapLegend from "./MapLegend";
import MapWeatherOverlay from "./MapWeatherOverlay";

// ── Tile style ────────────────────────────────────────────────────

function getMapStyle(apiKey: string | undefined): maplibregl.StyleSpecification | string {
  if (apiKey) {
    // Paper/poster aesthetic — landscape (light terrain) vector style
    return `https://api.maptiler.com/maps/landscape/style.json?key=${apiKey}`;
  }
  // Fallback: Carto Voyager raster tiles (light, free, no key)
  return {
    version: 8 as const,
    name: "carto-voyager",
    sources: {
      "carto-voyager": {
        type: "raster" as const,
        tiles: [
          "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
          "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
          "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
        ],
        tileSize: 256,
        maxzoom: 18,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      },
    },
    layers: [
      { id: "carto-voyager-layer", type: "raster" as const, source: "carto-voyager" },
    ],
  };
}

// ── Props ─────────────────────────────────────────────────────────

interface MapViewProps {
  resorts: ResortWithData[];
  hoveredSlug?: string | null;
  onResortHover?: (slug: string | null) => void;
  /**
   * Fired when a marker is tapped. The parent may use this to show a mobile
   * detail sheet. It does NOT navigate — tapping a marker only *selects* it.
   * Navigation happens on the explicit second action (the popup / sheet's
   * "View resort" button → onViewResort).
   */
  onResortSelect?: (slug: string) => void;
  /** Navigate to a resort detail page — fired by the "View resort" action. */
  onViewResort?: (slug: string) => void;
  /** "sidebar" for browse page, "fullpage" for /map route */
  variant?: "sidebar" | "fullpage";
  /** Radar tile URL fetched server-side */
  radarTileUrl?: string | null;
  className?: string;
}

// ── Component ─────────────────────────────────────────────────────

export default function MapView({
  resorts,
  hoveredSlug,
  onResortHover,
  onResortSelect,
  onViewResort,
  variant = "sidebar",
  radarTileUrl = null,
  className = "",
}: MapViewProps) {
  const mapRef = useRef<MapRef>(null);
  const maptilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  const mapStyle = useMemo(() => getMapStyle(maptilerKey), [maptilerKey]);

  const [viewState, setViewState] = useState<ViewState>({
    ...DEFAULT_VIEW_STATE,
    padding: { top: 0, bottom: 0, left: 0, right: 0 },
  });
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [metric, setMetric] = useState<MapMetric>("baseDepth");
  const [showRadar, setShowRadar] = useState(false);
  const [cursor, setCursor] = useState<string>("grab");

  // The in-map popup card is a desktop affordance; on smaller screens the
  // parent shows a bottom sheet instead (via onResortSelect). Rendering both
  // let the sheet's full-screen backdrop cover the popup — the two used to
  // race. Gate the popup so exactly one detail surface shows per breakpoint.
  // MapView is client-only (dynamic ssr:false), so window is available at
  // first render — initialize eagerly to avoid a popup flash on mobile.
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window === "undefined"
      ? true
      : window.matchMedia("(min-width: 1024px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => {
      setIsDesktop(mq.matches);
      // The desktop popup unmounts below 1024px and the parent only opens its
      // mobile sheet on a fresh tap — clear a dangling desktop selection on a
      // resize down so it doesn't linger invisibly.
      if (!mq.matches) setSelectedSlug(null);
    };
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Build GeoJSON from resorts
  const geojson = useMemo(() => resortsToGeoJSON(resorts), [resorts]);

  // Find selected resort for popup
  const selectedResort = useMemo(
    () => (selectedSlug ? resorts.find((r) => r.slug === selectedSlug) ?? null : null),
    [selectedSlug, resorts],
  );

  // Fit bounds when filtered resorts change (state chips, search, etc.).
  // Key by slug set so Chile→Argentina (same count, different places) still flies.
  // On first paint keep DEFAULT_VIEW_STATE (North America). When the set spans
  // both hemispheres (filter cleared), fly home rather than zooming to the world.
  const prevResortKeyRef = useRef<string>("");
  useEffect(() => {
    const map = mapRef.current;
    if (!map || resorts.length === 0) return;

    const key = resorts
      .map((r) => r.slug)
      .sort()
      .join(",");
    if (key === prevResortKeyRef.current) return;
    const isInitial = prevResortKeyRef.current === "";
    prevResortKeyRef.current = key;
    if (isInitial) return;

    const bounds = resortBounds(resorts);
    if (!bounds) return;

    const [, south, , north] = bounds;
    // Spans both hemispheres (e.g. filter cleared) — return to default NA view
    if (north - south > 50) {
      map.flyTo({
        center: [DEFAULT_VIEW_STATE.longitude, DEFAULT_VIEW_STATE.latitude],
        zoom: DEFAULT_VIEW_STATE.zoom,
        duration: 800,
      });
      return;
    }

    map.fitBounds(bounds as [number, number, number, number], {
      padding: variant === "sidebar" ? 40 : 80,
      duration: 800,
      maxZoom: 8,
    });
  }, [resorts, variant]);

  // Ease to hovered resort from sidebar
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hoveredSlug) return;
    const resort = resorts.find((r) => r.slug === hoveredSlug);
    if (!resort) return;
    map.easeTo({
      center: [resort.lng, resort.lat],
      duration: 600,
    });
  }, [hoveredSlug, resorts]);

  // ── Metric-dependent text field expression ──────────────────────

  const textFieldExpr = useMemo(() => {
    switch (metric) {
      case "baseDepth":
        return [
          "case",
          ["!=", ["get", "baseDepth"], null],
          ["concat", ["to-string", ["get", "baseDepth"]], '"'],
          "—",
        ];
      case "snow24h":
        return [
          "case",
          ["!=", ["get", "snow24h"], null],
          ["concat", ["to-string", ["get", "snow24h"]], '"'],
          "—",
        ];
      case "conditions":
        return ["get", "condRating"];
    }
  }, [metric]);

  // ── Interaction handlers ────────────────────────────────────────

  // Hover is throttled: onMouseMove fires on every native mousemove (every
  // pixel), and each call re-renders hover-highlight state across every grid
  // card. Diff against the last-emitted slug and coalesce to one rAF tick so
  // we only notify the parent when the hovered marker actually changes.
  const lastHoverRef = useRef<string | null>(null);
  const hoverRafRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (hoverRafRef.current) cancelAnimationFrame(hoverRafRef.current);
    },
    [],
  );

  const cancelPendingHover = useCallback(() => {
    if (hoverRafRef.current) {
      cancelAnimationFrame(hoverRafRef.current);
      hoverRafRef.current = null;
    }
  }, []);

  const onMouseEnter = useCallback(() => setCursor("pointer"), []);
  const onMouseLeave = useCallback(() => {
    setCursor("grab");
    // Cancel any queued hover so a stale slug can't re-highlight a marker the
    // pointer has already left the map from.
    cancelPendingHover();
    lastHoverRef.current = null;
    onResortHover?.(null);
  }, [onResortHover, cancelPendingHover]);

  const onMouseMove = useCallback(
    (e: MapLayerMouseEvent) => {
      const slug = e.features?.[0]?.properties?.slug as string | undefined;
      // Moved onto empty map space — drop any pending hover and clear.
      if (!slug) {
        if (lastHoverRef.current !== null) {
          cancelPendingHover();
          lastHoverRef.current = null;
          onResortHover?.(null);
        }
        return;
      }
      if (slug === lastHoverRef.current) return;
      lastHoverRef.current = slug;
      cancelPendingHover();
      hoverRafRef.current = requestAnimationFrame(() => onResortHover?.(slug));
    },
    [onResortHover, cancelPendingHover],
  );

  const onClick = useCallback(
    (e: MapLayerMouseEvent) => {
      if (!e.features || e.features.length === 0) {
        setSelectedSlug(null);
        return;
      }

      const feature = e.features[0];

      // Handle cluster click — zoom into cluster
      if (feature.properties?.cluster) {
        const clusterId = feature.properties.cluster_id as number;
        const map = mapRef.current;
        if (!map) return;

        const source = map.getSource("resorts") as maplibregl.GeoJSONSource;
        source.getClusterExpansionZoom(clusterId).then((zoom: number) => {
          const coords = (feature.geometry as GeoJSON.Point).coordinates;
          map.flyTo({
            center: [coords[0], coords[1]],
            zoom,
            duration: 800,
          });
        });
        return;
      }

      // Handle resort marker click — SELECT only, never navigate. On desktop
      // this drives the in-map popup; on mobile the parent shows a sheet via
      // onResortSelect. Navigation is deferred to the "View resort" action.
      const slug = feature.properties?.slug as string;
      if (!slug) return;

      setSelectedSlug(slug);
      onResortSelect?.(slug);

      const coords = (feature.geometry as GeoJSON.Point).coordinates;
      mapRef.current?.flyTo({
        center: [coords[0], coords[1]],
        zoom: Math.max(mapRef.current?.getZoom() ?? 6, 10),
        duration: 1200,
      });
    },
    [onResortSelect],
  );

  const handlePopupClose = useCallback(() => setSelectedSlug(null), []);

  const handleViewResort = useCallback(
    (slug: string) => {
      if (onViewResort) {
        onViewResort(slug);
      } else {
        window.location.href = `/resorts/${slug}`;
      }
    },
    [onViewResort],
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
        interactiveLayerIds={["resort-markers-hit", "resort-markers", "clusters"]}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onMouseMove={onMouseMove}
        onClick={onClick}
        attributionControl={{}}
        /* Sidebar map lives inside a scrollable page — require a modifier /
           two-finger gesture to pan/zoom so it doesn't hijack page scroll.
           NOTE: cooperativeGestures is honored only at map construction, so we
           must NOT reuseMaps — a recycled instance would carry the previous
           variant's gesture setting across the /↔/map route change (react-map-gl
           pools maps globally without keying on props), silently defeating this. */
        cooperativeGestures={variant === "sidebar"}
      >
        {/* Navigation controls */}
        <NavigationControl position="top-right" showCompass visualizePitch />
        {variant === "fullpage" && <GeolocateControl position="top-right" />}
        <ScaleControl position="bottom-left" />
        <MapLegend />

        {/* Resort markers — clustered GeoJSON source */}
        <Source
          id="resorts"
          type="geojson"
          data={geojson}
          cluster={true}
          clusterMaxZoom={10}
          clusterRadius={50}
          /* Aggregate a per-rating count into each cluster so the bubble can
             show the dominant condition of the region, not just a headcount. */
          clusterProperties={{
            great: ["+", ["case", ["==", ["get", "condRating"], "great"], 1, 0]],
            good: ["+", ["case", ["==", ["get", "condRating"], "good"], 1, 0]],
            fair: ["+", ["case", ["==", ["get", "condRating"], "fair"], 1, 0]],
            poor: ["+", ["case", ["==", ["get", "condRating"], "poor"], 1, 0]],
          }}
        >
          {/* Cluster circles — filled with the DOMINANT condition color
             (ties break toward the better rating), cream stroke for stamp feel. */}
          <Layer
            id="clusters"
            type="circle"
            filter={["has", "point_count"]}
            paint={{
              "circle-radius": [
                "interpolate", ["linear"], ["get", "point_count"],
                2, 18,
                10, 24,
                50, 32,
              ],
              "circle-color": [
                "let",
                "g", ["to-number", ["get", "great"], 0],
                "o", ["to-number", ["get", "good"], 0],
                "f", ["to-number", ["get", "fair"], 0],
                "p", ["to-number", ["get", "poor"], 0],
                [
                  "case",
                  ["all",
                    [">=", ["var", "g"], ["var", "o"]],
                    [">=", ["var", "g"], ["var", "f"]],
                    [">=", ["var", "g"], ["var", "p"]]], "#3c5a3a",  /* great → forest */
                  ["all",
                    [">=", ["var", "o"], ["var", "f"]],
                    [">=", ["var", "o"], ["var", "p"]]], "#6d8a4a",  /* good → moss */
                  [">=", ["var", "f"], ["var", "p"]], "#e2a740",     /* fair → mustard */
                  "#a93f20",                                          /* poor → alpen-dk */
                ],
              ],
              "circle-stroke-width": 2,
              "circle-stroke-color": "#faf4e6",    /* pc-cream-50 */
            }}
          />

          {/* Cluster count labels — ink on a mustard (fair-dominant) bubble for
             contrast, cream otherwise. Mirrors the circle-color case order so
             the text tone always matches the resolved dominant background. */}
          <Layer
            id="cluster-count"
            type="symbol"
            filter={["has", "point_count"]}
            layout={{
              "text-field": ["get", "point_count_abbreviated"],
              "text-size": 12,
              "text-font": ["Noto Sans Bold", "Arial Unicode MS Bold"],
            }}
            paint={{
              "text-color": [
                "let",
                "g", ["to-number", ["get", "great"], 0],
                "o", ["to-number", ["get", "good"], 0],
                "f", ["to-number", ["get", "fair"], 0],
                "p", ["to-number", ["get", "poor"], 0],
                [
                  "case",
                  ["all",
                    [">=", ["var", "g"], ["var", "o"]],
                    [">=", ["var", "g"], ["var", "f"]],
                    [">=", ["var", "g"], ["var", "p"]]], "#faf4e6",  /* great → cream */
                  ["all",
                    [">=", ["var", "o"], ["var", "f"]],
                    [">=", ["var", "o"], ["var", "p"]]], "#faf4e6",  /* good → cream */
                  [">=", ["var", "f"], ["var", "p"]], "#2a1f14",     /* fair → ink */
                  "#faf4e6",                                          /* poor → cream */
                ],
              ],
            }}
          />

          {/* Invisible hit area layer for mobile tap targets (44px) */}
          <Layer
            id="resort-markers-hit"
            type="circle"
            filter={["!", ["has", "point_count"]]}
            paint={{
              "circle-radius": 22,
              "circle-opacity": 0,
              "circle-stroke-opacity": 0,
            }}
          />

          {/* Visible resort markers — earth palette, ink stroke */}
          <Layer
            id="resort-markers"
            type="circle"
            filter={["!", ["has", "point_count"]]}
            paint={{
              "circle-radius": [
                "case",
                ["==", ["get", "slug"], hoveredSlug ?? ""],
                16,
                14,
              ],
              "circle-color": [
                "match",
                ["get", "condRating"],
                "great", "#3c5a3a",                /* pc-forest */
                "good",  "#6d8a4a",                /* pc-good (moss) */
                "fair",  "#e2a740",                /* pc-mustard */
                "poor",  "#a93f20",                /* pc-alpen-dk */
                "#7a5a3a",                          /* pc-bark fallback */
              ],
              /* The ink stroke is a REQUIRED accessibility layer, not just a
                 stamp-feel flourish: "fair" (mustard #e2a740) is only 1.74:1
                 on cream and "good" (moss) is a marginal 3.17:1 — both fail /
                 barely pass WCAG 1.4.11 (3:1 non-text) on fill alone. The 2px
                 ink outline is what carries the contrast. Do not drop it. */
              "circle-stroke-width": [
                "case",
                ["==", ["get", "slug"], hoveredSlug ?? ""],
                2.5,
                2,
              ],
              "circle-stroke-color": "#2a1f14",    /* pc-ink — always ink for stamp feel + a11y contrast */
              "circle-opacity": 0.95,
            }}
          />

          {/* Metric value text centered on markers */}
          <Layer
            id="resort-marker-text"
            type="symbol"
            filter={["!", ["has", "point_count"]]}
            layout={{
              "text-field": textFieldExpr as maplibregl.ExpressionSpecification,
              "text-size": 10,
              "text-allow-overlap": true,
              "text-ignore-placement": true,
              "text-font": ["Noto Sans Bold", "Arial Unicode MS Bold"],
            }}
            paint={{
              /* Fair (mustard) needs ink text; others get cream */
              "text-color": [
                "match",
                ["get", "condRating"],
                "fair", "#2a1f14",
                "#faf4e6",
              ],
            }}
          />

          {/* Data labels above markers at higher zoom — metric-driven */}
          <Layer
            id="resort-labels"
            type="symbol"
            filter={["!", ["has", "point_count"]]}
            minzoom={6}
            layout={{
              "text-field": textFieldExpr as maplibregl.ExpressionSpecification,
              "text-size": 11,
              "text-offset": [0, -2.2],
              "text-anchor": "bottom",
              "text-allow-overlap": false,
              "text-font": ["Noto Sans Bold", "Arial Unicode MS Bold"],
            }}
            paint={{
              "text-color": "#2a1f14",             /* pc-ink */
              "text-halo-color": "#faf4e6",        /* pc-cream-50 halo */
              "text-halo-width": 1.5,
            }}
          />

          {/* Resort name labels at high zoom — unclustered only */}
          <Layer
            id="resort-name-labels"
            type="symbol"
            filter={["!", ["has", "point_count"]]}
            minzoom={8}
            layout={{
              "text-field": ["get", "name"],
              "text-size": 12,
              "text-offset": [0, 1.2],
              "text-anchor": "top",
              "text-allow-overlap": false,
              "text-max-width": 10,
              "text-font": ["Noto Sans Regular", "Arial Unicode MS Regular"],
            }}
            paint={{
              "text-color": "#4a3620",             /* pc-bark-dk */
              "text-halo-color": "#faf4e6",        /* pc-cream-50 halo */
              "text-halo-width": 1.25,
            }}
          />
        </Source>

        {/* Weather radar overlay — inserted BELOW the resort markers
            (beforeId) so condition dots stay the figure and radar is the
            background context, per standard weather-map layering. */}
        {showRadar && radarTileUrl && (
          <MapWeatherOverlay tileUrl={radarTileUrl} beforeId="clusters" />
        )}

        {/* Selected resort popup — desktop only (mobile gets the parent's
            bottom sheet; see isDesktop note above). */}
        {isDesktop && selectedResort && (
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
