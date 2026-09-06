"use client";

import { useForecastTime } from "@/lib/use-forecast-time";
import { hasFreshSnowForecast } from "@/lib/snow-forecast";
import { useCallback, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { Play, ArrowLeftRight, TrendingUp, TrendingDown, Minus, Snowflake, Sun, Thermometer, Heart } from "lucide-react";
import dynamic from "next/dynamic";
import { availableCameras } from "@/lib/cam-preview";
import { CardCameraPreview } from "./CardCameraPreview";
import type { ResortWithData, ConditionRating, SnowTrend, SnowOutlook } from "@/lib/types";
import { isOffSeason, OFF_SEASON_COLOR } from "@/lib/map-utils";
import { trackResortCardClick } from "@/lib/posthog";

const CamLightbox = dynamic(() => import("@/components/cam/CamLightbox").then(module => module.CamLightbox), { ssr: false });

// ── Condition palette (earth tones) ──────────────────────────────────────────

const conditionColors: Record<ConditionRating, { bg: string; text: string; border: string; label: string }> = {
  great: { bg: "bg-great",  text: "text-cream-50", border: "border-forest-dk", label: "GREAT" },
  good:  { bg: "bg-good",   text: "text-cream-50", border: "border-forest-dk", label: "GOOD"  },
  fair:  { bg: "bg-fair",   text: "text-ink",      border: "border-bark-dk",   label: "FAIR"  },
  poor:  { bg: "bg-poor",   text: "text-cream-50", border: "border-bark-dk",   label: "POOR"  },
};

// ── Trend indicator ──────────────────────────────────────────────────────────

const trendConfig: Record<SnowTrend, { icon: typeof TrendingUp; color: string; label: string }> = {
  rising:  { icon: TrendingUp,   color: "#3c5a3a", label: "Rising"  },
  stable:  { icon: Minus,        color: "#63482d", label: "Stable"  },
  falling: { icon: TrendingDown, color: "#a93f20", label: "Falling" },
};

function TrendBadge({ trend }: { trend: SnowTrend }) {
  const cfg = trendConfig[trend];
  const Icon = cfg.icon;
  return (
    <span className="inline-flex items-center gap-0.5" style={{ color: cfg.color }} title={`7-day trend: ${cfg.label}`} role="img" aria-label={`7-day trend: ${cfg.label}`}>
      <Icon size={13} strokeWidth={2.5} />
    </span>
  );
}

// ── Outlook indicator ────────────────────────────────────────────────────────

const outlookConfig: Record<SnowOutlook, { icon: typeof Snowflake; color: string; label: string }> = {
  more_snow:  { icon: Snowflake,  color: "#3c5a3a", label: "More snow" },
  stable:     { icon: Minus,      color: "#63482d", label: "Stable"    },
  warming:    { icon: Sun,        color: "#e2a740", label: "Warming"   },
  melt_risk:  { icon: Thermometer,color: "#a93f20", label: "Melt risk" },
};

// ── SummitResortCard (pc-cam-tile) ───────────────────────────────────────────

interface Props {
  resort: ResortWithData;
  favorited?: boolean;
  onToggleFavorite?: () => void;
  /**
   * Entrance animation. Only the first screenful of cards should
   * animate — with all 148 on, every card mounts an IntersectionObserver and fast scrolls can hit blank not-yet-revealed patches.
   */
  animate?: boolean;
}

export function SummitResortCard({ resort, favorited, onToggleFavorite, animate = true }: Props) {
  const reducedMotion = useReducedMotion();
  const entrance = animate && !reducedMotion;
  const snow = resort.snow_report;
  const forecastTime = useForecastTime();
  const baseDepth = snow?.base_depth ?? 0;
  const snow24h = snow?.new_snow_24h ?? 0;
  const snow48h = snow?.new_snow_48h ?? 0;
  const trailsOpen = snow?.trails_open;
  const trailsTotal = snow?.trails_total;
  const cams = availableCameras(resort.cams);
  const [cameraIndex, setCameraIndex] = useState<number | null>(null);
  const closeCamera = useCallback(() => setCameraIndex(null), []);
  const openCamera = (id?: string) => { if (cams.length) setCameraIndex(Math.max(0, cams.findIndex(cam => cam.id === id))); };
  const isFresh = snow24h >= 8;
  const cond = resort.cond_rating ? conditionColors[resort.cond_rating] : null;
  const pctNormal = snow?.pct_of_normal;
  const trend = snow?.trend_7d as SnowTrend | null;
  const outlook = snow?.outlook as SnowOutlook | null;
  // Off-season (display heuristic, matches the map): the rating engine's
  // "poor" is meaningless in the local summer — show a neutral chip instead,
  // and suppress the snowing badge. Lazy-initialized so the impure new Date()
  // runs once per mount, not on every hover-triggered grid re-render.
  const [offSeason] = useState(() => isOffSeason(resort.lat, new Date()));
  const hasSnowForecast = hasFreshSnowForecast(snow, forecastTime ?? NaN) && !offSeason;

  return (
    <motion.div
      data-testid="resort-card" data-resort-slug={resort.slug}
      className="group relative rounded-[18px] "
      initial={entrance ? { opacity: 0, y: 20 } : false}
      whileInView={entrance ? { opacity: 1, y: 0 } : undefined}
      viewport={{ once: true }}
      whileHover={reducedMotion ? undefined : { y: -4, x: -1 }}
      transition={{ duration: 0.15 }}
    >
      {/* Card paper — cream-50 bg, ink border, stamp shadow */}
      <div className="relative bg-cream-50 border-[1.5px] border-ink rounded-[18px]
        shadow-stamp group-hover:shadow-stamp-hover transition-shadow duration-150
        overflow-hidden">

        <CardCameraPreview key={cams.map(cam => `${cam.id}:${cam.embed_url}:${cam.youtube_id}`).join("|")} cams={cams} resortName={resort.name} onOpen={openCamera} />
        {onToggleFavorite && <button type="button" onClick={event => { event.currentTarget.focus(); onToggleFavorite(); }}
          aria-label={favorited ? `Remove ${resort.name} from favorites` : `Add ${resort.name} to favorites`}
          aria-pressed={Boolean(favorited)}
          className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full border border-ink bg-cream-50 text-ink shadow-stamp-sm focus-visible:ring-2 focus-visible:ring-alpen">
          <Heart size={17} className={favorited ? "text-alpen" : ""} fill={favorited ? "currentColor" : "none"} aria-hidden />
        </button>}

        {/* Main card link */}
        <Link
          href={`/resorts/${resort.slug}`}
          className="block px-5 pt-5 pb-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-alpen"
          onClick={() => trackResortCardClick(resort.name, resort.slug)}
        >
          <div className="relative space-y-3">
            {/* Eyebrow: state / region */}
            <div className="flex items-center gap-2 font-mono font-bold text-[10.5px] text-bark uppercase tracking-[0.14em]">
              <span className="px-2 py-0.5 bg-ink text-cream-50 rounded-full">
                {resort.state}
              </span>
              <span className="text-bark">{resort.region}</span>
            </div>

            {/* Resort name — Fraunces 900, tight */}
            <h3 className="font-display font-black text-[28px] leading-[0.95] tracking-[-0.02em] text-ink [overflow-wrap:anywhere]">
              {resort.name}
            </h3>

            {(isFresh || hasSnowForecast) && <span className="inline-flex items-center gap-1 rounded-full border border-alpen-dk bg-alpen-dk px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wide text-white"><Snowflake size={11} aria-hidden />{isFresh ? "Fresh snow" : "Snow forecast"}</span>}

            {/* Data strip — dashed bark rule top/bottom, mono numbers */}
            <div className="grid grid-cols-4 gap-2 py-3 border-t border-b border-dashed border-bark/60">
              <div className="text-center">
                <div className="font-mono font-bold text-lg text-ink tabular-nums">{snow?.base_depth != null ? `${baseDepth}″` : "—"}</div>
                <div className="font-mono text-[10px] text-bark uppercase tracking-widest mt-0.5">Base</div>
              </div>
              <div className="text-center">
                <div className="font-mono font-bold text-lg text-ink tabular-nums">{snow?.new_snow_24h != null ? `${snow24h}″` : "—"}</div>
                <div className="font-mono text-[10px] text-bark uppercase tracking-widest mt-0.5">24H</div>
              </div>
              <div className="text-center">
                <div className="font-mono font-bold text-lg text-ink tabular-nums">{snow?.new_snow_48h != null ? `${snow48h}″` : "—"}</div>
                <div className="font-mono text-[10px] text-bark uppercase tracking-widest mt-0.5">48H</div>
              </div>
              <div className="text-center">
                <div className="font-mono font-bold text-lg text-ink tabular-nums">
                  {trailsOpen != null && trailsTotal != null
                    ? `${trailsOpen}/${trailsTotal}`
                    : "\u2014"}
                </div>
                <div className="font-mono text-[10px] text-bark uppercase tracking-widest mt-0.5">Runs</div>
              </div>
            </div>

            {/* Condition chip and outlook */}
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-2">
                {offSeason ? (
                  /* border matches MapPopupCard/MapBottomSheet's off-season chip */
                  <span
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
                      border-[1.5px] border-ink font-bold text-[11.5px] tracking-[0.08em] uppercase text-ink"
                    style={{ backgroundColor: OFF_SEASON_COLOR }}
                  >
                    Off-season
                  </span>
                ) : cond ? (
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
                      border font-bold text-[11.5px] tracking-[0.08em] uppercase
                      ${cond.bg} ${cond.text} ${cond.border}`}
                  >
                    {cond.label}
                  </span>
                ) : (
                  <span className="text-bark text-xs">&mdash;</span>
                )}
                {trend && <TrendBadge trend={trend} />}
                {/* mustard-dk, not mustard: raw mustard is 1.74:1 on the cream
                    card — unreadable for an 11px readout. */}
                {pctNormal != null && (
                  <span className={`font-mono font-bold text-[11px] tabular-nums ${pctNormal >= 110 ? "text-forest" : pctNormal >= 90 ? "text-bark-dk" : pctNormal >= 70 ? "text-mustard-dk" : "text-alpen-dk"}`}>
                    {pctNormal}%
                  </span>
                )}
                {outlook && outlook !== "stable" && (
                  <span title={outlookConfig[outlook].label} style={{ color: outlookConfig[outlook].color }} role="img" aria-label={outlookConfig[outlook].label}>
                    {(() => { const Icon = outlookConfig[outlook].icon; return <Icon size={13} strokeWidth={2.5} />; })()}
                  </span>
                )}
              </div>
            </div>
          </div>
        </Link>

        {/* Ghost compare button — separate link outside main card link */}
        <div className="grid grid-cols-[1fr_auto] gap-2 px-5 pb-5 pt-1">
          <button type="button" disabled={!cams.length} onClick={event => { event.currentTarget.focus(); openCamera(); }}
            className="flex min-h-11 items-center justify-center gap-2 rounded-full border-[1.5px] border-ink bg-alpen-dk px-4 text-sm font-bold text-white shadow-stamp-sm transition-colors hover:bg-ink disabled:bg-cream disabled:text-bark disabled:shadow-none focus-visible:ring-2 focus-visible:ring-alpen">
            <Play size={14} aria-hidden />{cams.length ? "Live look" : "No cameras yet"}
          </button>
          <Link
            href={`/compare?resorts=${resort.slug}`}
            className="flex items-center justify-center gap-1.5 min-h-11 px-3 py-2 rounded-full
              border-[1.5px] border-ink/20 text-bark hover:text-ink hover:border-ink
              hover:bg-ink/5 transition-colors duration-150
              text-[12px] font-bold tracking-wide uppercase"
          >
            <ArrowLeftRight size={12} strokeWidth={2.5} />
            Compare
          </Link>
        </div>

      </div>
      {cameraIndex !== null && cams.length > 0 && <CamLightbox cams={cams} initialIndex={cameraIndex} resortSlug={resort.slug} resortName={resort.name} onClose={closeCamera} />}
    </motion.div>
  );
}
