"use client";

import type { ResortWithData } from "@/lib/types";
import { isOffSeason, timeAgo, OFF_SEASON_COLOR } from "@/lib/map-utils";
import { RATING_CHIP_CLASS, ratingLabel } from "@/lib/theme-tokens";
import { formatInches, formatRatio } from "@/lib/format";
import { isDropInResort } from "@/lib/drop-in";
import DropInLink from "@/components/drop-in/DropInLink";
import MapCamPreview from "./MapCamPreview";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";

interface MapBottomSheetProps {
  resort: ResortWithData;
  onClose: () => void;
  onViewResort: (slug: string) => void;
}

// Mobile detail sheet — poster paper card sliding up from the bottom. The
// desktop equivalent is MapPopupCard; this mirrors its content and tokens so
// mobile users get the same on-brand treatment (it used to be legacy dark-theme
// tokens rendering only by the tailwind alias-layer coincidence).
export default function MapBottomSheet({
  resort,
  onClose,
  onViewResort,
}: MapBottomSheetProps) {
  useBodyScrollLock(true);
  const snow = resort.snow_report;
  const camCount = resort.cams.length;
  const chipCls = RATING_CHIP_CLASS[resort.cond_rating] ?? "bg-cream-50 text-ink border-bark";
  const label = ratingLabel(resort.cond_rating);
  const offSeason = isOffSeason(resort.lat, new Date());
  const updated = timeAgo(snow?.updated_at);

  const stats: { label: string; value: string; accent?: boolean }[] = [
    { label: "Base", value: formatInches(snow?.base_depth) },
    { label: "24h", value: formatInches(snow?.new_snow_24h), accent: true },
    { label: "48h", value: formatInches(snow?.new_snow_48h) },
    { label: "Trails", value: formatRatio(snow?.trails_open, snow?.trails_total) },
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-ink/40 lg:hidden"
        onClick={onClose}
      />

      {/* Bottom sheet */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 lg:hidden animate-slide-up"
        role="dialog"
        aria-label={`${resort.name} conditions`}
      >
        <div className="bg-cream-50 border-t-[1.5px] border-ink rounded-t-[18px] px-5 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] max-h-[80dvh] overflow-y-auto shadow-[0_-6px_20px_-8px_rgba(42,31,20,0.35)]">
          {/* Drag handle */}
          <div className="flex justify-center mb-3">
            <div className="w-10 h-1 bg-bark/40 rounded-full" />
          </div>

          {/* Header */}
          <div className="flex items-start justify-between gap-2 mb-4">
            <div className="min-w-0">
              <h3 className="font-display font-black text-ink text-[19px] leading-[1.05] tracking-[-0.01em]">
                {resort.name}
              </h3>
              <p className="font-mono text-bark text-[10.5px] uppercase tracking-[0.12em] mt-0.5">
                {resort.region} · {resort.state}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {offSeason ? (
                <span
                  className="rounded-full border-[1.5px] border-ink px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] leading-tight text-ink"
                  style={{ backgroundColor: OFF_SEASON_COLOR }}
                >
                  Off-season
                </span>
              ) : (
                <span
                  className={`rounded-full border-[1.5px] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] leading-tight ${chipCls}`}
                >
                  {label}
                </span>
              )}
              {!offSeason && snow?.snowing_now && (
                <span className="inline-flex items-center gap-1 rounded-full border-[1.5px] border-ink bg-sky px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] leading-tight text-ink">
                  <span aria-hidden>❄</span> Snowing
                </span>
              )}
            </div>
          </div>

          {/* Snow stats — dashed bark rule strip */}
          <div className="grid grid-cols-4 gap-2 py-3 border-t-[1.5px] border-b-[1.5px] border-dashed border-bark/60 mb-4">
            {stats.map((s) => (
              <div key={s.label} className="text-center">
                <p
                  className={`font-display font-black text-2xl leading-none tabular-nums ${
                    s.accent ? "text-alpen" : "text-ink"
                  }`}
                >
                  {s.value}
                </p>
                <p className="pc-eyebrow mt-1" style={{ fontSize: 9.5 }}>
                  {s.label}
                </p>
              </div>
            ))}
          </div>

          {/* Live cam glance — conditions + map + webcam in one view.
              key: full remount on resort switch — resets the internal `failed`
              state and re-busts the snapshot cache. */}
          <MapCamPreview
            key={resort.id}
            cams={resort.cams}
            resortName={resort.name}
            onClick={() => onViewResort(resort.slug)}
            className="mb-4"
          />

          {/* Drop In — pilot resorts only, above the standard actions so the
              existing View resort / Cams pair keeps its familiar shape. */}
          {isDropInResort(resort.slug) && (
            <DropInLink slug={resort.slug} variant="block" className="mb-3" />
          )}

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => onViewResort(resort.slug)}
              className="flex-1 px-4 py-2.5 min-h-11 rounded-full bg-ink text-cream-50 border-[1.5px] border-ink text-sm font-bold uppercase tracking-[0.06em] shadow-stamp-sm hover:shadow-stamp hover:-translate-x-[1px] hover:-translate-y-[1px] transition-[transform,box-shadow] duration-100"
            >
              View resort
            </button>
            <button
              onClick={() => onViewResort(resort.slug)}
              className="px-4 py-2.5 min-h-11 rounded-full bg-cream-50 text-ink border-[1.5px] border-ink text-sm font-bold uppercase tracking-[0.06em] shadow-stamp-sm hover:shadow-stamp hover:-translate-x-[1px] hover:-translate-y-[1px] transition-[transform,box-shadow] duration-100"
            >
              {camCount} {camCount === 1 ? "Cam" : "Cams"}
            </button>
          </div>

          {updated && (
            <p className="mt-3 text-center font-mono text-bark text-[10.5px] uppercase tracking-[0.1em]">
              Updated {updated}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
