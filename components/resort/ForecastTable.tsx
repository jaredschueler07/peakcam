"use client";

import { useState } from "react";
import type { ForecastPeriod } from "@/lib/types";
import WeatherIcon from "@/components/weather/WeatherIcon";
import WindArrow, { normalizeCompass } from "@/components/weather/WindArrow";

interface ForecastTableProps {
  periods: ForecastPeriod[];
}

/** Wind readout parts. NWS reports an empty windDirection for calm periods, so
 *  speed, direction and gust each have to stand alone. */
function windReadout(p: ForecastPeriod) {
  const mph = Number.isFinite(p.windSpeed) ? Math.round(p.windSpeed) : null;
  const direction = normalizeCompass(p.windDirection);
  const gust =
    mph != null && Number.isFinite(p.windGust) && p.windGust > p.windSpeed + 5
      ? Math.round(p.windGust)
      : null;
  const label =
    mph == null
      ? "Wind unavailable"
      : `Wind ${mph} mph${direction ? ` from ${direction}` : ""}${
          gust != null ? `, gusting ${gust} mph` : ""
        }`;
  return { mph, direction, gust, label };
}

const PERIOD_LABEL: Record<string, string> = {
  morning: "AM",
  afternoon: "PM",
  evening: "EVE",
};

function snowBarOpacity(inches: number): number {
  if (inches >= 6) return 1;
  if (inches >= 3) return 0.75;
  return 0.5;
}

// Paper-card forecast table — stamped shadow, dashed bark dividers, mono data
export function ForecastTable({ periods }: ForecastTableProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  // Group periods by day
  const days: { day: string; periods: ForecastPeriod[] }[] = [];
  for (const p of periods) {
    const last = days[days.length - 1];
    if (last && last.day === p.day) {
      last.periods.push(p);
    } else {
      days.push({ day: p.day, periods: [p] });
    }
  }

  // Max snow for scaling bars
  const maxSnow = Math.max(1, ...periods.map((p) => p.snowInches));

  return (
    <div className="bg-cream-50 border-[1.5px] border-ink rounded-[18px] shadow-stamp overflow-hidden">
      {/* Desktop table */}
      <div className="hidden md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-[1.5px] border-dashed border-bark bg-cream">
              <th className="px-4 py-3 text-left font-mono font-bold text-[11px] uppercase tracking-[0.14em] text-bark">Day</th>
              <th className="px-3 py-3 text-left font-mono font-bold text-[11px] uppercase tracking-[0.14em] text-bark w-16"></th>
              <th className="px-3 py-3 text-left font-mono font-bold text-[11px] uppercase tracking-[0.14em] text-bark">Temp</th>
              <th className="px-3 py-3 text-left font-mono font-bold text-[11px] uppercase tracking-[0.14em] text-bark">Wind</th>
              <th className="px-3 py-3 text-left font-mono font-bold text-[11px] uppercase tracking-[0.14em] text-bark w-32">Snow</th>
              <th className="px-3 py-3 text-left font-mono font-bold text-[11px] uppercase tracking-[0.14em] text-bark">Forecast</th>
            </tr>
          </thead>
          <tbody>
            {days.map((dayGroup, di) =>
              dayGroup.periods.map((p, pi) => {
                const globalIdx = periods.indexOf(p);
                const isExpanded = expandedIdx === globalIdx;
                return (
                  <tr
                    key={`${p.day}-${p.period}-${globalIdx}`}
                    className={`border-b border-dashed border-bark/40 hover:bg-cream transition-colors ${
                      pi === 0 && di > 0 ? "border-t-[1.5px] border-dashed border-bark" : ""
                    }`}
                  >
                    {/* Day label — only on first row of group */}
                    <td className="px-4 py-2.5 whitespace-nowrap align-top">
                      {pi === 0 && (
                        <span className="font-display font-black text-ink text-[15px] leading-tight">
                          {dayGroup.day}
                        </span>
                      )}
                    </td>

                    {/* Period label + icon */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-bark text-[10px] font-bold uppercase tracking-[0.1em] w-8">
                          {PERIOD_LABEL[p.period] ?? p.period.toUpperCase()}
                        </span>
                        <WeatherIcon condition={p.condition} size={20} />
                      </div>
                    </td>

                    {/* Temperature */}
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="font-mono font-bold text-ink text-[14px] tabular-nums">
                        {Math.round(p.highTemp)}°
                      </span>
                      <span className="font-mono text-bark text-[11px] ml-1 tabular-nums">
                        / {Math.round(p.feelsLike)}°
                      </span>
                    </td>

                    {/* Wind */}
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {(() => {
                        const wind = windReadout(p);
                        if (wind.mph == null) {
                          return <span className="font-mono text-bark text-[11px]">&mdash;</span>;
                        }
                        return (
                          <div className="flex items-center gap-1.5" role="img" aria-label={wind.label}>
                            <span className="font-mono font-bold text-ink text-[13px] tabular-nums">
                              {wind.mph}
                            </span>
                            {wind.direction ? (
                              <WindArrow direction={wind.direction} size={14} decorative />
                            ) : (
                              <span className="font-mono text-bark text-[10px] uppercase tracking-[0.08em]">
                                mph
                              </span>
                            )}
                            {wind.gust != null && (
                              <span className="font-mono text-bark text-[11px] tabular-nums">
                                g{wind.gust}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </td>

                    {/* Snow bar */}
                    <td className="px-3 py-2.5">
                      {p.snowInches > 0 ? (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-3 bg-cream-dk border-[1.5px] border-ink rounded-full overflow-hidden">
                            <div
                              className="h-full bg-alpen transition-all duration-300"
                              style={{
                                width: `${Math.min((p.snowInches / maxSnow) * 100, 100)}%`,
                                opacity: snowBarOpacity(p.snowInches),
                              }}
                            />
                          </div>
                          <span className="font-mono font-bold text-alpen-dk text-[12px] w-8 text-right tabular-nums">
                            {p.snowInches}&quot;
                          </span>
                        </div>
                      ) : (
                        <span className="font-mono text-bark text-[11px]">&mdash;</span>
                      )}
                    </td>

                    {/* Short forecast */}
                    <td className="px-3 py-2.5 text-[12px] max-w-[220px]">
                      <button
                        onClick={() =>
                          setExpandedIdx(isExpanded ? null : globalIdx)
                        }
                        className={`text-left text-ink/80 hover:text-ink transition-colors ${
                          isExpanded ? "" : "line-clamp-1"
                        }`}
                      >
                        {p.shortForecast}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile: stacked cards */}
      <div className="md:hidden divide-y divide-dashed divide-bark/40">
        {days.map((dayGroup, di) => (
          <div key={dayGroup.day} className={di > 0 ? "border-t-[1.5px] border-dashed border-bark" : ""}>
            <div className="px-4 py-2 bg-cream border-b border-dashed border-bark/40">
              <span className="font-display font-black text-ink text-[15px]">
                {dayGroup.day}
              </span>
            </div>
            {dayGroup.periods.map((p) => {
              const globalIdx = periods.indexOf(p);
              const isExpanded = expandedIdx === globalIdx;
              return (
                <div
                  key={`${p.day}-${p.period}-${globalIdx}`}
                  className="px-4 py-3 flex items-center gap-3"
                >
                  <span className="font-mono text-bark text-[10px] font-bold uppercase tracking-[0.1em] w-8 shrink-0">
                    {PERIOD_LABEL[p.period] ?? p.period.toUpperCase()}
                  </span>
                  <WeatherIcon condition={p.condition} size={20} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 text-sm">
                      <span className="font-mono font-bold text-ink tabular-nums">
                        {Math.round(p.highTemp)}°
                      </span>
                      {(() => {
                        const wind = windReadout(p);
                        if (wind.mph == null) return null;
                        return (
                          <div className="flex items-center gap-1" role="img" aria-label={wind.label}>
                            <span className="font-mono text-ink text-[12px] tabular-nums">
                              {wind.mph}
                            </span>
                            {wind.direction ? (
                              <WindArrow direction={wind.direction} size={12} decorative />
                            ) : (
                              <span className="font-mono text-bark text-[10px] uppercase tracking-[0.08em]">
                                mph
                              </span>
                            )}
                          </div>
                        );
                      })()}
                      {p.snowInches > 0 && (
                        <span className="font-mono font-bold text-alpen-dk text-[12px] tabular-nums">
                          {p.snowInches}&quot;
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() =>
                        setExpandedIdx(isExpanded ? null : globalIdx)
                      }
                      className={`text-bark text-xs mt-0.5 text-left ${
                        isExpanded ? "" : "line-clamp-1"
                      }`}
                    >
                      {p.shortForecast}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
