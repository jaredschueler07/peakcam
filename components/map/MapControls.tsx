"use client";

import type { MapMetric } from "@/lib/map-utils";
import { metricLabel } from "@/lib/map-utils";
import WeatherIcon from "@/components/weather/WeatherIcon";

const METRICS: MapMetric[] = ["baseDepth", "snow24h", "conditions"];

interface MapControlsProps {
  metric: MapMetric;
  onMetricChange: (metric: MapMetric) => void;
  showRadar: boolean;
  onToggleRadar: () => void;
  radarAvailable: boolean;
  variant: "sidebar" | "fullpage";
  className?: string;
}

// Poster map controls — stamped cream pills on paper
export default function MapControls({
  metric,
  onMetricChange,
  showRadar,
  onToggleRadar,
  radarAvailable,
  variant,
  className,
}: MapControlsProps) {
  const positionClass = className ?? (variant === "fullpage" ? "top-14 left-3 max-[400px]:top-16" : "top-3 left-3");

  return (
    <div className={`absolute z-10 flex flex-col gap-2 ${positionClass}`}>
      {/* Metric toggle row */}
      <div className="flex bg-cream-50 border-[1.5px] border-ink rounded-full p-1 gap-0.5 shadow-stamp-sm">
        {METRICS.map((m) => {
          const isActive = metric === m;
          return (
            <button
              key={m}
              onClick={() => onMetricChange(m)}
              className={`px-3 py-1 text-[11.5px] font-bold rounded-full border-[1.5px] transition-colors duration-150 uppercase tracking-[0.06em] ${
                isActive
                  ? "bg-ink text-cream-50 border-ink"
                  : "border-transparent text-bark hover:text-ink"
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
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border-[1.5px] text-[11.5px] font-bold uppercase tracking-[0.06em] transition-[transform,box-shadow] duration-100 ${
            showRadar
              ? "bg-alpen text-cream-50 border-ink shadow-stamp hover:shadow-stamp-hover hover:-translate-x-[1px] hover:-translate-y-[1px]"
              : "bg-cream-50 text-ink border-ink shadow-stamp-sm hover:shadow-stamp hover:-translate-x-[1px] hover:-translate-y-[1px]"
          }`}
        >
          <WeatherIcon condition={showRadar ? "rain" : "cloudy"} size={14} />
          Radar {showRadar ? "on" : "off"}
        </button>
      )}
    </div>
  );
}
