"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { Cam } from "@/lib/types";
import { camDisplayName } from "@/lib/cam-name";

const REFRESH_MS = { tile: 30_000, lightbox: 15_000 } as const;

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
}

/** Auto-refreshing image feed: freshness badge, manual refresh,
 *  paused while the tab is hidden, placeholder on load failure. */
function ImageFeed({ url, name, refreshMs, allowFill }: { url: string; name: string; refreshMs: number; allowFill: boolean }) {
  const [fill, setFill] = useState(false);
  const [src, setSrc] = useState(url);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [, forceTick] = useState(0);
  const timers = useRef<{ refresh?: ReturnType<typeof setInterval>; tick?: ReturnType<typeof setInterval> }>({});

  const refresh = () => {
    const sep = url.includes("?") ? "&" : "?";
    setSrc(`${url}${sep}_t=${Date.now()}`);
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
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <span className="px-3 py-1.5 bg-cream-50 border-[1.5px] border-ink rounded-full shadow-stamp font-mono text-[11px] font-bold text-ink uppercase tracking-[0.12em]">
            Feed unavailable
          </span>
          <button type="button" onClick={refresh} className="min-h-11 rounded-full border border-ink bg-cream-50 px-4 text-sm font-bold text-ink">Retry camera</button>
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
        className={`absolute inset-0 w-full h-full ${fill ? "object-cover" : "object-contain"}`}
        loading="lazy"
        onLoad={() => setRefreshedAt(Date.now())}
        onError={() => setFailed(true)}
      />
      {allowFill && <button type="button" onClick={() => setFill(value => !value)} aria-pressed={fill} className="absolute right-2 top-2 z-10 min-h-11 rounded-full border border-cream-50 bg-ink/90 px-3 text-sm font-bold text-cream-50">{fill ? "Show full frame" : "Fill view"}</button>}
      <div className="absolute bottom-2 left-2 z-10 flex items-center gap-1.5">
        <span className="px-2 py-0.5 bg-ink/80 rounded-full font-mono text-[10px] font-bold text-cream-50 uppercase tracking-[0.12em]">
          {refreshedAt === null ? "Loading image…" : `Image loaded ${timeAgo(refreshedAt)}`}
        </span>
        <button
          onClick={refresh}
          aria-label="Refresh feed"
          className="grid h-11 w-11 place-items-center bg-ink/80 rounded-full text-cream-50 hover:text-alpen transition-colors"
        >
          <RefreshCw size={16} />
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
  const name = camDisplayName(cam);

  if (cam.embed_type === "youtube" && cam.youtube_id) {
    return (
      <iframe
        src={`https://www.youtube.com/embed/${cam.youtube_id}?autoplay=1&mute=1`}
        title={name}
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
        title={name}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="absolute inset-0 w-full h-full border-0"
      />
    );
  }
  if (cam.embed_type === "image" && cam.embed_url) {
    return <ImageFeed url={cam.embed_url} name={name} refreshMs={REFRESH_MS[variant]} allowFill={variant === "lightbox"} />;
  }
  return null;
}
