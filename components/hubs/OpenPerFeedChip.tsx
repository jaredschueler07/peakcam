/**
 * The lift-status chip beside a resort name in the hub and pass tables
 * (lib/hub-lifts.ts, day rules in lib/operator-day.ts).
 *
 * `open`: a reading of the operator's feed today showed a lift open. Same
 * palette as the resort page's OPEN status chip
 * (components/resort/StatusChip.tsx).
 * `opens-today`: no lift open yet, the feed lists some as scheduled. An
 * outlined, quieter chip, so it cannot be mistaken for "open now".
 *
 * The label carries the dated count for a hover and for screen readers.
 * Server markup, no hooks.
 */
export function OpenPerFeedChip({ label, variant = "open" }: { label: string; variant?: "open" | "opens-today" }) {
  const opens = variant === "opens-today";
  return (
    <span
      data-testid={opens ? "hub-opens-today-chip" : "hub-open-chip"}
      title={label}
      className={`ml-1 inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-px align-middle font-mono text-[10px] font-bold uppercase tracking-[0.1em] ${
        opens ? "border-forest-dk bg-transparent text-forest-dk" : "border-forest-dk bg-great text-cream-50"
      }`}
    >
      {!opens && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-cream-50" aria-hidden="true" />}
      {opens ? "Opens today" : "Open"}
      <span className="sr-only">. {label}</span>
    </span>
  );
}
