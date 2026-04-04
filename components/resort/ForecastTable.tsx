"use client";

import { useState } from "react";
import type { ForecastPeriod } from "@/lib/types";
import WeatherIcon from "@/components/weather/WeatherIcon";
import WindArrow from "@/components/weather/WindArrow";

interface ForecastTableProps {
  periods: ForecastPeriod[];
}

const PERIOD_LABEL: Record<string, string> = {
  morning: "AM",
  afternoon: "PM",
  evening: "Eve",
};

function snowBarOpacity(inches: number): number {
  if (inches >= 6) return 1;
  if (inches >= 3) return 0.75;
  return 0.5;
}

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
    <div className="bg-surface rounded-lg border border-border overflow-hidden">
      {/* Desktop table */}
      <div className="hidden md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-text-muted text-xs uppercase tracking-wider">
              <th className="px-4 py-2 text-left font-medium">Day</th>
              <th className="px-3 py-2 text-left font-medium w-12"></th>
              <th className="px-3 py-2 text-left font-medium">Temp</th>
              <th className="px-3 py-2 text-left font-medium">Wind</th>
              <th className="px-3 py-2 text-left font-medium w-24">Snow</th>
              <th className="px-3 py-2 text-left font-medium">Forecast</th>
            </tr>
          </thead>
          <tbody>
            {days.map((dayGroup, di) =>
              dayGroup.periods.map((p, pi) => {
                const globalIdx = periods.indexOf(p);
                const isExpanded = expandedIdx === globalIdx;
                return (
                  <tr
                    key={`${p.day}-${p.period}`}
                    className={`border-b border-border/50 hover:bg-surface2/50 transition-colors ${
                      pi === 0 && di > 0 ? "border-t border-border" : ""
                    }`}
                  >
                    {/* Day label — only on first row of group */}
                    <td className="px-4 py-2.5 text-text-base font-medium whitespace-nowrap align-top">
                      {pi === 0 ? dayGroup.day : ""}
                    </td>

                    {/* Period label + icon */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-text-muted text-xs w-7">
                          {PERIOD_LABEL[p.period] ?? p.period}
                        </span>
                        <WeatherIcon condition={p.condition} size={20} />
                      </div>
                    </td>

                    {/* Temperature */}
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="text-text-base font-medium">
                        {Math.round(p.highTemp)}°
                      </span>
                      <span className="text-text-muted text-xs ml-1">
                        / {Math.round(p.feelsLike)}°
                      </span>
                    </td>

                    {/* Wind */}
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className="text-text-base">
                          {Math.round(p.windSpeed)}
                        </span>
                        <WindArrow direction={p.windDirection} size={14} />
                        {p.windGust > p.windSpeed + 5 && (
                          <span className="text-text-muted text-xs">
                            g{Math.round(p.windGust)}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Snow bar */}
                    <td className="px-3 py-2.5">
                      {p.snowInches > 0 ? (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-4 bg-surface2 rounded overflow-hidden">
                            <div
                              className="h-full rounded bg-cyan transition-all duration-300"
                              style={{
                                width: `${Math.min((p.snowInches / maxSnow) * 100, 100)}%`,
                                opacity: snowBarOpacity(p.snowInches),
                              }}
                            />
                          </div>
                          <span className="text-cyan text-xs font-medium w-8 text-right">
                            {p.snowInches}"
                          </span>
                        </div>
                      ) : (
                        <span className="text-text-muted text-xs">&mdash;</span>
                      )}
                    </td>

                    {/* Short forecast */}
                    <td className="px-3 py-2.5 text-text-subtle text-xs max-w-[200px]">
                      <button
                        onClick={() =>
                          setExpandedIdx(isExpanded ? null : globalIdx)
                        }
                        className={`text-left ${
                          isExpanded ? "" : "line-clamp-1"
                        } hover:text-text-base transition-colors`}
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
      <div className="md:hidden divide-y divide-border">
        {days.map((dayGroup, di) => (
          <div key={dayGroup.day} className={di > 0 ? "border-t border-border" : ""}>
            <div className="px-4 py-2 bg-surface2/50">
              <span className="text-text-base font-medium text-sm">
                {dayGroup.day}
              </span>
            </div>
            {dayGroup.periods.map((p) => {
              const globalIdx = periods.indexOf(p);
              const isExpanded = expandedIdx === globalIdx;
              return (
                <div
                  key={`${p.day}-${p.period}`}
                  className="px-4 py-3 flex items-center gap-3"
                >
                  <span className="text-text-muted text-xs w-7 shrink-0">
                    {PERIOD_LABEL[p.period] ?? p.period}
                  </span>
                  <WeatherIcon condition={p.condition} size={20} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-text-base font-medium">
                        {Math.round(p.highTemp)}°
                      </span>
                      <div className="flex items-center gap-1">
                        <span className="text-text-subtle text-xs">
                          {Math.round(p.windSpeed)}
                        </span>
                        <WindArrow direction={p.windDirection} size={12} />
                      </div>
                      {p.snowInches > 0 && (
                        <span className="text-cyan text-xs font-medium">
                          {p.snowInches}"
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() =>
                        setExpandedIdx(isExpanded ? null : globalIdx)
                      }
                      className={`text-text-muted text-xs mt-0.5 text-left ${
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
