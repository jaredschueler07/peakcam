"use client";

import { useCallback, useMemo, useState } from "react";
import type { Cam } from "@/lib/types";
import { camDisplayName } from "@/lib/cam-name";
import { cameraPreviews } from "@/lib/cam-preview";

// Small live-cam thumbnail for the map's popup card and bottom sheet — the
// "conditions + map + webcam in one view" piece. Previewable cams honor
// cameraPreviews ordering (`card_preview !== false`, `preview_rank`, health,
// HTTPS, validated `youtube_id`), cache-busting direct image feeds once per mount.
export function pickPreviewCandidates(
  cams: Cam[],
  cacheBust: number = Date.now(),
): { cam: Cam; src: string; kind: "live" | "preview" }[] {
  return cameraPreviews(cams).map((p) => {
    if (p.cam.embed_type === "image" && p.label === "Camera still") {
      const sep = p.src.includes("?") ? "&" : "?";
      return { cam: p.cam, src: `${p.src}${sep}_t=${cacheBust}`, kind: "live" as const };
    }
    return {
      cam: p.cam,
      src: p.src,
      kind: p.label === "Camera still" ? ("live" as const) : ("preview" as const),
    };
  });
}

export function pickPreview(
  cams: Cam[],
  cacheBust: number = Date.now(),
): { cam: Cam; src: string; kind: "live" | "preview" } | null {
  return pickPreviewCandidates(cams, cacheBust)[0] ?? null;
}

interface MapCamPreviewProps {
  cams: Cam[];
  resortName: string;
  /** Invoked on click — same navigation the "View resort" action uses. */
  onClick?: () => void;
  className?: string;
}

export default function MapCamPreview({
  cams,
  resortName,
  onClick,
  className = "",
}: MapCamPreviewProps) {
  // Chosen once per mount — this is a glance, not a live player.
  const [cacheBust] = useState(() => Date.now());
  const candidates = useMemo(
    () => pickPreviewCandidates(cams, cacheBust),
    [cams, cacheBust],
  );
  const [failedSrcs, setFailedSrcs] = useState<Set<string>>(() => new Set());
  const preview = useMemo(
    () => candidates.find((c) => !failedSrcs.has(c.src)) ?? null,
    [candidates, failedSrcs],
  );

  const markFailed = useCallback((src: string) => {
    setFailedSrcs((prev) => {
      if (prev.has(src)) return prev;
      const next = new Set(prev);
      next.add(src);
      return next;
    });
  }, []);

  const previewSrc = preview?.src ?? "";
  const attachImg = useCallback(
    (img: HTMLImageElement | null) => {
      if (img && img.complete && img.naturalWidth === 0 && previewSrc) {
        markFailed(previewSrc);
      }
    },
    [markFailed, previewSrc],
  );

  if (!preview) return null;

  const camName = camDisplayName(preview.cam);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group/cam relative block w-full overflow-hidden rounded-[10px] border-[1.5px] border-ink text-left ${className}`}
      aria-label={`${preview.kind === "live" ? "Live webcam" : "Webcam preview"}: ${camName} at ${resortName} — view resort`}
    >
      {/* Plain <img>: cam hosts are arbitrary external domains (matches CamEmbed). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={attachImg}
        key={preview.src}
        src={preview.src}
        alt={`${camName} webcam at ${resortName}`}
        className="h-24 w-full object-cover transition-transform duration-200 group-hover/cam:scale-[1.03]"
        loading="lazy"
        onError={() => markFailed(preview.src)}
      />
      {/* Freshness badge — pulsing LIVE only for genuinely-fresh image
          snapshots; static YouTube thumbnails say "Preview". */}
      <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-ink/85 px-2 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.14em] text-cream-50">
        {preview.kind === "live" && (
          <span className="h-1.5 w-1.5 rounded-full bg-alpen motion-safe:animate-livePulse" aria-hidden />
        )}
        {preview.kind === "live" ? "Live" : "Preview"}
      </span>
      {/* Cam name strip */}
      <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-ink/75 to-transparent px-2 pb-1 pt-3 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-cream-50">
        {camName}
      </span>
    </button>
  );
}
