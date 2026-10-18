/**
 * Meta Pixel wiring shared by the loader component and the analytics mirror.
 *
 * Env-gated like the Google and Reddit tags: without NEXT_PUBLIC_META_PIXEL_ID
 * the component is never mounted (app/client-providers.tsx), the helpers below
 * no-op, and the site makes no request to connect.facebook.net / facebook.com.
 * The id is public by design (it ships in the page source), so the env var is
 * an on/off switch and a place to point at a different dataset, not a secret.
 */

/** Validated pixel id from the build-time env, or undefined when unset. */
export function metaPixelId(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim();
  // Meta dataset ids are numeric; the id is interpolated into an inline
  // <script>, so anything else is rejected rather than escaped.
  return raw && /^\d{6,20}$/.test(raw) ? raw : undefined;
}

/** Build-time id ("" when the pixel is disabled). Kept for existing importers. */
export const META_PIXEL_ID = metaPixelId() ?? "";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

/**
 * Standard Meta base snippet, minus the initial PageView: MetaPixel fires
 * PageView itself on mount and on every client-side navigation, so a full
 * page load can never double-count.
 */
export function buildMetaPixelSnippet(id: string): string {
  return `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${id}');`;
}

/** Snippet for the build-time id. Kept for existing importers. */
export const META_PIXEL_SNIPPET = buildMetaPixelSnippet(META_PIXEL_ID);

const pendingEvents: Array<[string, Record<string, unknown> | undefined]> = [];

/** Replay events captured during hydration before the inline stub existed. */
export function flushMetaPixelEvents() {
  if (typeof window === "undefined" || !window.fbq) return;
  for (const [eventName, params] of pendingEvents.splice(0)) {
    fireMetaPixelEvent(eventName, params);
  }
}

/**
 * Forward a conversion event to the Meta Pixel. Safe to call before
 * fbevents.js finishes loading — the fbq stub queues calls and replays them
 * in order. Never throws: an analytics mirror must not break the app (ad
 * blockers neuter the stub). A no-op when the pixel is not configured, so an
 * unconfigured build neither queues nor sends anything.
 */
export function fireMetaPixelEvent(eventName: string, params?: Record<string, unknown>) {
  if (typeof window === "undefined" || !metaPixelId()) return;
  try {
    if (!window.fbq) {
      pendingEvents.push([eventName, params]);
      return;
    }
    window.fbq("track", eventName, params);
  } catch {
    // ignore — analytics must never throw
  }
}
