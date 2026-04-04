"use client";

import WindArrow from "@/components/weather/WindArrow";

interface ConditionsHeroProps {
  currentTemp?: number | null;
  feelsLike?: number | null;
  newSnow24h?: number | null;
  windSpeed?: number | null;
  windDirection?: string | null;
  windGust?: number | null;
  precipProbability?: number | null;
}

function fmt(value: number | null | undefined, suffix: string): string {
  if (value == null) return "\u2014";
  return `${Math.round(value)}${suffix}`;
}

export function ConditionsHero({
  currentTemp,
  feelsLike,
  newSnow24h,
  windSpeed,
  windDirection,
  windGust,
  precipProbability,
}: ConditionsHeroProps) {
  const precip = precipProbability ?? 0;

  return (
    <div className="bg-surface rounded-lg p-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-0 md:divide-x md:divide-border">
        {/* Temperature */}
        <div className="flex flex-col items-center justify-center px-4 py-2">
          <span className="text-4xl font-bold text-text-base leading-none">
            {fmt(currentTemp, "\u00B0")}
          </span>
          <span className="text-text-muted text-sm mt-1.5">
            Feels like {fmt(feelsLike, "\u00B0")}
          </span>
        </div>

        {/* 24h Snowfall — most prominent */}
        <div className="flex flex-col items-center justify-center px-4 py-2">
          <span className="text-5xl font-bold text-cyan leading-none">
            {newSnow24h != null ? `${newSnow24h}"` : "\u2014"}
          </span>
          <span className="text-text-muted text-sm mt-1.5">new snow</span>
        </div>

        {/* Wind */}
        <div className="flex flex-col items-center justify-center px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="text-4xl font-bold text-text-base leading-none">
              {fmt(windSpeed, "")}
            </span>
            {windDirection && (
              <WindArrow direction={windDirection} size={24} />
            )}
            <span className="text-text-muted text-sm">mph</span>
          </div>
          {windGust != null && windSpeed != null && windGust > windSpeed && (
            <span className="text-text-muted text-sm mt-1.5">
              gusts {Math.round(windGust)} mph
            </span>
          )}
          {(windGust == null || windSpeed == null || windGust <= (windSpeed ?? 0)) && (
            <span className="text-text-muted text-sm mt-1.5">wind</span>
          )}
        </div>

        {/* Precipitation */}
        <div className="flex flex-col items-center justify-center px-4 py-2 relative">
          {/* Background bar fill — grows upward from bottom */}
          <div
            className="absolute left-0 right-0 bottom-0 rounded-lg bg-cyan/5 transition-all duration-300"
            style={{ height: `${Math.min(precip, 100)}%` }}
          />
          <span className="text-4xl font-bold text-text-base leading-none relative z-10">
            {fmt(precipProbability, "%")}
          </span>
          <span className="text-text-muted text-sm mt-1.5 relative z-10">
            precip chance
          </span>
        </div>
      </div>
    </div>
  );
}
