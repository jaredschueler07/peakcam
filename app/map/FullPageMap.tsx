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
      <div className="h-full w-full bg-cream flex items-center justify-center">
        <span className="font-mono text-bark text-xs uppercase tracking-[0.14em]">Loading map…</span>
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

  const handleResortSelect = useCallback(
    (slug: string) => {
      // Tapping a marker SELECTS it — it never navigates. On mobile we show the
      // bottom sheet; on desktop MapView renders its own in-map popup card, so
      // there's nothing to do here. Navigation is the explicit second action
      // ("View resort" → handleViewResort). This kills the old race where a
      // hard nav / flyTo fired at the same instant as the popup.
      if (typeof window !== "undefined" && window.innerWidth < 1024) {
        const resort = resorts.find((r) => r.slug === slug) ?? null;
        setSelectedResort(resort);
      }
    },
    [resorts],
  );

  const handleViewResort = useCallback(
    (slug: string) => {
      router.push(`/resorts/${slug}`);
    },
    [router],
  );

  return (
    <div className="h-screen w-full relative bg-cream">
      {/* Back nav overlay */}
      <div className="absolute top-4 left-16 z-20">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-cream-50 border-[1.5px] border-ink rounded-full text-ink text-sm font-semibold shadow-stamp-sm hover:shadow-stamp hover:-translate-x-[1px] hover:-translate-y-[1px] transition-[transform,box-shadow] duration-100"
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
        onResortSelect={handleResortSelect}
        onViewResort={handleViewResort}
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
