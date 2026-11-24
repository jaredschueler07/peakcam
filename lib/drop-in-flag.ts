/**
 * Lightweight, zero-dependency Drop In feature flag & slug predicates.
 *
 * Kept strictly free of `./game/config/profiles` and `zod` so global chrome
 * (`Header`, `not-found`, map popups, resort detail pages) can test whether
 * Drop In is active without pulling the 3D trail config or Zod into every
 * non-game route bundle.
 */

export const DROP_IN_RESORT_SLUGS = [
  "ski-portillo",
  "breckenridge",
  "heavenly",
] as const;

export type DropInResortSlug = (typeof DROP_IN_RESORT_SLUGS)[number];

/**
 * Production kill switch. Read at call time so tests can toggle it.
 */
export function isDropInEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DROP_IN_ENABLED === "true";
}

/** Uniform 404 for the Drop In API routes while the feature is parked. */
export function dropInDisabledResponse(): Response {
  return Response.json({ error: "Drop In is not available" }, { status: 404 });
}

/** Whether a resort is part of the Drop In pilot when enabled. */
export function isDropInResort(slug: string): boolean {
  if (!isDropInEnabled()) return false;
  return (DROP_IN_RESORT_SLUGS as readonly string[]).includes(slug);
}

export function getDropInHref(slug: string): string | null {
  if (!isDropInResort(slug)) return null;
  return `/resorts/${slug}/drop-in`;
}

export function getDropInGameUrl(slug: string): string | null {
  return getDropInHref(slug);
}
