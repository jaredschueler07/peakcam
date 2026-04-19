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

// Poster-style conditions strip: cream-50 card, ink border, stamped, dashed bark dividers
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
    <div className="bg-cream-50 border-[1.5px] border-ink rounded-[18px] shadow-stamp p-2">
      <div className="grid grid-cols-2 md:grid-cols-4">
        {/* Temperature */}
        <div className="flex flex-col items-center justify-center px-4 py-4 md:border-r-[1.5px] md:border-dashed md:border-bark">
          <span className="font-display font-black text-4xl leading-none text-ink tracking-[-0.02em] tabular-nums">
            {fmt(currentTemp, "\u00B0")}
          </span>
          <span className="pc-eyebrow mt-2" style={{ fontSize: 10.5 }}>
            Feels {fmt(feelsLike, "\u00B0")}
          </span>
        </div>

        {/* 24h Snowfall — alpen hero stat */}
        <div className="flex flex-col items-center justify-center px-4 py-4 md:border-r-[1.5px] md:border-dashed md:border-bark">
          <span className="font-display font-black text-5xl leading-none text-alpen tracking-[-0.02em] tabular-nums">
            {newSnow24h != null ? `${newSnow24h}"` : "\u2014"}
          </span>
          <span className="pc-eyebrow mt-2" style={{ fontSize: 10.5 }}>
            New snow
          </span>
        </div>

        {/* Wind */}
        <div className="flex flex-col items-center justify-center px-4 py-4 md:border-r-[1.5px] md:border-dashed md:border-bark border-t-[1.5px] border-dashed border-bark md:border-t-0">
          <div className="flex items-center gap-2">
            <span className="font-display font-black text-4xl leading-none text-ink tracking-[-0.02em] tabular-nums">
              {fmt(windSpeed, "")}
            </span>
            {windDirection && <WindArrow direction={windDirection} size={22} />}
            <span className="font-mono text-bark text-sm font-bold">mph</span>
          </div>
          {windGust != null && windSpeed != null && windGust > windSpeed ? (
            <span className="pc-eyebrow mt-2" style={{ fontSize: 10.5 }}>
              Gusts {Math.round(windGust)} mph
            </span>
          ) : (
            <span className="pc-eyebrow mt-2" style={{ fontSize: 10.5 }}>
              Wind
            </span>
          )}
        </div>

        {/* Precipitation */}
        <div className="flex flex-col items-center justify-center px-4 py-4 relative overflow-hidden border-t-[1.5px] border-dashed border-bark md:border-t-0">
          {/* Fill bar — alpen tint rising from bottom */}
          <div
            className="absolute left-0 right-0 bottom-0 bg-alpen/10 transition-all duration-300 pointer-events-none"
            style={{ height: `${Math.min(precip, 100)}%` }}
          />
          <span className="font-display font-black text-4xl leading-none text-ink tracking-[-0.02em] tabular-nums relative z-10">
            {fmt(precipProbability, "%")}
          </span>
          <span className="pc-eyebrow mt-2 relative z-10" style={{ fontSize: 10.5 }}>
            Precip chance
          </span>
        </div>
      </div>
    </div>
  );
}
