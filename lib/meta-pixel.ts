/**
 * Meta Pixel wiring shared by the loader component and the analytics mirror.
 *
 * Dataset "PeakCam" (id 910818501790206, business 1475031994318278). The id is
 * public by design — it ships in the page source on every load — so there is
 * deliberately no env var for it.
 */
export const META_PIXEL_ID = "910818501790206";

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
export const META_PIXEL_SNIPPET = `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${META_PIXEL_ID}');`;

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
 * blockers neuter the stub).
 */
export function fireMetaPixelEvent(eventName: string, params?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
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
