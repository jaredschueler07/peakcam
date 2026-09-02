import { type ReactNode } from "react";
import { type ConditionRating } from "@/lib/types";
import { RATING_CHIP_CLASS, RATING_DOT_CLASS } from "@/lib/theme-tokens";

// ── Condition chip (pc-chip) ──────────────────────────────────
// great: forest + cream, good: moss + cream, fair: mustard + ink, poor: alpen-dk + cream
// Palette in lib/theme-tokens.ts — shared with the map popup, sheet, compare
// table, browse card and dashboard widget, which all used to keep copies.

interface ConditionBadgeProps {
  rating: ConditionRating;
  label: string;
  size?: "sm" | "md";
}

export function ConditionBadge({ rating, label, size = "md" }: ConditionBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full
        font-bold tracking-[0.08em] uppercase
        border
        ${size === "sm" ? "px-2 py-0.5 text-[10.5px]" : "px-2.5 py-1 text-[11.5px]"}
        ${RATING_CHIP_CLASS[rating]}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${RATING_DOT_CLASS[rating]}`} />
      {label}
    </span>
  );
}

// ── Generic state chip (pc-chip--state) ───────────────────────
// Ink bg, cream text, mono font, uppercase
interface StateBadgeProps {
  children: ReactNode;
  className?: string;
}

export function StateBadge({ children, className = "" }: StateBadgeProps) {
  return (
    <span
      className={`inline-block text-[10.5px] font-bold px-2 py-0.5
        rounded-full bg-ink text-cream-50 font-mono uppercase
        tracking-[0.1em]
        ${className}`}
    >
      {children}
    </span>
  );
}

// ── Embed type pill ───────────────────────────────────────────
type EmbedType = "youtube" | "iframe" | "link";

const embedLabel: Record<EmbedType, string> = {
  youtube: "▶ YouTube",
  iframe:  "⊞ Embed",
  link:    "↗ Link",
};

export function EmbedTypePill({ type }: { type: EmbedType }) {
  return (
    <span className="absolute bottom-2 right-2 bg-ink/80 backdrop-blur-sm
      text-cream-50 text-[10px] font-bold px-2 py-0.5 rounded-full
      uppercase tracking-wider">
      {embedLabel[type]}
    </span>
  );
}
