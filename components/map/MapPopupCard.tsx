"use client";

import type { MouseEvent } from "react";
import type { ResortWithData, ConditionRating } from "@/lib/types";
import { isOffSeason } from "@/lib/map-utils";

// Condition chip palette — matches ConditionBadge
const conditionChip: Record<ConditionRating, string> = {
  great: "bg-great text-cream-50 border-forest-dk",
  good:  "bg-good text-cream-50 border-forest-dk",
  fair:  "bg-fair text-ink border-bark-dk",
  poor:  "bg-poor text-cream-50 border-bark-dk",
};

interface MapPopupCardProps {
  resort: ResortWithData;
  onViewResort?: (slug: string) => void;
}

/** "3h ago" / "just now" from an ISO timestamp; null if unparseable. */
function timeAgo(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// Poster popup — paper bg is applied by the wrapping maplibregl popup CSS in globals.css
export default function MapPopupCard({ resort, onViewResort }: MapPopupCardProps) {
  const snow = resort.snow_report;
  const chipCls = conditionChip[resort.cond_rating] ?? "bg-cream-50 text-ink border-bark";
  const ratingLabel =
    resort.cond_rating.charAt(0).toUpperCase() + resort.cond_rating.slice(1);

  const resortHref = `/resorts/${resort.slug}`;
  const updated = timeAgo(snow?.updated_at);
  const offSeason = isOffSeason(resort.lat, new Date());

  // Prefer SPA navigation when the parent provides it (/map uses next/router);
  // otherwise the anchor's href handles a normal navigation. Let modifier /
  // middle clicks fall through to the browser so "open in new tab/window"
  // still works — only intercept a plain left click.
  const handleNav = (e: MouseEvent<HTMLAnchorElement>) => {
    if (
      onViewResort &&
      e.button === 0 &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.shiftKey &&
      !e.altKey
    ) {
      e.preventDefault();
      onViewResort(resort.slug);
    }
  };

  return (
    <div className="min-w-[240px] cursor-default">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h3 className="font-display font-black text-ink text-[17px] leading-[1.05] tracking-[-0.01em]">
            <a href={resortHref} onClick={handleNav} className="hover:text-alpen transition-colors">
              {resort.name}
            </a>
          </h3>
          <p className="font-mono text-bark text-[10.5px] uppercase tracking-[0.12em] mt-0.5">
            {resort.region} · {resort.state}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {offSeason ? (
            /* Neutral bark pill — matches the off-season map marker; the rating
               engine's "poor" is meaningless in the local summer. */
            <span className="rounded-full border-[1.5px] border-ink bg-[#b59b74] px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em] leading-tight text-ink">
              Off-season
            </span>
          ) : (
            <span
              className={`rounded-full border-[1.5px] px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em] leading-tight ${chipCls}`}
            >
              {ratingLabel}
            </span>
          )}
          {!offSeason && snow?.snowing_now && (
            /* pale "sky/snow" pill, ink text — deliberately NOT a rating hue
               so it never collides with the forest "great" chip above it. */
            <span className="inline-flex items-center gap-1 rounded-full border-[1.5px] border-ink bg-sky px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] leading-tight text-ink">
              <span aria-hidden>❄</span> Snowing
            </span>
          )}
        </div>
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
          {updated && <> · Updated {updated}</>}
        </span>
        <a
          href={resortHref}
          onClick={handleNav}
          className="text-alpen-dk text-[12px] font-bold hover:text-alpen transition-colors uppercase tracking-[0.06em] cursor-pointer"
        >
          View resort &rarr;
        </a>
      </div>
    </div>
  );
}
