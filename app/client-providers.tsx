"use client";

import dynamic from "next/dynamic";
import { BugReportProvider } from "@/components/feedback/BugReportProvider";
import { PostHogProvider } from "@/lib/posthog";

// NOTE: PostHogProvider is imported statically on purpose. It wraps every
// page's `children`, and a `dynamic(..., { ssr: false })` wrapper here made
// the server emit an empty shell for the whole site (no <main>, no JSON-LD,
// fragment links like /about#terms had nothing to scroll to on a direct
// load). The provider is SSR-safe — posthog.init() only runs in an effect.
const MetaPixel = dynamic(
  () => import("@/lib/meta-pixel").then((mod) => mod.MetaPixel),
  { ssr: false }
);

export function ClientProviders({ children, release = "local" }: { children: React.ReactNode; release?: string }) {
  return (
    <BugReportProvider release={release}><PostHogProvider>
      {children}
      <MetaPixel />
    </PostHogProvider></BugReportProvider>
  );
}
