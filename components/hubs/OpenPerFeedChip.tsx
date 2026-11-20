/**
 * "Open" beside a resort name in the hub and pass tables, shown only when a
 * current operator feed reports at least one lift open (lib/hub-lifts.ts).
 * Same palette as the resort page's OPEN status chip
 * (components/resort/StatusChip.tsx); the label carries the dated count for a
 * hover and for screen readers. Server markup, no hooks.
 */
export function OpenPerFeedChip({ label }: { label: string }) {
  return (
    <span
      data-testid="hub-open-chip"
      title={label}
      className="ml-1 inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-forest-dk bg-great px-1.5 py-px align-middle font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-cream-50"
    >
      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-cream-50" aria-hidden="true" />
      Open
      <span className="sr-only">. {label}</span>
    </span>
  );
}
