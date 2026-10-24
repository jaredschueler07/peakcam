"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";
import { BugReportProvider } from "@/components/feedback/BugReportProvider";
import { PostHogProvider } from "@/lib/posthog";
import { SignupWelcomeTracker } from "@/components/analytics/SignupWelcomeTracker";
import { LineupIntentBridge } from "@/components/auth/LineupIntentBridge";

// NOTE: PostHogProvider is imported statically on purpose. It wraps every
// page's `children`, and a `dynamic(..., { ssr: false })` wrapper here made
// the server emit an empty shell for the whole site (no <main>, no JSON-LD,
// fragment links like /about#terms had nothing to scroll to on a direct
// load). The provider is SSR-safe — posthog.init() only runs in an effect.
// Ad conversion tags. Each component returns null without its NEXT_PUBLIC_* id;
// the render is additionally gated on the (build-time inlined) env var so an
// unconfigured tag mounts nothing at all. The conversion helpers in the same
// modules (trackGoogleConversion / trackRedditSignUp) are imported statically
// by PowderAlertSignup and no-op on the same condition.
const GoogleTag = dynamic(
  () => import("@/lib/google-tag").then((mod) => mod.GoogleTag),
  { ssr: false }
);
const RedditPixel = dynamic(
  () => import("@/lib/reddit-pixel").then((mod) => mod.RedditPixel),
  { ssr: false }
);
const MetaPixel = dynamic(
  () => import("@/components/analytics/MetaPixel").then((mod) => mod.MetaPixel),
  { ssr: false }
);
const GOOGLE_ADS_ENABLED = Boolean(process.env.NEXT_PUBLIC_GOOGLE_ADS_ID);
const REDDIT_PIXEL_ENABLED = Boolean(process.env.NEXT_PUBLIC_REDDIT_PIXEL_ID);
const META_PIXEL_ENABLED = Boolean(process.env.NEXT_PUBLIC_META_PIXEL_ID);

export function ClientProviders({ children, release = "local" }: { children: React.ReactNode; release?: string }) {
  return (
    <BugReportProvider release={release}><PostHogProvider>
      {children}
      <Suspense>
        <SignupWelcomeTracker />
      </Suspense>
      {/* Finishes a guest mountain lineup after OAuth, email confirmation or a
          returning sign-in. One global consumer so every auth landing page
          gets the same idempotent save and success link. */}
      <LineupIntentBridge />
      {GOOGLE_ADS_ENABLED && <GoogleTag />}
      {REDDIT_PIXEL_ENABLED && <RedditPixel />}
      {META_PIXEL_ENABLED && <MetaPixel />}
    </PostHogProvider></BugReportProvider>
  );
}
