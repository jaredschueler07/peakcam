"use client";

import { Source, Layer } from "react-map-gl/maplibre";
import type { RadarFrame } from "@/lib/weather-radar";

interface MapWeatherOverlayProps {
  /** Radar frames, oldest first (past + nowcast). */
  frames: RadarFrame[];
  /** Index of the frame currently shown. */
  activeIndex: number;
  /** Insert the radar layers BELOW this layer id (e.g. the cluster layer) so
   *  radar reads as background context rather than covering the condition
   *  dots. Omitted → radar renders on top (legacy behavior). */
  beforeId?: string;
}

// Every frame mounts as its own raster source/layer; only the active frame is
// visible. Hidden frames keep raster-opacity 0 (NOT visibility:none) so
// MapLibre still fetches their tiles — scrubbing/playback then steps between
// already-loaded frames without flicker. fade-duration 0 keeps steps crisp.
export default function MapWeatherOverlay({
  frames,
  activeIndex,
  beforeId,
}: MapWeatherOverlayProps) {
  return (
    <>
      {frames.map((frame, i) => (
        <Source
          key={frame.time}
          id={`weather-radar-${frame.time}`}
          type="raster"
          tiles={[frame.tileUrl]}
          tileSize={256}
        >
          <Layer
            id={`weather-radar-layer-${frame.time}`}
            type="raster"
            beforeId={beforeId}
            paint={{
              "raster-opacity": i === activeIndex ? 0.45 : 0,
              "raster-fade-duration": 0,
            }}
          />
        </Source>
      ))}
    </>
  );
}
