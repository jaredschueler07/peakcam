"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Play, Pause } from "lucide-react";
import type { MapMetric } from "@/lib/map-utils";
import { metricLabel } from "@/lib/map-utils";
import WeatherIcon from "@/components/weather/WeatherIcon";

const METRICS: MapMetric[] = ["baseDepth", "snow24h", "conditions"];

/** Weather overlay selection — radar (precipitation) or satellite (clouds). */
export type WeatherLayer = "off" | "radar" | "satellite";

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
  weatherLayer: WeatherLayer;
  onWeatherLayerChange: (layer: WeatherLayer) => void;
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
  weatherLayer,
  onWeatherLayerChange,
  radarAvailable,
  radarScrubber = null,
  inSeasonOnly,
  onToggleInSeason,
  variant,
  className,
}: MapControlsProps) {
  const [layersOpen, setLayersOpen] = useState(false);
  const positionClass = className ?? (variant === "fullpage" ? "top-14 left-3 max-[400px]:top-16" : "top-3 left-3");

  const layers = <>
      {/* Weather layer selector — radar (precipitation echo) or satellite
          (GOES-East clouds). Mutually exclusive; tapping the active one turns
          it off. Radar has no coverage in Chile — satellite is the Andes
          storm-watching answer, hence both options side by side. */}
      <div className="flex gap-1.5">
        {radarAvailable && (
          <button
            onClick={() => onWeatherLayerChange(weatherLayer === "radar" ? "off" : "radar")}
            aria-pressed={weatherLayer === "radar"}
            title="Precipitation radar (RainViewer) — no radar coverage in Chile; use Satellite there"
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 min-h-11 pointer-coarse:px-4 rounded-full border-[1.5px] text-[11.5px] font-bold uppercase tracking-[0.06em] transition-[transform,box-shadow] duration-100 ${
              weatherLayer === "radar"
                ? "bg-alpen-dk text-cream-50 border-ink shadow-stamp hover:shadow-stamp-hover hover:-translate-x-[1px] hover:-translate-y-[1px]"
                : "bg-cream-50 text-ink border-ink shadow-stamp-sm hover:shadow-stamp hover:-translate-x-[1px] hover:-translate-y-[1px]"
            }`}
          >
            <WeatherIcon condition="rain" size={14} />
            Radar
          </button>
        )}
        <button
          onClick={() => onWeatherLayerChange(weatherLayer === "satellite" ? "off" : "satellite")}
          aria-label="Satellite"
          aria-pressed={weatherLayer === "satellite"}
          title="GOES-East satellite (NASA GIBS) — clouds over the whole Americas, updated every 10 min"
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 min-h-11 pointer-coarse:px-4 rounded-full border-[1.5px] text-[11.5px] font-bold uppercase tracking-[0.06em] transition-[transform,box-shadow] duration-100 ${
            weatherLayer === "satellite"
              ? "bg-alpen-dk text-cream-50 border-ink shadow-stamp hover:shadow-stamp-hover hover:-translate-x-[1px] hover:-translate-y-[1px]"
              : "bg-cream-50 text-ink border-ink shadow-stamp-sm hover:shadow-stamp hover:-translate-x-[1px] hover:-translate-y-[1px]"
          }`}
        >
          <WeatherIcon condition="partly-cloudy" size={14} />
          Satellite
        </button>
      </div>

      {/* Radar loop scrubber — play/pause + frame slider + relative time */}
      {radarScrubber && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-cream-50 border-[1.5px] border-ink rounded-full shadow-stamp-sm">
          {/* 24px hit area on desktop; 44px on touch (WCAG 2.5.8 / Apple HIG) */}
          <button
            onClick={radarScrubber.onTogglePlay}
            aria-label={radarScrubber.playing ? "Pause radar loop" : "Play radar loop"}
            className="flex min-h-[24px] min-w-[24px] min-h-11 pointer-coarse:min-w-11 items-center justify-center -my-1 text-ink hover:text-alpen transition-colors"
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
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 min-h-11 pointer-coarse:px-4 rounded-full border-[1.5px] text-[11.5px] font-bold uppercase tracking-[0.06em] transition-[transform,box-shadow] duration-100 ${
          inSeasonOnly
            ? "bg-forest text-cream-50 border-ink shadow-stamp hover:shadow-stamp-hover hover:-translate-x-[1px] hover:-translate-y-[1px]"
            : "bg-cream-50 text-ink border-ink shadow-stamp-sm hover:shadow-stamp hover:-translate-x-[1px] hover:-translate-y-[1px]"
        }`}
      >
        <WeatherIcon condition={inSeasonOnly ? "clear" : "cold"} size={14} />
        In-season {inSeasonOnly ? "only" : "+ off"}
      </button>
  </>;

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
              className={`px-3 py-1 min-h-11 pointer-coarse:px-4 text-[11.5px] font-bold rounded-full border-[1.5px] transition-colors duration-150 uppercase tracking-[0.06em] ${
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

      <button type="button" onClick={event => { event.currentTarget.focus(); setLayersOpen(true); }} className="min-h-11 self-start rounded-full border border-ink bg-cream-50 px-4 text-sm font-bold shadow-stamp-sm md:hidden">Layers{weatherLayer !== "off" ? ` · ${weatherLayer}` : ""}</button>
      <div className="hidden flex-col gap-2 md:flex">{layers}</div>
      {layersOpen && <Modal onClose={() => setLayersOpen(false)} label="Map layers" className="inset-x-0 bottom-0 top-auto m-0 w-full rounded-t-[18px]">
        <div className="space-y-4 p-5"><h2 className="font-display text-2xl font-bold">Map layers</h2>{layers}<button onClick={() => setLayersOpen(false)} className="min-h-11 w-full rounded-full bg-ink px-4 text-sm font-bold text-cream-50">Done</button></div>
      </Modal>}
    </div>
  );
}
