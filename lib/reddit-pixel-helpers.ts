// Pure, framework-free Reddit Pixel helpers shared by `lib/reddit-pixel.tsx`
// and unit tests. Interpolated into an inline <script>; Reddit ids look like
// `t2_abc123`.
export function readRedditPixelId(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_REDDIT_PIXEL_ID?.trim();
  return raw && /^[A-Za-z0-9_]+$/.test(raw) ? raw : undefined;
}

declare global {
  interface Window {
    rdt?: (...args: unknown[]) => void;
  }
}

export const MAX_PENDING_REDDIT_EVENTS = 50;
const pendingRedditEvents: Array<[string, Record<string, unknown> | undefined]> = [];

/** Replay any conversions triggered during hydration before the Reddit stub executed. */
export function flushRedditPixelEvents() {
  if (typeof window === "undefined" || typeof window.rdt !== "function") return;
  for (const [eventName, params] of pendingRedditEvents.splice(0)) {
    redditTrack(eventName, params);
  }
}

export function redditTrack(event: string, params?: Record<string, unknown>) {
  if (!readRedditPixelId() || typeof window === "undefined") return;
  try {
    if (typeof window.rdt !== "function") {
      if (pendingRedditEvents.length < MAX_PENDING_REDDIT_EVENTS) {
        pendingRedditEvents.push([event, params]);
      }
      return;
    }
    window.rdt("track", event, params);
  } catch {
    // Analytics must never break the caller when blockers neuter window.rdt.
  }
}

/** Powder-alert subscription accepted by the API. */
export function trackRedditSignUp() {
  redditTrack("SignUp");
}
