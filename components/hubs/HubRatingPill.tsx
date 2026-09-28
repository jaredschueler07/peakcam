import type { ConditionRating } from "@/lib/types";
import { ConditionBadge } from "@/components/ui/Badge";

const LABELS: Record<ConditionRating, string> = { great: "Great", good: "Good", fair: "Fair", poor: "Poor" };

/** The column is text with a CHECK, not an enum in JS — guard what the DB actually holds. */
function isRating(value: unknown): value is ConditionRating {
  return typeof value === "string" && value in LABELS;
}

/**
 * Condition pill for hub tables and the summary strip. Off-season the rating
 * engine scores every 0″ base as "poor", which on a September page reads as
 * twenty red failures; the map already swaps in a neutral marker for that
 * case (lib/map-utils.ts isOffSeason) and this pill does the same.
 */
export function HubRatingPill({
  rating,
  offSeason,
  size = "sm",
}: {
  rating: ConditionRating | null;
  offSeason: boolean;
  size?: "sm" | "md";
}) {
  if (offSeason) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-bark bg-cream-dk font-bold uppercase tracking-[0.08em] text-ink ${
          size === "sm" ? "px-2 py-0.5 text-[10.5px]" : "px-2.5 py-1 text-[11.5px]"
        }`}
      >
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-bark" />
        Off-season
      </span>
    );
  }
  if (!isRating(rating)) {
    return (
      <span aria-label="No rating yet" className="font-mono text-[13px] text-bark">
        —
      </span>
    );
  }
  return <ConditionBadge rating={rating} label={LABELS[rating]} size={size} />;
}
