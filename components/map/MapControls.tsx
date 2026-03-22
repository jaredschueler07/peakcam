"use client";

import type { MapMetric } from "@/lib/map-utils";
import { metricLabel } from "@/lib/map-utils";

const METRICS: MapMetric[] = ["baseDepth", "snow24h", "conditions"];

interface MapControlsProps {
  metric: MapMetric;
  onMetricChange: (metric: MapMetric) => void;
  showRadar: boolean;
  onToggleRadar: () => void;
  radarAvailable: boolean;
  variant: "sidebar" | "fullpage";
}

export default function MapControls({
  metric,
  onMetricChange,
  showRadar,
  onToggleRadar,
  radarAvailable,
}: MapControlsProps) {
  return (
    <div className="absolute top-3 left-3 z-10 flex flex-col gap-2">
      {/* Metric toggle row */}
      <div className="flex bg-surface/90 backdrop-blur-md rounded-lg p-1 gap-0.5">
        {METRICS.map((m) => {
          const isActive = metric === m;
          return (
            <button
              key={m}
              onClick={() => onMetricChange(m)}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors duration-220 ${
                isActive
                  ? "bg-cyan/20 text-cyan border-cyan/30"
                  : "border-transparent text-text-muted hover:text-text-subtle"
              }`}
            >
              {metricLabel(m)}
            </button>
          );
        })}
      </div>

      {/* Radar toggle */}
      {radarAvailable && (
        <button
          onClick={onToggleRadar}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors duration-220 ${
            showRadar
              ? "bg-alpenglow/20 text-alpenglow"
              : "bg-surface/90 text-text-muted hover:text-text-subtle"
          }`}
        >
          <span>{showRadar ? "\u{1F327}\uFE0F" : "\u2601\uFE0F"}</span>
          Radar {showRadar ? "ON" : "OFF"}
        </button>
      )}
    </div>
  );
}
