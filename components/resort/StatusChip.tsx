// ─────────────────────────────────────────────────────────────
// Operating-status chip (P6): OPEN / CLOSED TODAY / PRE-SEASON / OFF SEASON
// / STATUS UNKNOWN from the conditions contract, in the poster palette.
// Pure presentational, no hooks, so the overview (a client component) and
// the server-rendered subpages share it. The title carries the dated
// sentence so a hover says what the chip rests on.
// ─────────────────────────────────────────────────────────────

import type { ResortStatus } from "@/lib/conditions-contract";
import { STATUS_LABELS } from "@/lib/conditions-contract";

const STYLES: Record<ResortStatus, string> = {
  OPEN: "bg-great text-cream-50 border-forest-dk",
  CLOSED_TODAY: "bg-poor text-cream-50 border-bark-dk",
  PRE_SEASON: "bg-fair text-ink border-bark-dk",
  OFF_SEASON: "bg-ink text-cream-50 border-ink",
  UNKNOWN: "bg-cream-50 text-ink border-ink border-dashed",
};

const DOT: Record<ResortStatus, string> = {
  OPEN: "bg-cream-50",
  CLOSED_TODAY: "bg-cream-50",
  PRE_SEASON: "bg-ink",
  OFF_SEASON: "bg-cream-50",
  UNKNOWN: "bg-bark",
};

export interface StatusChipProps {
  status: ResortStatus;
  /** The contract's dated sentence; rendered as the title and for screen readers. */
  sentence?: string;
  /** Where the status rests (`operator`, `profile`, `none`), shown as a suffix when not an operator source. */
  source?: string;
  size?: "sm" | "md";
}

export function StatusChip({ status, sentence, source, size = "md" }: StatusChipProps) {
  const suffix = source === "profile" ? " (projected)" : "";
  return (
    <span
      data-testid="resort-status"
      data-status={status}
      title={sentence}
      className={`inline-flex items-center gap-1.5 rounded-full border font-mono font-bold uppercase tracking-[0.1em] ${
        size === "sm" ? "px-2 py-0.5 text-[10.5px]" : "px-2.5 py-1 text-[11.5px]"
      } ${STYLES[status]}`}
    >
      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${DOT[status]}`} aria-hidden="true" />
      {STATUS_LABELS[status]}
      {suffix}
      {sentence ? <span className="sr-only">. {sentence}</span> : null}
    </span>
  );
}
