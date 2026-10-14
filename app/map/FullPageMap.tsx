"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import MapBottomSheet from "@/components/map/MapBottomSheet";
import type { RadarFrame } from "@/lib/weather-radar";
import type { ResortWithData } from "@/lib/types";

// MapLibre needs window — dynamic import with no SSR
const MapView = dynamic(
  () => import("@/components/map/MapView"),
  {
    ssr: false,
    loading: () => (
      <div className="pc-topo h-full w-full flex items-center justify-center">
        <span className="font-mono text-bark text-xs uppercase tracking-[0.14em]">Loading map…</span>
      </div>
    ),
  },
);

interface Props {
  resorts: ResortWithData[];
  radarFrames: RadarFrame[];
}

export function FullPageMap({ resorts, radarFrames }: Props) {
  const router = useRouter();
  const [selectedResort, setSelectedResort] = useState<ResortWithData | null>(null);
  // null = not probed yet (render the map as usual so SSR/first paint is
  // unchanged); false = this browser can't give us a WebGL context.
  const [webglSupported, setWebglSupported] = useState<boolean | null>(null);

  useEffect(() => {
    // Probed off the effect's synchronous path so the first commit isn't
    // immediately invalidated (and so the state stays `null` → map renders).
    const raf = requestAnimationFrame(() => {
      let supported = false;
      try {
        const canvas = document.createElement("canvas");
        supported = Boolean(
          canvas.getContext("webgl2") ||
            canvas.getContext("webgl") ||
            canvas.getContext("experimental-webgl"),
        );
      } catch {
        supported = false;
      }
      setWebglSupported(supported);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleWebGLError = useCallback(() => setWebglSupported(false), []);

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
    <div className="h-screen supports-[height:100dvh]:h-[100dvh] w-full relative bg-cream">
      {/* Back nav overlay */}
      <div className="absolute top-4 left-16 z-20">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 px-3 py-2 pointer-coarse:min-h-11 pointer-coarse:px-4 bg-cream-50 border-[1.5px] border-ink rounded-full text-ink text-sm font-semibold shadow-stamp-sm hover:shadow-stamp hover:-translate-x-[1px] hover:-translate-y-[1px] transition-[transform,box-shadow] duration-100"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Resorts
        </Link>
      </div>

      {/* Full-page map — or a friendly notice when WebGL is unavailable */}
      {webglSupported === false ? (
        <div
          role="status"
          className="pc-topo h-full w-full flex items-center justify-center px-6"
        >
          <div className="max-w-md text-center">
            <h2 className="font-display text-2xl sm:text-3xl text-ink">The map needs WebGL</h2>
            <p className="mt-3 text-bark text-sm sm:text-base leading-relaxed">
              This browser could not start WebGL, so the interactive map can&rsquo;t run here. Try
              another browser, or close some tabs and reload.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 px-3 py-2 pointer-coarse:min-h-11 pointer-coarse:px-4 bg-cream-50 border-[1.5px] border-ink rounded-full text-ink text-sm font-semibold shadow-stamp-sm hover:shadow-stamp hover:-translate-x-[1px] hover:-translate-y-[1px] transition-[transform,box-shadow] duration-100"
              >
                Browse all resorts
              </Link>
              <Link
                href="/snow-report"
                className="inline-flex items-center gap-1.5 px-3 py-2 pointer-coarse:min-h-11 pointer-coarse:px-4 bg-cream-50 border-[1.5px] border-ink rounded-full text-ink text-sm font-semibold shadow-stamp-sm hover:shadow-stamp hover:-translate-x-[1px] hover:-translate-y-[1px] transition-[transform,box-shadow] duration-100"
              >
                Snow report
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <MapView
          resorts={resorts}
          onResortSelect={handleResortSelect}
          onViewResort={handleViewResort}
          radarFrames={radarFrames}
          variant="fullpage"
          onWebGLError={handleWebGLError}
        />
      )}

      {/* Mobile bottom sheet */}
      {webglSupported !== false && selectedResort && (
        <MapBottomSheet
          resort={selectedResort}
          onClose={() => setSelectedResort(null)}
          onViewResort={handleViewResort}
        />
      )}
    </div>
  );
}
