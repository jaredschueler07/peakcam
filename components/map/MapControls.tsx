"use client";

import { Play, Pause } from "lucide-react";
import type { MapMetric } from "@/lib/map-utils";
import { metricLabel } from "@/lib/map-utils";
import WeatherIcon from "@/components/weather/WeatherIcon";

const METRICS: MapMetric[] = ["baseDepth", "snow24h", "conditions"];

interface RadarScrubber {
  count: number;
  index: number;
  playing: boolean;
  /** Relative time of the active frame, e.g. "-40m" / "Now" / "+10m". */
  label: string;
  onScrub: (index: number) => void;
  onTogglePlay: () => void;
}

interface MapControlsProps {
  metric: MapMetric;
  onMetricChange: (metric: MapMetric) => void;
  showRadar: boolean;
  onToggleRadar: () => void;
  radarAvailable: boolean;
  /** Present while radar is on with 2+ frames — renders the loop control. */
  radarScrubber?: RadarScrubber | null;
  inSeasonOnly: boolean;
  onToggleInSeason: () => void;
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
  radarScrubber = null,
  inSeasonOnly,
  onToggleInSeason,
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

      {/* Radar loop scrubber — play/pause + frame slider + relative time */}
      {radarScrubber && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-cream-50 border-[1.5px] border-ink rounded-full shadow-stamp-sm">
          {/* min 24px hit area (WCAG 2.5.8) — the icon alone is too small a target */}
          <button
            onClick={radarScrubber.onTogglePlay}
            aria-label={radarScrubber.playing ? "Pause radar loop" : "Play radar loop"}
            className="flex min-h-[24px] min-w-[24px] items-center justify-center -my-1 text-ink hover:text-alpen transition-colors"
          >
            {radarScrubber.playing ? (
              <Pause size={14} strokeWidth={2.5} fill="currentColor" />
            ) : (
              <Play size={14} strokeWidth={2.5} fill="currentColor" />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={radarScrubber.count - 1}
            step={1}
            value={radarScrubber.index}
            onChange={(e) => radarScrubber.onScrub(Number(e.target.value))}
            aria-label="Radar frame time"
            className="pc-range w-20"
          />
          <span className="font-mono font-bold text-[10.5px] text-ink uppercase tracking-[0.08em] tabular-nums w-9 text-right">
            {radarScrubber.label}
          </span>
        </div>
      )}

      {/* In-season-only toggle — hides off-season (summer) resorts */}
      <button
        onClick={onToggleInSeason}
        aria-pressed={inSeasonOnly}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border-[1.5px] text-[11.5px] font-bold uppercase tracking-[0.06em] transition-[transform,box-shadow] duration-100 ${
          inSeasonOnly
            ? "bg-forest text-cream-50 border-ink shadow-stamp hover:shadow-stamp-hover hover:-translate-x-[1px] hover:-translate-y-[1px]"
            : "bg-cream-50 text-ink border-ink shadow-stamp-sm hover:shadow-stamp hover:-translate-x-[1px] hover:-translate-y-[1px]"
        }`}
      >
        <WeatherIcon condition={inSeasonOnly ? "clear" : "cold"} size={14} />
        In-season {inSeasonOnly ? "only" : "+ off"}
      </button>
    </div>
  );
}
