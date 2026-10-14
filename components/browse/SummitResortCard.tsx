"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { Camera, ArrowLeftRight, TrendingUp, TrendingDown, Minus, Snowflake, Sun, Thermometer, Heart } from "lucide-react";
import type { ResortWithData, ConditionRating, SnowTrend, SnowOutlook } from "@/lib/types";
import { trackResortCardClick } from "@/lib/posthog";

// ── Animated count-up number ─────────────────────────────────────────────────

function AnimatedNumber({ value }: { value: number }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const duration = 600;
    const steps = 30;
    const increment = value / steps;
    let current = 0;

    const timer = setInterval(() => {
      current += increment;
      if (current >= value) {
        setCount(value);
        clearInterval(timer);
      } else {
        setCount(Math.floor(current));
      }
    }, duration / steps);

    return () => clearInterval(timer);
  }, [value]);

  return <>{count}</>;
}

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
  stable:  { icon: Minus,        color: "#7a5a3a", label: "Stable"  },
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
  stable:     { icon: Minus,      color: "#7a5a3a", label: "Stable"    },
  warming:    { icon: Sun,        color: "#e2a740", label: "Warming"   },
  melt_risk:  { icon: Thermometer,color: "#a93f20", label: "Melt risk" },
};

// ── SummitResortCard (pc-cam-tile) ───────────────────────────────────────────

interface Props {
  resort: ResortWithData;
  favorited?: boolean;
  onToggleFavorite?: () => void;
}

export function SummitResortCard({ resort, favorited, onToggleFavorite }: Props) {
  const snow = resort.snow_report;
  const baseDepth = snow?.base_depth ?? 0;
  const snow24h = snow?.new_snow_24h ?? 0;
  const snow48h = snow?.new_snow_48h ?? 0;
  const trailsOpen = snow?.trails_open;
  const trailsTotal = snow?.trails_total;
  const camCount = resort.cams.filter((c) => c.is_active).length;
  const isFresh = snow24h >= 8;
  const cond = resort.cond_rating ? conditionColors[resort.cond_rating] : null;
  const pctNormal = snow?.pct_of_normal;
  const trend = snow?.trend_7d as SnowTrend | null;
  const outlook = snow?.outlook as SnowOutlook | null;
  const isSnowing = snow?.snowing_now ?? false;

  return (
    <motion.div
      className="group relative rounded-[18px] cursor-pointer"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      whileHover={{ y: -4, x: -1 }}
      transition={{ duration: 0.15 }}
    >
      {/* Card paper — cream-50 bg, ink border, stamp shadow */}
      <div className="relative bg-cream-50 border-[1.5px] border-ink rounded-[18px]
        shadow-stamp group-hover:shadow-stamp-hover transition-shadow duration-150
        overflow-hidden">

        {/* Fresh snow ribbon */}
        {isFresh && (
          <div className="absolute top-4 right-4 z-10 px-3 py-1 bg-alpen text-cream-50
            border-[1.5px] border-alpen-dk rounded-full shadow-[2px_2px_0_#2a1f14]
            font-mono font-bold text-[10.5px] tracking-[0.14em] uppercase flex items-center gap-1">
            <Snowflake size={11} strokeWidth={2.5} /> Fresh
          </div>
        )}

        {/* Snowing now badge */}
        {isSnowing && !isFresh && (
          <div className="absolute top-4 right-4 z-10 px-3 py-1 bg-ink text-cream-50
            border-[1.5px] border-ink rounded-full font-mono font-bold text-[10.5px]
            tracking-[0.14em] uppercase flex items-center gap-1">
            <Snowflake size={11} strokeWidth={2.5} /> Snowing
          </div>
        )}

        {/* Main card link */}
        <Link
          href={`/resorts/${resort.slug}`}
          className="block p-6"
          onClick={() => trackResortCardClick(resort.name, resort.slug)}
        >
          <div className="relative space-y-5">
            {/* Eyebrow: state / region */}
            <div className="flex items-center gap-2 font-mono font-bold text-[10.5px] text-bark uppercase tracking-[0.14em]">
              <span className="px-2 py-0.5 bg-ink text-cream-50 rounded-full">
                {resort.state}
              </span>
              <span className="text-bark">{resort.region}</span>
            </div>

            {/* Resort name — Fraunces 900, tight */}
            <h3 className="font-display font-black text-[28px] leading-[0.95] tracking-[-0.02em] text-ink">
              {resort.name}
            </h3>

            {/* Giant base depth stat — centered poster-style */}
            <div className="text-center py-4">
              <div
                className="font-display font-black text-[6.5rem] leading-none text-ink tracking-[-0.04em] group-hover:scale-[1.03] transition-transform duration-200"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {baseDepth > 0 ? (
                  <>
                    <AnimatedNumber value={baseDepth} />
                    <span className="text-alpen">&quot;</span>
                  </>
                ) : (
                  <span className="text-bark/60 text-6xl">&mdash;</span>
                )}
              </div>
              <div className="font-mono font-bold text-[10.5px] text-bark tracking-[0.18em] uppercase mt-1">
                Base Depth
              </div>
            </div>

            {/* Data strip — dashed bark rule top/bottom, mono numbers */}
            <div className="grid grid-cols-3 gap-4 py-4 border-t border-b border-dashed border-bark/60">
              <div className="text-center">
                <div className="font-mono font-bold text-xl text-ink tabular-nums">{snow24h}&quot;</div>
                <div className="font-mono text-[10px] text-bark uppercase tracking-widest mt-0.5">24H</div>
              </div>
              <div className="text-center border-x border-dashed border-bark/60">
                <div className="font-mono font-bold text-xl text-ink tabular-nums">{snow48h}&quot;</div>
                <div className="font-mono text-[10px] text-bark uppercase tracking-widest mt-0.5">48H</div>
              </div>
              <div className="text-center">
                <div className="font-mono font-bold text-xl text-ink tabular-nums">
                  {trailsOpen != null && trailsTotal != null
                    ? `${trailsOpen}/${trailsTotal}`
                    : "\u2014"}
                </div>
                <div className="font-mono text-[10px] text-bark uppercase tracking-widest mt-0.5">Runs</div>
              </div>
            </div>

            {/* Footer: condition chip + trend + cameras + favorite */}
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-2">
                {cond ? (
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
                      border font-bold text-[11.5px] tracking-[0.08em] uppercase
                      ${cond.bg} ${cond.text} ${cond.border}`}
                  >
                    {cond.label}
                  </span>
                ) : (
                  <span className="text-bark/70 text-xs">&mdash;</span>
                )}
                {trend && <TrendBadge trend={trend} />}
                {pctNormal != null && (
                  <span className={`font-mono font-bold text-[11px] tabular-nums ${pctNormal >= 110 ? "text-forest" : pctNormal >= 90 ? "text-bark-dk" : pctNormal >= 70 ? "text-mustard" : "text-alpen-dk"}`}>
                    {pctNormal}%
                  </span>
                )}
                {outlook && outlook !== "stable" && (
                  <span title={outlookConfig[outlook].label} style={{ color: outlookConfig[outlook].color }} role="img" aria-label={outlookConfig[outlook].label}>
                    {(() => { const Icon = outlookConfig[outlook].icon; return <Icon size={13} strokeWidth={2.5} />; })()}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 text-bark-dk" role="img" aria-label={`${camCount} webcam${camCount !== 1 ? 's' : ''} available`}>
                  <Camera size={14} strokeWidth={2.3} />
                  <span className="font-mono font-bold text-[13px] tabular-nums">{camCount}</span>
                </div>
                {onToggleFavorite && (
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleFavorite(); }}
                    className={`p-1.5 rounded-full border-[1.5px] transition-all duration-100 ${
                      favorited
                        ? "bg-alpen/15 border-alpen text-alpen shadow-[2px_2px_0_#2a1f14]"
                        : "bg-cream-50 border-ink/30 text-bark hover:text-alpen hover:border-ink hover:shadow-[2px_2px_0_#2a1f14]"
                    }`}
                    aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
                  >
                    <Heart size={13} fill={favorited ? "currentColor" : "none"} strokeWidth={favorited ? 0 : 2.2} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </Link>

        {/* Ghost compare button — separate link outside main card link */}
        <div className="px-6 pb-5 pt-0">
          <Link
            href={`/compare?resorts=${resort.slug}`}
            className="flex items-center justify-center gap-1.5 w-full py-2 rounded-full
              border-[1.5px] border-ink/20 text-bark hover:text-ink hover:border-ink
              hover:bg-ink/5 transition-colors duration-150
              text-[12px] font-bold tracking-wide uppercase"
          >
            <ArrowLeftRight size={12} strokeWidth={2.5} />
            Compare
          </Link>
        </div>

      </div>
    </motion.div>
  );
}
