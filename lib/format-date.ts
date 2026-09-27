// ─────────────────────────────────────────────────────────────
// Deterministic date labels for ISR/SSR-rendered client components.
//
// The resort page is a "use client" tree that is also server-rendered (Vercel
// runs in UTC) and cached for an hour. Anything derived from the visitor's
// timezone or wall clock (`toLocaleDateString` without a fixed zone,
// `Date.now()`) produces different text on the server and in the browser, and
// React throws hydration error #418 on every load. Rule: the string rendered
// during SSR/hydration must be a pure function of the ISO input; the
// local-time / relative version is swapped in only after hydration
// (see lib/use-hydrated.ts and lib/use-forecast-time.ts).
// ─────────────────────────────────────────────────────────────

const UTC_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** "Sep 27" — same output on every machine; safe to render during SSR. */
export function formatUtcDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return UTC_DATE.format(d);
}

/** "Sep 27, 9:52 AM" in the *browser's* zone — client-only (post-hydration). */
export function formatLocalDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Relative label ("5m ago"). Takes the reference clock explicitly so callers
 * cannot accidentally read `Date.now()` during render; pass the value from
 * `useForecastTime()` (null before hydration → caller shows a fallback).
 */
export function timeAgo(iso: string, nowMs: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMins = Math.floor((nowMs - then) / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return `${Math.floor(diffHrs / 24)}d ago`;
}
