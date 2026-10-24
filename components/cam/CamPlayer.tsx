"use client";

import { useState } from "react";
import { Maximize2 } from "lucide-react";
import type { Cam } from "@/lib/types";
import { CamReportButton } from "@/components/cam/CamReportButton";
import { CamEmbed } from "@/components/cam/CamEmbed";
import { camDisplayName, camElevationFt } from "@/lib/cam-name";
import { cameraPreview } from "@/lib/cam-preview";
import { trackCamClick } from "@/lib/posthog";
import { FavoriteButton } from "@/components/ui/FavoriteButton";

// Click-to-play cam tile and its caption. Lifted out of ResortDetailPage so
// the resort overview and the /resorts/[slug]/webcams subpage render the
// same tile (same still-behind-placeholder, same tracking, same favorite
// button) from one component.

/** Caption under a cam tile. Some imported cam rows have a blank `name`, which
 *  used to render an empty <p>; fall back to the feed name and, failing that,
 *  drop the caption entirely. */
export function CamCaption({ cam }: { cam: Cam }) {
  const label = camDisplayName(cam, "");
  const elevation = camElevationFt(cam.elevation);
  if (!label && !elevation) return null;

  return (
    <p className="text-bark text-xs mt-1.5 px-1">
      {label}
      {elevation && (
        <span className={label ? "ml-1.5 text-bark/60" : "text-bark/60"}>
          {label ? "· " : ""}
          {elevation}
        </span>
      )}
    </p>
  );
}

export function CamPlayer({
  cam,
  resortSlug,
  resortName,
  resortUrl,
  index = 99,
  onExpand,
}: {
  cam: Cam;
  resortSlug: string;
  resortName: string;
  resortUrl?: string | null;
  index?: number;
  onExpand?: () => void;
}) {
  // Start only the first two still images. Video players load on demand so
  // opening a resort does not start several third-party players on a phone.
  const [loaded, setLoaded] = useState(cam.embed_type === "image" && index < 2);
  const label = camDisplayName(cam);
  const elevation = camElevationFt(cam.elevation);
  // A still of the view sits behind every click-to-play placeholder. It is in
  // the server-rendered HTML (this component hydrates, it does not mount
  // blind), so the page carries one descriptive <img> per cam for crawlers
  // and image search, and a visitor sees the mountain before deciding to
  // start a third-party player. Nothing plays until they tap.
  const still = cameraPreview(cam);
  const [stillFailed, setStillFailed] = useState(false);
  const onStill = still !== null && !stillFailed;
  const stillAlt = `${label} webcam at ${resortName}${elevation ? `, ${elevation}` : ""}`;
  const titleClass = onStill ? "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]" : "text-text-subtle";
  const subClass = onStill ? "text-white/85 drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]" : "text-bark";
  const pillClass = onStill ? "border-white/80 bg-black/35 text-white" : "border-forest text-forest";
  const stillLayer = onStill ? (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={still.src}
        alt={stillAlt}
        loading={index < 2 ? "eager" : "lazy"}
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
        onError={() => setStillFailed(true)}
      />
      <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-black/15" />
    </>
  ) : null;

  // Link-out cams — no embed available
  if (cam.embed_type === "link") {
    return (
      <div className="relative group">
        <CamReportButton cam={cam} resortName={resortName} />
        <a
          href={cam.embed_url ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => trackCamClick(resortSlug, cam.name, cam.embed_type)}
          className="flex flex-col items-center justify-center gap-3 bg-surface2 rounded-xl
                     border border-border hover:border-border-hi aspect-video
                     transition-all duration-220 hover:shadow-card-hover"
        >
          <div className="w-12 h-12 rounded-full bg-bg border border-border flex items-center justify-center
                          group-hover:border-cyan group-hover:text-cyan text-text-muted transition-all duration-220">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </div>
          <div className="text-center px-4">
            <p className="text-text-subtle text-sm font-medium group-hover:text-cyan transition-colors">
              {label}
            </p>
            <p className="text-text-muted text-xs mt-0.5">Opens on resort website</p>
          </div>
        </a>
        <div className="absolute top-2 right-2 z-20">
          <FavoriteButton
            itemId={cam.id}
            itemType="cam"
            label={cam.name}
            variant="ghost"
            className="bg-surface/50 backdrop-blur-sm"
            source="cam_save"
            authHeading={`Save ${label}.`}
            authNote="A free account keeps your saved cameras and mountains on every device."
          />
        </div>
      </div>
    );
  }

  // Image cams — auto-refreshing snapshot
  if (cam.embed_type === "image") {
    return (
      <div className="relative aspect-video bg-surface2 rounded-xl overflow-hidden border border-border group">
        <CamReportButton cam={cam} resortName={resortName} />
        {!loaded ? (
          <>
            {stillLayer}
            <button
              onClick={() => { setLoaded(true); trackCamClick(resortSlug, cam.name, cam.embed_type); }}
              className="absolute inset-0 w-full h-full flex flex-col items-center justify-center gap-3
                         hover:bg-white/5 transition-colors"
            >
              <div className="w-14 h-14 rounded-full bg-cyan/10 border border-cyan/30 flex items-center justify-center
                              group-hover:bg-cyan/20 group-hover:border-cyan transition-all duration-220">
                <svg className={`w-6 h-6 ${onStill ? "text-white" : "text-cyan"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                </svg>
              </div>
              <div className="text-center px-4">
                <p className={`${titleClass} text-sm font-medium`}>{label}</p>
                {elevation && (
                  <p className={`${subClass} text-xs mt-0.5`}>{elevation} elevation</p>
                )}
                <span className={`mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
                                 border-[1.5px] ${pillClass} text-[11px] font-semibold uppercase tracking-wider`}>
                  Tap to load snapshot
                </span>
              </div>
            </button>
          </>
        ) : (
          <>
            <CamEmbed cam={cam} resortSlug={resortSlug} variant="tile" resortUrl={resortUrl} />
            {onExpand && (
              <button
                onClick={event => { event.currentTarget.focus(); onExpand(); }}
                aria-label="Open fullscreen"
                className="absolute bottom-3 right-3 z-20 grid h-11 w-11 place-items-center bg-cream-50 border-[1.5px] border-ink rounded-full shadow-stamp text-ink hover:-translate-y-0.5 transition-transform"
              >
                <Maximize2 size={14} strokeWidth={2.5} />
              </button>
            )}
          </>
        )}
        <div className="absolute top-2 right-2 z-20">
          <FavoriteButton
            itemId={cam.id}
            itemType="cam"
            label={cam.name}
            variant="ghost"
            className="bg-surface/50 backdrop-blur-sm"
            source="cam_save"
            authHeading={`Save ${label}.`}
            authNote="A free account keeps your saved cameras and mountains on every device."
          />
        </div>
      </div>
    );
  }

  // YouTube + iframe — click-to-play
  return (
    <div className="relative aspect-video bg-surface2 rounded-xl overflow-hidden border border-border group">
      <CamReportButton cam={cam} resortName={resortName} />
      {/* Placeholder until user clicks */}
      {!loaded && (
        <>
          {stillLayer}
          <button
            onClick={() => { setLoaded(true); trackCamClick(resortSlug, cam.name, cam.embed_type); }}
            className="absolute inset-0 w-full h-full flex flex-col items-center justify-center gap-3
                       hover:bg-white/5 transition-colors"
          >
            <div className="w-14 h-14 rounded-full bg-cyan/10 border border-cyan/30 flex items-center justify-center
                            group-hover:bg-cyan/20 group-hover:border-cyan transition-all duration-220">
              <svg className={`w-6 h-6 ml-0.5 ${onStill ? "text-white" : "text-cyan"}`} fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <div className="text-center px-4">
              <p className={`${titleClass} text-sm font-medium`}>{label}</p>
              {elevation && (
                <p className={`${subClass} text-xs mt-0.5`}>{elevation} elevation</p>
              )}
              <span className={`mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
                               border-[1.5px] ${pillClass} text-[11px] font-semibold uppercase tracking-wider`}>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-[livePulse_2s_ease-in-out_infinite]" />
                Tap to load live cam
              </span>
            </div>
          </button>
        </>
      )}

      {/* Actual embed */}
      {loaded && <CamEmbed cam={cam} resortSlug={resortSlug} variant="tile" resortUrl={resortUrl} />}

      {/* Expand to fullscreen (overlay) */}
      {loaded && onExpand && (
        <button
          onClick={event => { event.currentTarget.focus(); onExpand(); }}
          aria-label="Open fullscreen"
          className="absolute bottom-3 right-3 z-20 grid h-11 w-11 place-items-center bg-cream-50 border-[1.5px] border-ink rounded-full shadow-stamp text-ink hover:-translate-y-0.5 transition-transform"
        >
          <Maximize2 size={14} strokeWidth={2.5} />
        </button>
      )}

      {/* Favorite Button (overlay) */}
      <div className="absolute top-2 right-2 z-20">
        <FavoriteButton
          itemId={cam.id}
          itemType="cam"
          label={cam.name}
          variant="ghost"
          className="bg-surface/50 backdrop-blur-sm"
          source="cam_save"
          authHeading={`Save ${label}.`}
          authNote="A free account keeps your saved cameras and mountains on every device."
        />
      </div>
    </div>
  );
}
