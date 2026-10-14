"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import MapBottomSheet from "@/components/map/MapBottomSheet";
import type { ResortWithData } from "@/lib/types";

// MapLibre needs window — dynamic import with no SSR
const MapView = dynamic(
  () => import("@/components/map/MapView"),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full bg-bg flex items-center justify-center">
        <span className="text-text-muted text-sm">Loading map...</span>
      </div>
    ),
  },
);

interface Props {
  resorts: ResortWithData[];
  radarTileUrl: string | null;
}

export function FullPageMap({ resorts, radarTileUrl }: Props) {
  const router = useRouter();
  const [selectedResort, setSelectedResort] = useState<ResortWithData | null>(null);

  const handleResortClick = useCallback(
    (slug: string) => {
      // On mobile: show bottom sheet. On desktop: navigate.
      if (typeof window !== "undefined" && window.innerWidth < 1024) {
        const resort = resorts.find((r) => r.slug === slug) ?? null;
        setSelectedResort(resort);
      } else {
        router.push(`/resorts/${slug}`);
      }
    },
    [resorts, router],
  );

  const handleViewResort = useCallback(
    (slug: string) => {
      router.push(`/resorts/${slug}`);
    },
    [router],
  );

  return (
    <div className="h-screen w-full relative bg-bg">
      {/* Back nav overlay */}
      <div className="absolute top-4 left-16 z-20">
        <Link
          href="/"
          className="flex items-center gap-1.5 px-3 py-2 bg-surface/90 backdrop-blur-md border border-border rounded-lg text-text-subtle text-sm hover:text-cyan transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Resorts
        </Link>
      </div>

      {/* Full-page map */}
      <MapView
        resorts={resorts}
        onResortClick={handleResortClick}
        radarTileUrl={radarTileUrl}
        variant="fullpage"
      />

      {/* Mobile bottom sheet */}
      {selectedResort && (
        <MapBottomSheet
          resort={selectedResort}
          onClose={() => setSelectedResort(null)}
          onViewResort={handleViewResort}
        />
      )}
    </div>
  );
}
