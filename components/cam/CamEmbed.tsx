"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { Cam } from "@/lib/types";

const REFRESH_MS = { tile: 30_000, lightbox: 15_000 } as const;

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
}

/** Auto-refreshing image feed: freshness badge, manual refresh,
 *  paused while the tab is hidden, placeholder on load failure. */
function ImageFeed({ url, name, refreshMs }: { url: string; name: string; refreshMs: number }) {
  const [src, setSrc] = useState(url);
  const [refreshedAt, setRefreshedAt] = useState(() => Date.now());
  const [failed, setFailed] = useState(false);
  const [, forceTick] = useState(0);
  const timers = useRef<{ refresh?: ReturnType<typeof setInterval>; tick?: ReturnType<typeof setInterval> }>({});

  const refresh = () => {
    const sep = url.includes("?") ? "&" : "?";
    setSrc(`${url}${sep}_t=${Date.now()}`);
    setRefreshedAt(Date.now());
    setFailed(false);
  };

  useEffect(() => {
    const start = () => {
      timers.current.refresh = setInterval(refresh, refreshMs);
      timers.current.tick = setInterval(() => forceTick((n) => n + 1), 5_000);
    };
    const stop = () => {
      clearInterval(timers.current.refresh);
      clearInterval(timers.current.tick);
    };
    const onVisibility = () => {
      stop();
      if (!document.hidden) {
        refresh();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, refreshMs]);

  if (failed) {
    return (
      <div className="absolute inset-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/cam-placeholder.jpg" alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-60" />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="px-3 py-1.5 bg-cream-50 border-[1.5px] border-ink rounded-full shadow-stamp font-mono text-[11px] font-bold text-ink uppercase tracking-[0.12em]">
            Feed unavailable
          </span>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={name}
        className="absolute inset-0 w-full h-full object-cover"
        loading="lazy"
        onError={() => setFailed(true)}
      />
      <div className="absolute bottom-2 left-2 z-10 flex items-center gap-1.5">
        <span className="px-2 py-0.5 bg-ink/80 rounded-full font-mono text-[10px] font-bold text-cream-50 uppercase tracking-[0.12em]">
          Live · {timeAgo(refreshedAt)}
        </span>
        <button
          onClick={refresh}
          aria-label="Refresh feed"
          className="p-1 bg-ink/80 rounded-full text-cream-50 hover:text-alpen transition-colors"
        >
          <RefreshCw size={11} />
        </button>
      </div>
    </>
  );
}

/** Shared cam media renderer for youtube / iframe / image embeds.
 *  Renders media only; the parent owns sizing, chrome, and overlays.
 *  Link-type cams have nothing to embed and are the caller's concern.
 *
 *  Fidelity note: the pre-extraction `CamPlayer` rendered youtube AND iframe
 *  cams through one shared <iframe> with allow="accelerometer; autoplay;
 *  clipboard-write; encrypted-media; gyroscope; picture-in-picture" and a
 *  `border-0` class. That exact allow list / className is preserved on both
 *  branches below so embed behavior is unchanged. */
export function CamEmbed({ cam, variant }: { cam: Cam; resortSlug: string; variant: "tile" | "lightbox" }) {
  if (cam.embed_type === "youtube" && cam.youtube_id) {
    return (
      <iframe
        src={`https://www.youtube.com/embed/${cam.youtube_id}?autoplay=1&mute=1`}
        title={cam.name}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="absolute inset-0 w-full h-full border-0"
      />
    );
  }
  if (cam.embed_type === "iframe" && cam.embed_url) {
    return (
      <iframe
        src={cam.embed_url}
        title={cam.name}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="absolute inset-0 w-full h-full border-0"
      />
    );
  }
  if (cam.embed_type === "image" && cam.embed_url) {
    return <ImageFeed url={cam.embed_url} name={cam.name} refreshMs={REFRESH_MS[variant]} />;
  }
  return null;
}
