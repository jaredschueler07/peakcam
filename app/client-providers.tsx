"use client";

import dynamic from "next/dynamic";
import { BugReportProvider } from "@/components/feedback/BugReportProvider";

const PostHogProvider = dynamic(
  () => import("@/lib/posthog").then((mod) => mod.PostHogProvider),
  { ssr: false }
);

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
