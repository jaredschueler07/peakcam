"use client";

import type { UserCondition } from "@/lib/types";

// ── Label maps ───────────────────────────────────────────────

const snowLabels: Record<string, { label: string; icon: string; color: string }> = {
  powder:  { label: "Powder",  icon: "🤩", color: "text-powder" },
  packed:  { label: "Packed",  icon: "👍", color: "text-cyan" },
  icy:     { label: "Icy",     icon: "🧊", color: "text-good" },
  slush:   { label: "Slush",   icon: "💧", color: "text-fair" },
};

const visibilityLabels: Record<string, { label: string; icon: string }> = {
  clear:    { label: "Clear",    icon: "☀️" },
  foggy:    { label: "Foggy",    icon: "🌫️" },
  whiteout: { label: "Whiteout", icon: "🫥" },
};

const windLabels: Record<string, { label: string; icon: string }> = {
  calm:   { label: "Calm",   icon: "🍃" },
  breezy: { label: "Breezy", icon: "💨" },
  gusty:  { label: "Gusty",  icon: "🌬️" },
  high:   { label: "High",   icon: "⛔" },
};

const trailLabels: Record<string, { label: string; icon: string }> = {
  groomed:   { label: "Groomed",    icon: "✅" },
  ungroomed: { label: "Ungroomed",  icon: "🎿" },
  moguls:    { label: "Moguls",     icon: "⛰️" },
  variable:  { label: "Variable",   icon: "🔀" },
};

// ── Helpers ──────────────────────────────────────────────────

function timeAgo(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return `${Math.floor(diffHrs / 24)}d ago`;
}

// ── Component ────────────────────────────────────────────────

interface Props {
  conditions: UserCondition[];
}

export function UserConditionsList({ conditions }: Props) {
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

        return (
          <div
            key={c.id}
            className="bg-surface border border-border rounded-xl p-4"
          >
            {/* Top row: snow quality + time */}
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg leading-none">{snow?.icon}</span>
                <span className={`text-sm font-semibold ${snow?.color ?? "text-text-base"}`}>
                  {snow?.label}
                </span>
              </div>
              <span className="text-text-muted text-[11px] shrink-0">{timeAgo(c.submitted_at)}</span>
            </div>

            {/* Condition pills */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              <span className="inline-flex items-center gap-1 text-xs bg-surface2 border border-border
                rounded-full px-2.5 py-1 text-text-subtle">
                {vis?.icon} {vis?.label}
              </span>
              <span className="inline-flex items-center gap-1 text-xs bg-surface2 border border-border
                rounded-full px-2.5 py-1 text-text-subtle">
                {wind?.icon} {wind?.label} wind
              </span>
              <span className="inline-flex items-center gap-1 text-xs bg-surface2 border border-border
                rounded-full px-2.5 py-1 text-text-subtle">
                {trail?.icon} {trail?.label}
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
