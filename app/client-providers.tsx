"use client";

import dynamic from "next/dynamic";

const PostHogProvider = dynamic(
  () => import("@/lib/posthog").then((mod) => mod.PostHogProvider),
  { ssr: false }
);

const MetaPixel = dynamic(
  () => import("@/lib/meta-pixel").then((mod) => mod.MetaPixel),
  { ssr: false }
);

export function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <PostHogProvider>
      {children}
      <MetaPixel />
    </PostHogProvider>
  );
}
