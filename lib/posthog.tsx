"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect, Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

// ── Page view tracker for App Router SPA navigation ──────────────────────────

function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    posthog.capture("$pageview", { $current_url: window.location.href });
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
      capture_pageview: false, // handled manually via PageViewTracker
      capture_pageleave: true,
      persistence: "localStorage+cookie",
    });
  }, []);

  if (!POSTHOG_KEY) return <>{children}</>;

  return (
    <PHProvider client={posthog}>
      <Suspense>
        <PageViewTracker />
      </Suspense>
      {children}
    </PHProvider>
  );
}

// ── Event helpers ─────────────────────────────────────────────────────────────
// Import these in components to track specific actions.

export function trackResortCardClick(resortName: string, resortSlug: string) {
  posthog.capture("resort_card_clicked", { resort_name: resortName, resort_slug: resortSlug });
}

export function trackResortView(resortName: string, resortSlug: string) {
  posthog.capture("resort_viewed", { resort_name: resortName, resort_slug: resortSlug });
}

export function trackCamClick(resortSlug: string, camName: string, embedType: string) {
  posthog.capture("cam_clicked", { resort_slug: resortSlug, cam_name: camName, embed_type: embedType });
}

export function trackConditionVote(resortSlug: string, snowQuality: string | null, comfort: string | null) {
  posthog.capture("condition_voted", { resort_slug: resortSlug, snow_quality: snowQuality, comfort });
}

export function trackSearch(query: string, resultCount: number) {
  posthog.capture("search_performed", { query, result_count: resultCount });
}

export function trackFilter(filterType: string, filterValue: string) {
  posthog.capture("filter_applied", { filter_type: filterType, filter_value: filterValue });
}
