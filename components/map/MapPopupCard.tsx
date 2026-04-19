"use client";

import type { ResortWithData, ConditionRating } from "@/lib/types";

// Condition chip palette — matches ConditionBadge
const conditionChip: Record<ConditionRating, string> = {
  great: "bg-great text-cream-50 border-forest-dk",
  good:  "bg-good text-cream-50 border-forest-dk",
  fair:  "bg-fair text-ink border-bark-dk",
  poor:  "bg-poor text-cream-50 border-bark-dk",
};

interface MapPopupCardProps {
  resort: ResortWithData;
  onViewResort: (slug: string) => void;
}

// Poster popup — paper bg is applied by the wrapping maplibregl popup CSS in globals.css
export default function MapPopupCard({ resort }: MapPopupCardProps) {
  const snow = resort.snow_report;
  const chipCls = conditionChip[resort.cond_rating] ?? "bg-cream-50 text-ink border-bark";
  const ratingLabel =
    resort.cond_rating.charAt(0).toUpperCase() + resort.cond_rating.slice(1);

  const resortHref = `/resorts/${resort.slug}`;

  return (
    <div className="min-w-[240px] cursor-default">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h3 className="font-display font-black text-ink text-[17px] leading-[1.05] tracking-[-0.01em]">
            <a href={resortHref} className="hover:text-alpen transition-colors">
              {resort.name}
            </a>
          </h3>
          <p className="font-mono text-bark text-[10.5px] uppercase tracking-[0.12em] mt-0.5">
            {resort.region} · {resort.state}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border-[1.5px] px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em] leading-tight ${chipCls}`}
        >
          {ratingLabel}
        </span>
      </div>

      {/* Snow stats — dashed bark rule strip */}
      <div className="grid grid-cols-3 gap-2 py-2 border-t-[1.5px] border-b-[1.5px] border-dashed border-bark/60 mb-3">
        <div className="text-center">
          <p className="font-display font-black text-ink text-xl leading-none tabular-nums">
            {snow?.base_depth != null ? `${snow.base_depth}"` : "—"}
          </p>
          <p className="pc-eyebrow mt-1" style={{ fontSize: 9.5 }}>Base</p>
        </div>
        <div className="text-center">
          <p className="font-display font-black text-alpen text-xl leading-none tabular-nums">
            {snow?.new_snow_24h != null ? `${snow.new_snow_24h}"` : "—"}
          </p>
          <p className="pc-eyebrow mt-1" style={{ fontSize: 9.5 }}>24h</p>
        </div>
        <div className="text-center">
          <p className="font-display font-black text-ink text-xl leading-none tabular-nums">
            {snow?.trails_open != null && snow?.trails_total != null
              ? `${snow.trails_open}/${snow.trails_total}`
              : "—"}
          </p>
          <p className="pc-eyebrow mt-1" style={{ fontSize: 9.5 }}>Trails</p>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="font-mono text-bark text-[11px] uppercase tracking-[0.1em]">
          {resort.cams.length} cam{resort.cams.length !== 1 ? "s" : ""}
        </span>
        <a
          href={resortHref}
          className="text-alpen-dk text-[12px] font-bold hover:text-alpen transition-colors uppercase tracking-[0.06em] cursor-pointer"
        >
          View resort &rarr;
        </a>
      </div>
    </div>
  );
}
