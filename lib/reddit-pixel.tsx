"use client";

import Script from "next/script";

// ─────────────────────────────────────────────────────────────
// Reddit Pixel — env-gated, no-op without NEXT_PUBLIC_REDDIT_PIXEL_ID.
// The standard snippet: defines the `rdt` queue, loads pixel.js, and fires
// PageVisit once on load. SPA navigations are not re-reported; the pixel is
// here for conversion attribution (SignUp), not pageview analytics.
// ─────────────────────────────────────────────────────────────

// Interpolated into an inline <script>; Reddit ids look like `t2_abc123`.
function readPixelId(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_REDDIT_PIXEL_ID;
  return raw && /^[A-Za-z0-9_]+$/.test(raw) ? raw : undefined;
}

const PIXEL_ID = readPixelId();

declare global {
  interface Window {
    rdt?: (...args: unknown[]) => void;
  }
}

export function RedditPixel() {
  if (!PIXEL_ID) return null;

  return (
    <Script id="reddit-pixel" strategy="afterInteractive">
      {`
        !function(w,d){if(!w.rdt){var p=w.rdt=function(){p.sendEvent?p.sendEvent.apply(p,arguments):p.callQueue.push(arguments)};p.callQueue=[];var t=d.createElement("script");t.src="https://www.redditstatic.com/ads/pixel.js",t.async=!0;var s=d.getElementsByTagName("script")[0];s.parentNode.insertBefore(t,s)}}(window,document);
        rdt('init', '${PIXEL_ID}');
        rdt('track', 'PageVisit');
      `}
    </Script>
  );
}

function redditTrack(event: string, params?: Record<string, unknown>) {
  if (!PIXEL_ID) return;
  if (typeof window === "undefined" || typeof window.rdt !== "function") return;
  window.rdt("track", event, params);
}

/** Powder-alert subscription accepted by the API. */
export function trackRedditSignUp() {
  redditTrack("SignUp");
}
