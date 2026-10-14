"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import type { MapMetric } from "@/lib/map-utils";
import { RATING_RULES } from "@/lib/conditions-engine";

// Categorical rating swatches — matches MapView marker colors. Each row's
// tooltip is the rating rule itself, derived from RATING_THRESHOLDS.
const RATING_ITEMS = [
  { color: "#3c5a3a", label: "Great", title: `Great: ${RATING_RULES.great}` }, // pc-forest
  { color: "#6d8a4a", label: "Good",  title: `Good: ${RATING_RULES.good}` },   // pc-good (moss)
  { color: "#e2a740", label: "Fair",  title: `Fair: ${RATING_RULES.fair}` },   // pc-mustard
  { color: "#a93f20", label: "Poor",  title: `Poor: ${RATING_RULES.poor}` },   // pc-alpen-dk
] as const;
const OFF_SEASON = {
  color: "#b59b74", // neutral bark
  label: "Off-season",
  title: "Off-season: outside the local snow season, so no rating is shown",
};

// Sequential ramp legend — mirrors MapView's METRIC_RAMP + RAMP_LIGHT..DARK.
const RAMP_CSS = "linear-gradient(90deg, #dbe6d4, #1f3322)";
const METRIC_LEGEND: Record<
  Exclude<MapMetric, "conditions">,
  { title: string; max: string }
> = {
  baseDepth: { title: "Base depth", max: '100"+' },
  snow24h: { title: "24h snow", max: '20"+' },
};

interface MapLegendProps {
  metric: MapMetric;
}

export default function MapLegend({ metric }: MapLegendProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Narrow the metric so the sequential-legend lookup is type-safe.
  const seq = metric !== "conditions" ? METRIC_LEGEND[metric] : null;

  return (
    <div ref={ref} className="absolute bottom-3 right-3 z-10">
      {open ? (
        <div className="bg-cream-50 border-[1.5px] border-ink rounded-[14px] shadow-stamp p-3 transition-all">
          <button
            onClick={() => setOpen(false)}
            className="pc-eyebrow mb-2 py-1 pointer-coarse:min-h-11 pointer-coarse:min-w-11 text-left hover:text-ink transition-colors"
            style={{ color: "var(--pc-bark)" }}
          >
            Legend ×
          </button>

          {seq ? (
            // Sequential ramp: gradient bar + endpoints, plus the off-season swatch.
            <div className="flex flex-col gap-2">
              <div className="font-mono font-bold text-[11px] text-ink uppercase tracking-[0.1em]">
                {seq.title}
              </div>
              <div
                className="w-40 h-3 rounded-full border-[1.5px] border-ink"
                style={{ background: RAMP_CSS }}
              />
              <div className="flex justify-between font-mono text-[10px] text-bark tabular-nums">
                <span>0&quot;</span>
                <span>{seq.max}</span>
              </div>
              <div
                className="flex items-center gap-2 pt-1.5 border-t-[1.5px] border-dashed border-bark/50"
                title={OFF_SEASON.title}
              >
                <span
                  className="inline-block w-3 h-3 rounded-full shrink-0 border-[1.5px] border-ink"
                  style={{ backgroundColor: OFF_SEASON.color }}
                />
                <span className="font-mono font-bold text-[11px] text-ink uppercase tracking-[0.1em]">
                  {OFF_SEASON.label}
                </span>
              </div>
            </div>
          ) : (
            // Categorical rating swatches.
            <div className="flex flex-col gap-1.5">
              {[...RATING_ITEMS, OFF_SEASON].map(({ color, label, title }) => (
                <div key={label} className="flex items-center gap-2" title={title}>
                  <span
                    className="inline-block w-3 h-3 rounded-full shrink-0 border-[1.5px] border-ink"
                    style={{ backgroundColor: color }}
                  />
                  <span className="font-mono font-bold text-[11px] text-ink uppercase tracking-[0.1em]">
                    {label}
                  </span>
                </div>
              ))}
              {/* Tooltips need a hover; touch users get the same rules here. */}
              <Link
                href="/methodology#conditions"
                className="mt-1 pt-1.5 border-t-[1.5px] border-dashed border-bark/50 font-mono text-[10px] text-bark underline underline-offset-2 hover:text-ink transition-colors pointer-coarse:min-h-11 pointer-coarse:flex pointer-coarse:items-center"
              >
                How ratings work
              </Link>
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="bg-cream-50 border-[1.5px] border-ink rounded-full px-3 py-1.5 pointer-coarse:min-h-11 pointer-coarse:px-4 text-ink text-[11px] font-bold uppercase tracking-[0.14em] shadow-stamp-sm hover:shadow-stamp hover:-translate-x-[1px] hover:-translate-y-[1px] transition-[transform,box-shadow] duration-100"
        >
          <span className="flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
              <circle cx="3" cy="3" r="2" fill="#3c5a3a" stroke="#2a1f14" strokeWidth="0.75" />
              <circle cx="9" cy="3" r="2" fill="#6d8a4a" stroke="#2a1f14" strokeWidth="0.75" />
              <circle cx="3" cy="9" r="2" fill="#e2a740" stroke="#2a1f14" strokeWidth="0.75" />
              <circle cx="9" cy="9" r="2" fill="#a93f20" stroke="#2a1f14" strokeWidth="0.75" />
            </svg>
            Legend
          </span>
        </button>
      )}
    </div>
  );
}
