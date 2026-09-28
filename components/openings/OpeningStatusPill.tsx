import type { OpeningStatus } from "@/lib/openings";

// pc-chip variants for the five opening states. Open borrows the "great"
// condition fill; confirmed is ink-on-cream (a fact); projected is mustard
// (a guess, text-safe on ink); TBA is plain paper; closed is alpen-dk.
const STYLES: Record<OpeningStatus, string> = {
  open: "bg-great text-cream-50 border-forest-dk",
  confirmed: "bg-ink text-cream-50 border-ink",
  projected: "bg-fair text-ink border-bark-dk",
  tba: "bg-cream-dk text-ink border-bark",
  closed: "bg-poor text-cream-50 border-bark-dk",
};

const DOT: Record<OpeningStatus, string> = {
  open: "bg-cream-50",
  confirmed: "bg-cream-50",
  projected: "bg-ink",
  tba: "bg-bark",
  closed: "bg-cream-50",
};

export const STATUS_LABELS: Record<OpeningStatus, string> = {
  open: "Open",
  confirmed: "Confirmed",
  projected: "Projected",
  tba: "TBA",
  closed: "Closed",
};

export function OpeningStatusPill({ status, label }: { status: OpeningStatus; label?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] ${STYLES[status]}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[status]}`} />
      {label ?? STATUS_LABELS[status]}
    </span>
  );
}
