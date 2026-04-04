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
    return `https://api.maptiler.com/maps/landscape-dark/style.json?key=${apiKey}`;
  }
  // Fallback: Carto Dark Matter raster tiles (free, no key, but no terrain)
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
        maxzoom: 18,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      },
    },
    layers: [
      { id: "carto-dark-layer", type: "raster" as const, source: "carto-dark" },
    ],
  };
}

// ── Props ─────────────────────────────────────────────────────────

interface MapViewProps {
  resorts: ResortWithData[];
  hoveredSlug?: string | null;
  onResortHover?: (slug: string | null) => void;
  onResortClick?: (slug: string) => void;
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
  onResortClick,
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

  // Build GeoJSON from resorts
  const geojson = useMemo(() => resortsToGeoJSON(resorts), [resorts]);

  // Find selected resort for popup
  const selectedResort = useMemo(
    () => (selectedSlug ? resorts.find((r) => r.slug === selectedSlug) ?? null : null),
    [selectedSlug, resorts],
  );

  // Fit bounds when filtered resorts change
  const prevResortCountRef = useRef(resorts.length);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || resorts.length === 0) return;

    // Only auto-fit when the resort list changes (filter applied)
    if (resorts.length === prevResortCountRef.current) return;
    prevResortCountRef.current = resorts.length;

    const bounds = resortBounds(resorts);
    if (!bounds) return;

    map.fitBounds(bounds as [number, number, number, number], {
      padding: variant === "sidebar" ? 40 : 80,
      duration: 800,
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

  const onMouseEnter = useCallback(() => setCursor("pointer"), []);
  const onMouseLeave = useCallback(() => {
    setCursor("grab");
    onResortHover?.(null);
  }, [onResortHover]);

  const onMouseMove = useCallback(
    (e: MapLayerMouseEvent) => {
      if (e.features && e.features.length > 0) {
        const slug = e.features[0].properties?.slug as string | undefined;
        if (slug) onResortHover?.(slug);
      }
    },
    [onResortHover],
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

      // Handle resort marker click
      const slug = feature.properties?.slug as string;
      if (!slug) return;

      if (onResortClick) {
        onResortClick(slug);
      }

      setSelectedSlug(slug);

      const coords = (feature.geometry as GeoJSON.Point).coordinates;
      mapRef.current?.flyTo({
        center: [coords[0], coords[1]],
        zoom: Math.max(mapRef.current?.getZoom() ?? 6, 10),
        duration: 1200,
      });
    },
    [onResortClick],
  );

  const handlePopupClose = useCallback(() => setSelectedSlug(null), []);

  const handleViewResort = useCallback(
    (slug: string) => {
      if (onResortClick) {
        onResortClick(slug);
      } else {
        window.location.href = `/resorts/${slug}`;
      }
    },
    [onResortClick],
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
        reuseMaps
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
        >
          {/* Cluster circles */}
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
              "circle-color": "#1A6B7A",
              "circle-stroke-width": 2,
              "circle-stroke-color": "rgba(255,255,255,0.2)",
            }}
          />

          {/* Cluster count labels */}
          <Layer
            id="cluster-count"
            type="symbol"
            filter={["has", "point_count"]}
            layout={{
              "text-field": ["get", "point_count_abbreviated"],
              "text-size": 12,
            }}
            paint={{
              "text-color": "#ffffff",
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

          {/* Visible resort markers — enlarged for data display */}
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
            }}
            paint={{
              "text-color": "#ffffff",
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
            }}
            paint={{
              "text-color": "#E8F0F8",
              "text-halo-color": "#080D14",
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
