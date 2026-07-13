"use client";

import { Source, Layer } from "react-map-gl/maplibre";

interface MapWeatherOverlayProps {
  tileUrl: string;
  /** Insert the radar layer BELOW this layer id (e.g. the resort markers) so
   *  radar reads as background context rather than covering the condition
   *  dots. Omitted → radar renders on top (legacy behavior). */
  beforeId?: string;
}

export default function MapWeatherOverlay({ tileUrl, beforeId }: MapWeatherOverlayProps) {
  return (
    <Source id="weather-radar" type="raster" tiles={[tileUrl]} tileSize={256}>
      <Layer
        id="weather-radar-layer"
        type="raster"
        beforeId={beforeId}
        paint={{
          "raster-opacity": 0.45,
          "raster-fade-duration": 300,
        }}
      />
    </Source>
  );
}
