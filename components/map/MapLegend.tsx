"use client";

import { useState, useEffect, useRef } from "react";

// Earth palette — matches MapView marker colors
const LEGEND_ITEMS = [
  { color: "#3c5a3a", label: "Great" },   // pc-forest
  { color: "#6d8a4a", label: "Good" },    // pc-good (moss)
  { color: "#e2a740", label: "Fair" },    // pc-mustard
  { color: "#a93f20", label: "Poor" },    // pc-alpen-dk
] as const;

export default function MapLegend() {
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

  return (
    <div ref={ref} className="absolute bottom-3 right-3 z-10">
      {open ? (
        <div className="bg-cream-50 border-[1.5px] border-ink rounded-[14px] shadow-stamp p-3 transition-all">
          <button
            onClick={() => setOpen(false)}
            className="pc-eyebrow mb-2 text-left hover:text-ink transition-colors"
            style={{ color: "var(--pc-bark)" }}
          >
            Legend ×
          </button>
          <div className="flex flex-col gap-1.5">
            {LEGEND_ITEMS.map(({ color, label }) => (
              <div key={label} className="flex items-center gap-2">
                <span
                  className="inline-block w-3 h-3 rounded-full shrink-0 border-[1.5px] border-ink"
                  style={{ backgroundColor: color }}
                />
                <span className="font-mono font-bold text-[11px] text-ink uppercase tracking-[0.1em]">
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="bg-cream-50 border-[1.5px] border-ink rounded-full px-3 py-1.5 text-ink text-[11px] font-bold uppercase tracking-[0.14em] shadow-stamp-sm hover:shadow-stamp hover:-translate-x-[1px] hover:-translate-y-[1px] transition-[transform,box-shadow] duration-100"
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
