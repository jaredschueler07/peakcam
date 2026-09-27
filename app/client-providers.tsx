"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";
import { BugReportProvider } from "@/components/feedback/BugReportProvider";
import { PostHogProvider } from "@/lib/posthog";
import { SignupWelcomeTracker } from "@/components/analytics/SignupWelcomeTracker";

// NOTE: PostHogProvider is imported statically on purpose. It wraps every
// page's `children`, and a `dynamic(..., { ssr: false })` wrapper here made
// the server emit an empty shell for the whole site (no <main>, no JSON-LD,
// fragment links like /about#terms had nothing to scroll to on a direct
// load). The provider is SSR-safe — posthog.init() only runs in an effect.
const MetaPixel = dynamic(
  () => import("@/lib/meta-pixel").then((mod) => mod.MetaPixel),
  { ssr: false }
);
// Ad conversion tags. Each component is a no-op without its NEXT_PUBLIC_* id,
// and the render is gated on the (build-time inlined) env var so the chunk is
// never even requested when the tag is not configured.
const GoogleTag = dynamic(
  () => import("@/lib/google-tag").then((mod) => mod.GoogleTag),
  { ssr: false }
);
const RedditPixel = dynamic(
  () => import("@/lib/reddit-pixel").then((mod) => mod.RedditPixel),
  { ssr: false }
);
const GOOGLE_ADS_ENABLED = Boolean(process.env.NEXT_PUBLIC_GOOGLE_ADS_ID);
const REDDIT_PIXEL_ENABLED = Boolean(process.env.NEXT_PUBLIC_REDDIT_PIXEL_ID);

export function ClientProviders({ children, release = "local" }: { children: React.ReactNode; release?: string }) {
  return (
    <BugReportProvider release={release}><PostHogProvider>
      {children}
      <Suspense>
        <SignupWelcomeTracker />
      </Suspense>
      <MetaPixel />
      {GOOGLE_ADS_ENABLED && <GoogleTag />}
      {REDDIT_PIXEL_ENABLED && <RedditPixel />}
    </PostHogProvider></BugReportProvider>
  );
}
