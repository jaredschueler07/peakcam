"use client";

import { useMemo, useState } from "react";
import type { Cam } from "@/lib/types";

// Small live-cam thumbnail for the map's popup card and bottom sheet — the
// "conditions + map + webcam in one view" piece. Previewable cams:
//   image   → the snapshot URL itself (cache-busted once on mount)
//   youtube → YouTube's static thumbnail for the stream id
// iframe/link cams can't be thumbnailed; callers keep showing the cam count.
export function pickPreview(cams: Cam[]): { cam: Cam; src: string } | null {
  const active = cams.filter((c) => c.is_active);
  const image = active.find((c) => c.embed_type === "image" && c.embed_url);
  if (image) {
    const sep = image.embed_url!.includes("?") ? "&" : "?";
    return { cam: image, src: `${image.embed_url}${sep}_t=${Date.now()}` };
  }
  const yt = active.find((c) => c.embed_type === "youtube" && c.youtube_id);
  if (yt) {
    return { cam: yt, src: `https://i.ytimg.com/vi/${yt.youtube_id}/mqdefault.jpg` };
  }
  return null;
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
  const preview = useMemo(() => pickPreview(cams), [cams]);
  const [failed, setFailed] = useState(false);

  if (!preview || failed) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group/cam relative block w-full overflow-hidden rounded-[10px] border-[1.5px] border-ink text-left ${className}`}
      aria-label={`Live webcam: ${preview.cam.name} at ${resortName} — view resort`}
    >
      {/* Plain <img>: cam hosts are arbitrary external domains (matches CamEmbed). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={preview.src}
        alt={`${preview.cam.name} webcam at ${resortName}`}
        className="h-24 w-full object-cover transition-transform duration-200 group-hover/cam:scale-[1.03]"
        loading="lazy"
        onError={() => setFailed(true)}
      />
      {/* LIVE badge */}
      <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-ink/85 px-2 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.14em] text-cream-50">
        <span className="h-1.5 w-1.5 rounded-full bg-alpen animate-livePulse" aria-hidden />
        Live
      </span>
      {/* Cam name strip */}
      <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-ink/75 to-transparent px-2 pb-1 pt-3 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-cream-50">
        {preview.cam.name}
      </span>
    </button>
  );
}
