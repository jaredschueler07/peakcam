"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { Camera, ArrowLeftRight, TrendingUp, TrendingDown, Minus, Snowflake, Sun, Thermometer, Heart } from "lucide-react";
import type { ResortWithData, ConditionRating, SnowTrend, SnowOutlook } from "@/lib/types";
import { trackResortCardClick } from "@/lib/posthog";
import { FavoriteButton } from "../ui/FavoriteButton";

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

// ── Region gradient map ──────────────────────────────────────────────────────

const regionGradients: Record<string, string> = {
  "Wasatch":       "linear-gradient(135deg, rgba(15, 35, 58, 0.9), rgba(12, 26, 45, 0.95))",
  "Tetons":        "linear-gradient(135deg, rgba(13, 31, 53, 0.9), rgba(10, 22, 40, 0.95))",
  "Front Range":   "linear-gradient(135deg, rgba(13, 29, 47, 0.9), rgba(10, 21, 36, 0.95))",
  "San Juan":      "linear-gradient(135deg, rgba(12, 27, 45, 0.9), rgba(9, 19, 34, 0.95))",
  "Sierra Nevada": "linear-gradient(135deg, rgba(12, 28, 48, 0.9), rgba(10, 20, 38, 0.95))",
  "Cascades":      "linear-gradient(135deg, rgba(10, 25, 42, 0.9), rgba(8, 18, 32, 0.95))",
};
const defaultGradient = "linear-gradient(135deg, rgba(14, 24, 37, 0.9), rgba(8, 13, 20, 0.95))";

// ── Condition colors ─────────────────────────────────────────────────────────

const conditionColors: Record<ConditionRating, string> = {
  great: "#2ECC8F",
  good:  "#60C8FF",
  fair:  "#8AA3BE",
  poor:  "#f87171",
};

// ── Trend indicator ──────────────────────────────────────────────────────────

const trendConfig: Record<SnowTrend, { icon: typeof TrendingUp; color: string; label: string }> = {
  rising:  { icon: TrendingUp, color: "#2ECC8F", label: "Rising" },
  stable:  { icon: Minus, color: "#8AA3BE", label: "Stable" },
  falling: { icon: TrendingDown, color: "#f87171", label: "Falling" },
};

function TrendBadge({ trend }: { trend: SnowTrend }) {
  const cfg = trendConfig[trend];
  const Icon = cfg.icon;
  return (
    <span className="inline-flex items-center gap-0.5" style={{ color: cfg.color }} title={`7-day trend: ${cfg.label}`}>
      <Icon size={12} />
    </span>
  );
}

// ── Outlook indicator ────────────────────────────────────────────────────────

const outlookConfig: Record<SnowOutlook, { icon: typeof Snowflake; color: string; label: string }> = {
  more_snow:  { icon: Snowflake, color: "#60C8FF", label: "More snow" },
  stable:     { icon: Minus, color: "#8AA3BE", label: "Stable" },
  warming:    { icon: Sun, color: "#FBBF24", label: "Warming" },
  melt_risk:  { icon: Thermometer, color: "#f87171", label: "Melt risk" },
};

// ── SummitResortCard ─────────────────────────────────────────────────────────

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
  const gradient = regionGradients[resort.region] ?? defaultGradient;
  const condColor = resort.cond_rating ? conditionColors[resort.cond_rating] : null;
  const condLabel = resort.cond_rating?.toUpperCase() ?? null;
  const pctNormal = snow?.pct_of_normal;
  const trend = snow?.trend_7d as SnowTrend | null;
  const outlook = snow?.outlook as SnowOutlook | null;
  const isSnowing = snow?.snowing_now ?? false;

  return (
    <motion.div
      className="group relative rounded-lg overflow-hidden cursor-pointer"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      whileHover={{ y: -8 }}
      transition={{ duration: 0.2 }}
    >
      <div
        className="noise-overlay relative h-full border border-border hover:border-cyan/50 hover:shadow-glow-ice transition-all duration-300"
        style={{ background: gradient }}
      >
        {/* Alpenglow top border on hover */}
        <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-alpenglow to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        {/* Fresh snow shimmer overlay */}
        {isFresh && (
          <>
            <motion.div
              className="absolute inset-0 bg-gradient-to-br from-transparent via-white/5 to-transparent pointer-events-none"
              animate={{ backgroundPosition: ["0% 0%", "100% 100%"] }}
              transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
              style={{ backgroundSize: "200% 200%" }}
            />
            <div className="absolute top-4 right-4 z-10 px-3 py-1 bg-cyan/20 backdrop-blur-sm border border-cyan/50 rounded-full">
              <span className="text-cyan text-xs font-semibold flex items-center gap-1">
                &#10052; FRESH
              </span>
            </div>
          </>
        )}

        {/* Snowing now badge */}
        {isSnowing && !isFresh && (
          <div className="absolute top-4 right-4 z-10 px-3 py-1 bg-cyan/15 backdrop-blur-sm border border-cyan/40 rounded-full">
            <span className="text-cyan text-xs font-semibold flex items-center gap-1">
              <Snowflake size={12} /> SNOWING
            </span>
          </div>
        )}

        {/* Main card link */}
        <Link
          href={`/resorts/${resort.slug}`}
          className="block p-6"
          onClick={() => trackResortCardClick(resort.name, resort.slug)}
        >
          <div className="relative space-y-6">
            {/* Giant base depth number */}
            <div className="text-center py-8">
              <div
                className="text-[8rem] leading-none text-text-base group-hover:scale-105 transition-transform duration-300 font-display"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {baseDepth > 0 ? (
                  <>
                    <AnimatedNumber value={baseDepth} />&quot;
                  </>
                ) : (
                  <span className="text-text-muted text-6xl">&mdash;</span>
                )}
              </div>
              <div className="text-text-muted text-xs uppercase tracking-widest mt-2">
                BASE DEPTH
              </div>
            </div>

            {/* Resort info */}
            <div className="space-y-2">
              <h3 className="text-2xl text-text-base font-semibold">{resort.name}</h3>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-text-base/10 border border-text-base/20 rounded text-text-subtle text-xs">
                  {resort.state}
                </span>
                <span className="text-text-muted text-sm">{resort.region}</span>
              </div>
            </div>

            {/* Data strip */}
            <div className="grid grid-cols-3 gap-4 pt-4 border-t border-border">
              <div className="text-center">
                <div className="text-text-base font-mono text-lg">{snow24h}&quot;</div>
                <div className="text-text-muted text-xs uppercase">24h</div>
              </div>
              <div className="text-center">
                <div className="text-text-base font-mono text-lg">{snow48h}&quot;</div>
                <div className="text-text-muted text-xs uppercase">48h</div>
              </div>
              <div className="text-center">
                <div className="text-text-base font-mono text-lg">
                  {trailsOpen != null && trailsTotal != null
                    ? `${trailsOpen}/${trailsTotal}`
                    : "\u2014"}
                </div>
                <div className="text-text-muted text-xs uppercase">Runs</div>
              </div>
            </div>

            {/* Condition, trend, % normal, cameras */}
            <div className="flex items-center justify-between pt-4 border-t border-border">
              <div className="flex items-center gap-2">
                {condColor && condLabel ? (
                  <div
                    className="px-3 py-1 rounded text-sm font-semibold"
                    style={{
                      backgroundColor: `${condColor}20`,
                      color: condColor,
                      border: `1px solid ${condColor}40`,
                    }}
                  >
                    {condLabel}
                  </div>
                ) : (
                  <span className="text-text-muted text-xs">&mdash;</span>
                )}
                {trend && <TrendBadge trend={trend} />}
                {pctNormal != null && (
                  <span className={`text-xs font-mono ${pctNormal >= 110 ? "text-[#2ECC8F]" : pctNormal >= 90 ? "text-text-subtle" : pctNormal >= 70 ? "text-yellow-400" : "text-red-400"}`}>
                    {pctNormal}%
                  </span>
                )}
                {outlook && outlook !== "stable" && (
                  <span title={outlookConfig[outlook].label} style={{ color: outlookConfig[outlook].color }}>
                    {(() => { const Icon = outlookConfig[outlook].icon; return <Icon size={12} />; })()}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 text-text-subtle">
                  <Camera size={16} />
                  <span className="text-sm">{camCount}</span>
                </div>
                {onToggleFavorite && (
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleFavorite(); }}
                    className={`p-1.5 rounded-lg border transition-all duration-[220ms] ${
                      favorited
                        ? "bg-alpenglow/15 border-alpenglow/40 text-alpenglow hover:bg-alpenglow/25"
                        : "bg-surface2/50 border-border text-text-muted hover:text-alpenglow hover:border-alpenglow/30 hover:bg-alpenglow/10"
                    }`}
                    aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
                  >
                    <Heart size={14} fill={favorited ? "currentColor" : "none"} strokeWidth={favorited ? 0 : 1.5} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </Link>

        {/* Compare button — separate link outside the main card link */}
        <div className="px-6 pb-5 pt-1">
          <Link
            href={`/compare?resorts=${resort.slug}`}
            className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg border border-border/60 text-text-muted hover:text-cyan hover:border-cyan/40 hover:bg-cyan/5 transition-all duration-200 text-xs font-medium"
          >
            <ArrowLeftRight size={12} />
            Compare
          </Link>
        </div>

        {/* Favorite Button (top right, on top of everything) */}
        <div className="absolute top-3 right-3 z-50">
          <FavoriteButton itemId={resort.id} itemType="resort" />
        </div>
      </div>
    </motion.div>
  );
}
