"use client";

import type { ResortWithData } from "@/lib/types";
import { conditionColor } from "@/lib/map-utils";

interface MapBottomSheetProps {
  resort: ResortWithData;
  onClose: () => void;
  onViewResort: (slug: string) => void;
}

export default function MapBottomSheet({
  resort,
  onClose,
  onViewResort,
}: MapBottomSheetProps) {
  const snow = resort.snow_report;
  const color = conditionColor(resort.cond_rating);
  const camCount = resort.cams.length;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 lg:hidden"
        onClick={onClose}
      />

      {/* Bottom Sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden animate-slide-up">
        <div className="bg-surface border-t border-border rounded-t-2xl px-5 pt-3 pb-6 shadow-xl">
          {/* Drag handle */}
          <div className="flex justify-center mb-3">
            <div className="w-10 h-1 bg-border rounded-full" />
          </div>

          {/* Resort header */}
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-text-base">
                {resort.name}
              </h3>
              <p className="text-sm text-text-subtle">
                {resort.region}, {resort.state}
              </p>
            </div>
            <span
              className="text-xs font-semibold uppercase px-2.5 py-1 rounded-full"
              style={{
                color: color,
                backgroundColor: `${color}20`,
              }}
            >
              {resort.cond_rating}
            </span>
          </div>

          {/* Snow stats */}
          <div className="grid grid-cols-4 gap-2 mb-4">
            <div className="bg-bg/60 rounded-lg p-2.5 text-center">
              <p className="font-mono font-bold text-xl text-powder">
                {snow?.base_depth != null ? `${snow.base_depth}"` : "—"}
              </p>
              <p className="text-[10px] text-text-muted uppercase tracking-wide mt-0.5">
                Base
              </p>
            </div>
            <div className="bg-bg/60 rounded-lg p-2.5 text-center">
              <p className="font-mono font-bold text-xl text-cyan">
                {snow?.new_snow_24h != null ? `${snow.new_snow_24h}"` : "—"}
              </p>
              <p className="text-[10px] text-text-muted uppercase tracking-wide mt-0.5">
                24h
              </p>
            </div>
            <div className="bg-bg/60 rounded-lg p-2.5 text-center">
              <p className="font-mono font-bold text-xl text-text-base">
                {snow?.new_snow_48h != null ? `${snow.new_snow_48h}"` : "—"}
              </p>
              <p className="text-[10px] text-text-muted uppercase tracking-wide mt-0.5">
                48h
              </p>
            </div>
            <div className="bg-bg/60 rounded-lg p-2.5 text-center">
              <p className="font-mono font-bold text-xl text-text-base">
                {snow?.trails_open != null
                  ? `${snow.trails_open}/${snow?.trails_total ?? "?"}`
                  : "—"}
              </p>
              <p className="text-[10px] text-text-muted uppercase tracking-wide mt-0.5">
                Trails
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              onClick={() => onViewResort(resort.slug)}
              className="flex-1 px-4 py-2.5 rounded-lg bg-cyan/15 border border-cyan/30 text-cyan font-medium text-sm transition-colors hover:bg-cyan/25"
            >
              View Resort
            </button>
            <button
              onClick={() => onViewResort(resort.slug)}
              className="px-4 py-2.5 rounded-lg bg-surface2 border border-border text-text-subtle font-medium text-sm transition-colors hover:bg-surface3"
            >
              {camCount} {camCount === 1 ? "Cam" : "Cams"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
