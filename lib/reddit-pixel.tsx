"use client";

import { useEffect, useState } from "react";
import Script from "next/script";
import {
  flushRedditPixelEvents,
  readRedditPixelId,
  redditTrack,
  trackRedditSignUp,
} from "./reddit-pixel-helpers";

export { flushRedditPixelEvents, readRedditPixelId, redditTrack, trackRedditSignUp };

// ─────────────────────────────────────────────────────────────
// Reddit Pixel — env-gated, no-op without NEXT_PUBLIC_REDDIT_PIXEL_ID.
// The standard snippet: defines the `rdt` queue, loads pixel.js, and fires
// PageVisit once on load. SPA navigations are not re-reported; the pixel is
// here for conversion attribution (SignUp), not pageview analytics.
// ─────────────────────────────────────────────────────────────

export function RedditPixel() {
  const [ready, setReady] = useState(false);
  const pixelId = readRedditPixelId();

  useEffect(() => {
    if (ready) flushRedditPixelEvents();
  }, [ready]);

  if (!pixelId) return null;

  return (
    <Script
      id="reddit-pixel"
      strategy="afterInteractive"
      onReady={() => {
        flushRedditPixelEvents();
        setReady(true);
      }}
    >
      {`
        !function(w,d){if(!w.rdt){var p=w.rdt=function(){p.sendEvent?p.sendEvent.apply(p,arguments):p.callQueue.push(arguments)};p.callQueue=[];var t=d.createElement("script");t.src="https://www.redditstatic.com/ads/pixel.js",t.async=!0;var s=d.getElementsByTagName("script")[0];s.parentNode.insertBefore(t,s)}}(window,document);
        try{rdt('init', '${pixelId}');rdt('track', 'PageVisit');}catch(e){}
      `}
    </Script>
  );
}
