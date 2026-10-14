"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { recordBugAction } from "@/lib/bug-reports/client";
import { StreamFeed } from "./StreamFeed";
import { RefreshCw } from "lucide-react";
import type { Cam } from "@/lib/types";
import { camDisplayName } from "@/lib/cam-name";
import { roundshotStillUrl, youtubeEmbedUrl } from "@/lib/cam-preview";

const REFRESH_MS = { tile: 30_000, lightbox: 15_000 } as const;
// Wider than this and a still is a panorama: letterboxed into 16:9 it becomes
// an unreadable ribbon, so the lightbox scrolls it sideways at natural aspect.
const PANORAMA_MIN_ASPECT = 2.4;

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
}

/** Auto-refreshing image feed: freshness badge, manual refresh,
 *  paused while the tab is hidden, placeholder on load failure. */
function ImageFeed({ url, name, refreshMs, allowFill }: { url: string; name: string; refreshMs: number; allowFill: boolean }) {
  const [fill, setFill] = useState(false);
  const [panorama, setPanorama] = useState(false);
  const [src, setSrc] = useState(url);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [, forceTick] = useState(0);
  const timers = useRef<{ refresh?: ReturnType<typeof setInterval>; tick?: ReturnType<typeof setInterval> }>({});
  const scrollerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const measure = (img: HTMLImageElement) => {
    setPanorama(img.naturalWidth > PANORAMA_MIN_ASPECT * img.naturalHeight);
    setRefreshedAt(Date.now());
  };

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

  // A cached still (the lightbox reopening a tile's image) can complete before
  // React attaches onLoad, so the load event never arrives — measure directly.
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) measure(img);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // Only the lightbox (allowFill) gets the strip; tiles keep the letterbox.
  const strip = allowFill && panorama && !fill;
  // Start centered once the strip mounts; later refreshes keep the user's scroll position.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (strip && el) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, [strip]);

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
      {/* A scrollable region needs a tab stop of its own to be reachable by keyboard. */}
      <div
        ref={scrollerRef}
        {...(strip ? { tabIndex: 0, role: "region", "aria-label": `${name} panorama, scroll sideways` } : {})}
        className={strip ? "absolute inset-0 overflow-x-auto overflow-y-hidden overscroll-x-contain" : "absolute inset-0"}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={src}
          alt={name}
          className={strip ? "block h-full w-auto max-w-none" : `block h-full w-full ${fill ? "object-cover" : "object-contain"}`}
          loading="lazy"
          onLoad={(event) => measure(event.currentTarget)}
          onError={() => setFailed(true)}
        />
      </div>
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
export function CamEmbed({ cam, variant, resortUrl }: { cam: Cam; resortSlug?: string; variant: "tile" | "lightbox"; resortUrl?: string | null }) {
  useEffect(() => { recordBugAction("camera-opened", { cameraId: cam.id }); }, [cam.id]);
  const name = camDisplayName(cam);
  // Roundshot's viewer (cookie overlay, control chrome) needs a wide window
  // and a mouse; small or touch-driven screens get the still instead.
  // Default to the still during SSR/hydration so the viewer never flashes.
  const [viewerCapable, setViewerCapable] = useState(false);
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)");
    const coarse = window.matchMedia("(pointer: coarse)");
    const update = () => setViewerCapable(wide.matches && !coarse.matches);
    update();
    wide.addEventListener("change", update);
    coarse.addEventListener("change", update);
    return () => {
      wide.removeEventListener("change", update);
      coarse.removeEventListener("change", update);
    };
  }, []);

  if (cam.embed_type === "youtube" && cam.youtube_id) {
    return <StreamFeed id={cam.id} url={youtubeEmbedUrl(cam.youtube_id)} name={name} resortUrl={resortUrl} />;
  }
  if (cam.embed_type === "iframe" && cam.embed_url) {
    const still = roundshotStillUrl(cam.embed_url);
    if (still && !viewerCapable) {
      return <ImageFeed url={still} name={name} refreshMs={REFRESH_MS[variant]} allowFill={variant === "lightbox"} />;
    }
    return <StreamFeed id={cam.id} url={cam.embed_url} name={name} resortUrl={resortUrl} />;
  }

  if (cam.embed_type === "image" && cam.embed_url) {
    return <ImageFeed url={cam.embed_url} name={name} refreshMs={REFRESH_MS[variant]} allowFill={variant === "lightbox"} />;
  }
  return null;
}
