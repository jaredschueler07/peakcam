"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect } from "react";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!POSTHOG_KEY) return;
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      capture_pageview: true,
      capture_pageleave: true,
      persistence: "localStorage+cookie",
    });
  }, []);

  if (!POSTHOG_KEY) return <>{children}</>;

  return <PHProvider client={posthog}>{children}</PHProvider>;
}

// ── Event helpers ────────────────────────────────────────────
// Import these in components to track specific actions.

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
