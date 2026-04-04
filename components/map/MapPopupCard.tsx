"use client";

import type { ResortWithData } from "@/lib/types";
import { conditionColor } from "@/lib/map-utils";

interface MapPopupCardProps {
  resort: ResortWithData;
  onViewResort: (slug: string) => void;
}

export default function MapPopupCard({
  resort,
}: MapPopupCardProps) {
  const snow = resort.snow_report;
  const badgeColor = conditionColor(resort.cond_rating);
  const ratingLabel =
    resort.cond_rating.charAt(0).toUpperCase() + resort.cond_rating.slice(1);

  const resortHref = `/resorts/${resort.slug}`;

  return (
    <div className="min-w-[240px] cursor-default">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <h3 className="text-text-base font-semibold text-sm">
            <a href={resortHref} className="hover:text-cyan cursor-pointer transition-colors">
              {resort.name}
            </a>
          </h3>
          <p className="text-text-muted text-xs">
            {resort.region}, {resort.state}
          </p>
        </div>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold leading-tight"
          style={{ backgroundColor: `${badgeColor}20`, color: badgeColor }}
        >
          {ratingLabel}
        </span>
      </div>

      {/* Snow stats grid */}
      <div className="grid grid-cols-3 gap-1.5 mb-2">
        <div className="bg-bg/60 rounded px-2 py-1.5 text-center">
          <p className="text-[10px] text-text-muted leading-tight mb-0.5">
            Base
          </p>
          <p className="font-mono font-bold text-sm text-powder">
            {snow?.base_depth != null ? `${snow.base_depth}"` : "—"}
          </p>
        </div>
        <div className="bg-bg/60 rounded px-2 py-1.5 text-center">
          <p className="text-[10px] text-text-muted leading-tight mb-0.5">
            24h
          </p>
          <p className="font-mono font-bold text-sm text-cyan">
            {snow?.new_snow_24h != null ? `${snow.new_snow_24h}"` : "—"}
          </p>
        </div>
        <div className="bg-bg/60 rounded px-2 py-1.5 text-center">
          <p className="text-[10px] text-text-muted leading-tight mb-0.5">
            Trails
          </p>
          <p className="font-mono font-bold text-sm text-text-base">
            {snow?.trails_open != null && snow?.trails_total != null
              ? `${snow.trails_open}/${snow.trails_total}`
              : "—"}
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="text-text-muted text-xs">
          {resort.cams.length} cam{resort.cams.length !== 1 ? "s" : ""}
        </span>
        <a href={resortHref} className="text-cyan text-xs font-semibold hover:underline transition-colors duration-220 cursor-pointer">
          View Resort &rarr;
        </a>
      </div>
    </div>
  );
}
