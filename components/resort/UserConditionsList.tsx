"use client";

import {
  CloudSnow,
  CheckCircle2,
  IceCream,
  Droplets,
  Sun,
  CloudFog,
  EyeOff,
  Wind,
  WindArrowDown,
  Tornado,
  Navigation,
  Check,
  Mountain,
  Zap,
  Split,
  Layers
} from "lucide-react";
import type { UserCondition, UserSnowQuality } from "@/lib/types";
import { useForecastTime } from "@/lib/use-forecast-time";
import { formatUtcDate, timeAgo } from "@/lib/format-date";

// ── Label maps ───────────────────────────────────────────────

// Keys must match `UserSnowQuality` (lib/types.ts), the form's options
// (UserConditionsForm) and the prod CHECK constraint
// (powder/packed/crud/ice/spring — see supabase/migrations/019). The old
// icy/slush keys never matched a submitted value, so reports rendered
// without a snow-quality label.
const snowLabels: Record<UserSnowQuality, { label: string; icon: any; color: string }> = {
  powder:  { label: "Powder",  icon: CloudSnow,    color: "text-powder" },
  packed:  { label: "Packed",  icon: CheckCircle2, color: "text-cyan" },
  crud:    { label: "Crud",    icon: Layers,       color: "text-fair" },
  ice:     { label: "Ice",     icon: IceCream,     color: "text-good" },
  spring:  { label: "Spring",  icon: Droplets,     color: "text-fair" },
};

const visibilityLabels: Record<string, { label: string; icon: any }> = {
  clear:    { label: "Clear",    icon: Sun },
  foggy:    { label: "Foggy",    icon: CloudFog },
  whiteout: { label: "Whiteout", icon: EyeOff },
};

const windLabels: Record<string, { label: string; icon: any }> = {
  calm:   { label: "Calm",   icon: Navigation },
  breezy: { label: "Breezy", icon: Wind },
  gusty:  { label: "Gusty",  icon: WindArrowDown },
  high:   { label: "High",   icon: Tornado },
};

const trailLabels: Record<string, { label: string; icon: any }> = {
  groomed:   { label: "Groomed",    icon: Check },
  ungroomed: { label: "Ungroomed",  icon: Mountain },
  moguls:    { label: "Moguls",     icon: Zap },
  variable:  { label: "Variable",   icon: Split },
};

// ── Component ────────────────────────────────────────────────

interface Props {
  conditions: UserCondition[];
}

export function UserConditionsList({ conditions }: Props) {
  // Hydration-safe relative times: this list is server-rendered inside the
  // ISR'd resort page, so "5m ago" computed from Date.now() at render time
  // differed between the cached HTML and the browser (React #418). The shared
  // clock is null during SSR/hydration → render the UTC date, then upgrade
  // to a live "Xm ago" that also ticks every 30s.
  const nowMs = useForecastTime();

  if (conditions.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-xl p-6 text-center text-text-muted text-sm">
        No recent reports. Be the first to submit conditions for today!
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {conditions.map((c) => {
        const snow = snowLabels[c.snow_quality];
        const vis = visibilityLabels[c.visibility];
        const wind = windLabels[c.wind];
        const trail = trailLabels[c.trail_conditions];

        const SnowIcon = snow?.icon;
        const VisIcon = vis?.icon;
        const WindIcon = wind?.icon;
        const TrailIcon = trail?.icon;

        return (
          <div
            key={c.id}
            className="bg-surface border border-border rounded-xl p-4"
          >
            {/* Top row: snow quality + time */}
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                {SnowIcon && <SnowIcon size={18} className={snow?.color} />}
                <span className={`text-sm font-semibold ${snow?.color ?? "text-text-base"}`}>
                  {snow?.label}
                </span>
              </div>
              <time dateTime={c.created_at} className="text-text-muted text-[11px] shrink-0">
                {nowMs === null ? formatUtcDate(c.created_at) : timeAgo(c.created_at, nowMs)}
              </time>
            </div>

            {/* Condition pills */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              <span className="inline-flex items-center gap-1.5 text-xs bg-surface2 border border-border
                rounded-full px-2.5 py-1 text-text-subtle">
                {VisIcon && <VisIcon size={13} />}
                {vis?.label}
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs bg-surface2 border border-border
                rounded-full px-2.5 py-1 text-text-subtle">
                {WindIcon && <WindIcon size={13} />}
                {wind?.label} wind
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs bg-surface2 border border-border
                rounded-full px-2.5 py-1 text-text-subtle">
                {TrailIcon && <TrailIcon size={13} />}
                {trail?.label}
              </span>
            </div>

            {/* Notes */}
            {c.notes && (
              <p className="text-text-subtle text-xs leading-relaxed italic border-t border-border pt-2 mt-2">
                &ldquo;{c.notes}&rdquo;
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
