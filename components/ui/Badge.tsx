import { type ReactNode } from "react";
import { type ConditionRating } from "@/lib/types";

// ── Condition badge ───────────────────────────────────────────
const conditionStyles: Record<ConditionRating, string> = {
  great: "bg-cyan-dim border border-cyan-400/20 text-cyan-400",
  good:  "bg-blue-950/40 border border-blue-400/20 text-blue-400",
  fair:  "bg-yellow-950/40 border border-yellow-400/20 text-yellow-400",
  poor:  "bg-red-950/40 border border-red-400/20 text-red-400",
};

const conditionDot: Record<ConditionRating, string> = {
  great: "bg-cyan-400",
  good:  "bg-blue-400",
  fair:  "bg-yellow-400",
  poor:  "bg-red-400",
};

interface ConditionBadgeProps {
  rating: ConditionRating;
  label: string;
  size?: "sm" | "md";
}

export function ConditionBadge({ rating, label, size = "md" }: ConditionBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold
        ${size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"}
        ${conditionStyles[rating]}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${conditionDot[rating]}`} />
      {label}
    </span>
  );
}

// ── Generic state badge ───────────────────────────────────────
interface StateBadgeProps {
  children: ReactNode;
  className?: string;
}

export function StateBadge({ children, className = "" }: StateBadgeProps) {
  return (
    <span
      className={`inline-block text-[10.5px] font-semibold px-2 py-0.5
        rounded bg-surface3 border border-border text-text-muted tracking-wide
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
    <span className="absolute bottom-2 right-2 bg-black/60 backdrop-blur-sm
      text-text-muted text-[10px] font-medium px-1.5 py-0.5 rounded">
      {embedLabel[type]}
    </span>
  );
}
