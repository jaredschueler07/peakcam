"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect, Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { redactSensitiveUrl, sanitizeCaptureEvent } from "./posthog-sanitize";
import { EVENTS, track, whenPostHogReady } from "./analytics-events";
import { PostHogAuthSync } from "./posthog-auth-sync";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

// ── Page views ───────────────────────────────────────────────────────────────
//
// posthog-js discards captures on an uninitialised instance, and React flushes
// child effects before parent effects — so on a cold load PageViewTracker's
// effect runs BEFORE the provider's init effect. The initial $pageview is
// therefore captured by the provider itself, immediately after posthog.init().
// PageViewTracker covers subsequent SPA navigations, deferring through
// whenPostHogReady() in case it wins the race anyway.
//
// `lastPageviewUrl` dedupes the two paths: whichever fires first for a given
// URL wins and the other is a no-op. That also absorbs React StrictMode's
// double-invoked effects in development.

let lastPageviewUrl: string | null = null;

function capturePageview() {
  // Redacted here as well as in before_send: this is the one call site that
  // hands PostHog a URL explicitly, so it should not depend on the init hook
  // still being wired up.
  const url = redactSensitiveUrl(window.location.href);
  if (url === lastPageviewUrl) return;
  lastPageviewUrl = url;
  posthog.capture("$pageview", { $current_url: url });
}

function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    // Returns the cancel handle so a navigation that races the SDK load does
    // not attribute a stale URL to whatever page came next.
    return whenPostHogReady(capturePageview);
  }, [pathname, searchParams]);

  return null;
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!POSTHOG_KEY) return;
    // Respect Do Not Track
    const dnt =
      navigator.doNotTrack === "1" ||
      (window as Window & { doNotTrack?: string }).doNotTrack === "1";
    if (dnt) return;

    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      capture_pageview: false, // handled manually — see capturePageview
      capture_pageleave: true,
      persistence: "localStorage+cookie",
      // Strips alert manage_tokens and Supabase auth codes out of every
      // captured property, including the URL properties PostHog attaches
      // automatically (autocapture, pageleave, web vitals). `before_send`
      // rather than the deprecated `sanitize_properties` — see the note on
      // sanitizeCaptureEvent.
      before_send: sanitizeCaptureEvent,
    });

    // Cold-load pageview: the SDK is initialised synchronously by init(), so
    // this is the earliest point at which a capture is not dropped.
    capturePageview();
  }, []);

  if (!POSTHOG_KEY) return <>{children}</>;

  return (
    <PHProvider client={posthog}>
      <Suspense>
        <PageViewTracker />
      </Suspense>
      <PostHogAuthSync />
      {children}
    </PHProvider>
  );
}

// ── Event helpers ─────────────────────────────────────────────────────────────
// Import these in components to track specific actions. Every helper goes
// through track(), which queues until posthog.init() has run — calling
// posthog.capture directly from a mount effect loses the event on cold loads.

export function trackResortCardClick(resortName: string, resortSlug: string) {
  track(EVENTS.RESORT_CARD_CLICKED, { resort_name: resortName, resort_slug: resortSlug });
}

export function trackResortView(resortName: string, resortSlug: string) {
  track(EVENTS.RESORT_VIEWED, { resort_name: resortName, resort_slug: resortSlug });
}

export function trackCamClick(resortSlug: string, camName: string, embedType: string) {
  track(EVENTS.CAM_CLICKED, { resort_slug: resortSlug, cam_name: camName, embed_type: embedType });
}

/**
 * A cam feed actually started (click-to-play resolved), as opposed to the tile
 * being clicked. `surface` distinguishes the homepage strips from the resort
 * page so the same embed can be compared across placements.
 */
export function trackCamPlayed(
  surface: "home_live" | "home_snow" | "resort" | "map" | (string & {}),
  embedType: string,
  resortSlug?: string
) {
  track(EVENTS.CAM_PLAYED, { surface, embed_type: embedType, resort_slug: resortSlug });
}

export function trackConditionVote(resortSlug: string, snowQuality: string | null, comfort: string | null) {
  track(EVENTS.CONDITION_VOTED, { resort_slug: resortSlug, snow_quality: snowQuality, comfort });
}

export function trackSearch(query: string, resultCount: number) {
  track(EVENTS.SEARCH_PERFORMED, { query, result_count: resultCount });
}

export function trackFilter(filterType: string, filterValue: string) {
  track(EVENTS.FILTER_APPLIED, { filter_type: filterType, filter_value: filterValue });
}
