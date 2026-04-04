"use client";

import { useState, useEffect, useRef } from "react";

const LEGEND_ITEMS = [
  { color: "#2ECC8F", label: "Great" },
  { color: "#60C8FF", label: "Good" },
  { color: "#8AA3BE", label: "Fair" },
  { color: "#f87171", label: "Poor" },
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
        <div className="bg-surface/90 backdrop-blur-sm rounded-lg border border-white/10 p-3 transition-all">
          <button
            onClick={() => setOpen(false)}
            className="text-text-muted text-xs font-medium mb-2 hover:text-text-subtle transition-colors"
          >
            Legend
          </button>
          <div className="flex flex-col gap-1.5">
            {LEGEND_ITEMS.map(({ color, label }) => (
              <div key={label} className="flex items-center gap-2">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className="text-text-subtle text-xs">{label}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="bg-surface/90 backdrop-blur-sm rounded-lg border border-white/10 px-3 py-1.5 text-text-muted text-xs font-medium hover:text-text-subtle transition-all"
        >
          <span className="flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="opacity-70">
              <circle cx="3" cy="3" r="2" fill="#2ECC8F" />
              <circle cx="9" cy="3" r="2" fill="#60C8FF" />
              <circle cx="3" cy="9" r="2" fill="#8AA3BE" />
              <circle cx="9" cy="9" r="2" fill="#f87171" />
            </svg>
            Legend
          </span>
        </button>
      )}
    </div>
  );
}
