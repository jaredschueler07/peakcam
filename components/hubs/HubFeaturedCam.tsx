"use client";

import { useState } from "react";
import { Camera, Play } from "lucide-react";
import type { Cam } from "@/lib/types";
import { camDisplayName, camElevationFt } from "@/lib/cam-name";
import { trackCamClick } from "@/lib/posthog";
import { CamEmbed } from "@/components/cam/CamEmbed";

interface Props {
  cam: Cam;
  resortSlug: string;
  resortName: string;
  /** The resort's own cam page, for CamEmbed's "Resort cameras ↗" fallback when a stream is down. */
  resortUrl?: string | null;
}

/** `cam_played` surface for hub pages; see trackCamPlayed in lib/posthog.tsx. */
const SURFACE = "hub";

/**
 * Click-to-play tile for a hub's featured cams. Only the poster is this
 * component's own: the click mounts `CamEmbed`, the shared media renderer
 * behind the resort page's tiles and lightbox, so player URLs, the Brownrice
 * status probe, still refresh, failure states and the `cam_played` event are
 * all one implementation. Nothing plays until the visitor asks — three
 * third-party players auto-starting on a state page would be the LCP.
 */
export function HubFeaturedCam({ cam, resortSlug, resortName, resortUrl }: Props) {
  const [loaded, setLoaded] = useState(false);
  const name = camDisplayName(cam);
  // The column is free text ("9000", "", "  ", junk) — the shared parser
  // returns a formatted "9,000′" or null, never a bare number or "NaN′".
  const elevation = camElevationFt(cam.elevation);

  const handleLoad = () => {
    setLoaded(true);
    trackCamClick(resortSlug, name, cam.embed_type);
  };

  return (
    <div className="relative aspect-video overflow-hidden rounded-[18px] border-[1.5px] border-ink bg-cream-50 shadow-stamp">
      {loaded ? (
        <>
          <CamEmbed cam={cam} resortSlug={resortSlug} variant="tile" resortUrl={resortUrl} surface={SURFACE} />
          <div
            className="pointer-events-none absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-ink bg-alpen px-2.5 py-0.5
                       text-[11px] font-bold uppercase tracking-[0.14em] text-cream-50 shadow-stamp-sm"
          >
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-cream-50 animate-pulse-live" />
            Live
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={handleLoad}
          aria-label={`Load the live ${name} cam at ${resortName}`}
          className="pc-grain group absolute inset-0 flex w-full flex-col items-center justify-center gap-3 bg-cream px-4 text-center"
        >
          <span className="inline-flex items-center justify-center rounded-full border-[1.5px] border-ink bg-cream-50 p-3 shadow-stamp-sm">
            <Camera className="text-ink" size={28} strokeWidth={2} aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-display text-xl font-black leading-tight text-ink">{resortName}</span>
            <span className="mt-0.5 block truncate text-sm text-bark">
              {name}
              {elevation ? ` · ${elevation}` : ""}
            </span>
          </span>
          <span
            className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-ink bg-alpen px-5 py-2.5 pointer-coarse:min-h-11
                       text-[14px] font-semibold text-cream-50 shadow-stamp transition-[transform,box-shadow] duration-100
                       group-hover:-translate-x-[1px] group-hover:-translate-y-[1px] group-hover:shadow-stamp-hover"
          >
            <Play size={16} aria-hidden />
            Load live feed
          </span>
        </button>
      )}
    </div>
  );
}
