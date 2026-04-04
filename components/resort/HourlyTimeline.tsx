"use client";

import { useState, useMemo } from "react";
import type { HourlyWeather } from "@/lib/types";

interface HourlyTimelineProps {
  hourlyData: HourlyWeather[];
}

const CYAN = "#60C8FF";
const GREY = "#4A6480";
const WHITE = "#E8F0F8";

/** Convert compass direction to degrees (arrow points where wind blows TO). */
function compassDeg(dir: string): number {
  const map: Record<string, number> = {
    N: 180, NNE: 202.5, NE: 225, ENE: 247.5,
    E: 270, ESE: 292.5, SE: 315, SSE: 337.5,
    S: 0, SSW: 22.5, SW: 45, WSW: 67.5,
    W: 90, WNW: 112.5, NW: 135, NNW: 157.5,
  };
  return map[dir.toUpperCase()] ?? 180;
}

function snowOpacity(inches: number): number {
  if (inches >= 1) return 1;
  if (inches >= 0.3) return 0.6;
  return 0.3;
}

function formatHour(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  if (h === 0) return "12am";
  if (h === 12) return "12pm";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

export function HourlyTimeline({ hourlyData }: HourlyTimelineProps) {
  const [expanded, setExpanded] = useState(false);

  const chartData = useMemo(() => {
    if (hourlyData.length === 0) return null;

    const temps = hourlyData.map((h) => h.temperature);
    const minTemp = Math.min(...temps) - 10;
    const maxTemp = Math.max(...temps) + 10;
    const tempRange = maxTemp - minTemp || 1;

    const count = hourlyData.length;
    const slotW = 20; // px per hour slot
    const chartW = count * slotW;
    const chartH = 120;
    const padTop = 16;
    const padBottom = 30; // room for labels + wind
    const plotH = chartH - padTop - padBottom;

    // Temperature y position
    const tempY = (t: number) =>
      padTop + plotH - ((t - minTemp) / tempRange) * plotH;

    // Build temperature line path (simple line segments)
    const points = hourlyData.map((h, i) => ({
      x: i * slotW + slotW / 2,
      y: tempY(h.temperature),
    }));
    const pathD = points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
      .join(" ");

    // Freezing line
    const has32 = temps.some((t) => t <= 32) && temps.some((t) => t >= 32);
    const freezeY = tempY(32);

    // Time labels at 6h intervals
    const labels: { x: number; text: string }[] = [];
    for (let i = 0; i < count; i++) {
      const d = new Date(hourlyData[i].time);
      if (d.getHours() % 6 === 0) {
        labels.push({ x: i * slotW + slotW / 2, text: formatHour(hourlyData[i].time) });
      }
    }

    // Wind arrows at 3h intervals
    const winds: { x: number; deg: number }[] = [];
    for (let i = 0; i < count; i += 3) {
      winds.push({
        x: i * slotW + slotW / 2,
        deg: compassDeg(hourlyData[i].windDirection),
      });
    }

    return { chartW, chartH, slotW, pathD, points, has32, freezeY, labels, winds, padBottom };
  }, [hourlyData]);

  if (!chartData || hourlyData.length === 0) return null;

  return (
    <div className="bg-surface rounded-lg border border-border overflow-hidden">
      {/* Header toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface2/50 transition-colors"
      >
        <span className="text-text-base text-sm font-medium">48-Hour Detail</span>
        <svg
          className={`w-4 h-4 text-text-muted transition-transform duration-200 ${
            expanded ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Chart body */}
      {expanded && (
        <div className="px-4 pb-4 overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
          <svg
            width={chartData.chartW}
            height={chartData.chartH}
            viewBox={`0 0 ${chartData.chartW} ${chartData.chartH}`}
            className="block"
          >
            {/* Snow bars */}
            {hourlyData.map((h, i) =>
              h.snowInches > 0 ? (
                <rect
                  key={`snow-${i}`}
                  x={i * chartData.slotW + 2}
                  y={chartData.chartH - chartData.padBottom - Math.min(h.snowInches * 8, 40)}
                  width={chartData.slotW - 4}
                  height={Math.min(h.snowInches * 8, 40)}
                  fill={CYAN}
                  opacity={snowOpacity(h.snowInches)}
                  rx={2}
                />
              ) : null
            )}

            {/* Freezing line */}
            {chartData.has32 && (
              <line
                x1={0}
                y1={chartData.freezeY}
                x2={chartData.chartW}
                y2={chartData.freezeY}
                stroke={GREY}
                strokeWidth={1}
                strokeDasharray="4 3"
                opacity={0.5}
              />
            )}

            {/* Temperature line */}
            <path
              d={chartData.pathD}
              stroke={WHITE}
              strokeWidth={1.5}
              fill="none"
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {/* Time labels */}
            {chartData.labels.map((l, i) => (
              <text
                key={`label-${i}`}
                x={l.x}
                y={chartData.chartH - 18}
                textAnchor="middle"
                fill={GREY}
                fontSize={10}
                fontFamily="Inter, sans-serif"
              >
                {l.text}
              </text>
            ))}

            {/* Wind arrows */}
            {chartData.winds.map((w, i) => (
              <g
                key={`wind-${i}`}
                transform={`translate(${w.x}, ${chartData.chartH - 8}) rotate(${w.deg})`}
              >
                <path d="M0 -4L2.5 2H-2.5L0 -4Z" fill={GREY} opacity={0.7} />
              </g>
            ))}
          </svg>
        </div>
      )}
    </div>
  );
}
