"use client";

import { Source, Layer } from "react-map-gl/maplibre";

interface MapWeatherOverlayProps {
  tileUrl: string;
}

export default function MapWeatherOverlay({ tileUrl }: MapWeatherOverlayProps) {
  return (
    <Source id="weather-radar" type="raster" tiles={[tileUrl]} tileSize={256}>
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
