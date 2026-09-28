"use client";

import { useEffect, useRef, useState } from "react";
import { recordBugAction } from "@/lib/bug-reports/client";
import { StreamFeed } from "./StreamFeed";
import { RefreshCw } from "lucide-react";
import type { Cam } from "@/lib/types";
import { camDisplayName } from "@/lib/cam-name";
import { trackCamPlayed } from "@/lib/posthog";

const REFRESH_MS = { tile: 30_000, lightbox: 15_000 } as const;

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
}

/** Auto-refreshing image feed: freshness badge, manual refresh,
 *  paused while the tab is hidden, placeholder on load failure.
 *  `onLoaded` fires for every frame that lands (including refreshes). */
function ImageFeed({ url, name, refreshMs, allowFill, onLoaded }: { url: string; name: string; refreshMs: number; allowFill: boolean; onLoaded?: () => void }) {
  const [fill, setFill] = useState(false);
  const [src, setSrc] = useState(url);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [, forceTick] = useState(0);
  const timers = useRef<{ refresh?: ReturnType<typeof setInterval>; tick?: ReturnType<typeof setInterval> }>({});
  const sawFirstFrame = useRef(false);

  const refresh = () => {
    const sep = url.includes("?") ? "&" : "?";
    setSrc(`${url}${sep}_t=${Date.now()}`);
    setFailed(false);
  };

  const markLoaded = () => {
    sawFirstFrame.current = true;
    setRefreshedAt(Date.now());
    onLoaded?.();
  };

  // The first two tiles on a resort page are server-rendered with their <img>
  // already in the HTML, so the still can finish downloading before React
  // hydrates — the browser has fired `load` by then and React never sees it,
  // leaving the badge on "Loading image…" until the first refresh and never
  // reporting the play. Read the element's state when the ref attaches; a
  // callback ref rather than an effect because it is the element, not a
  // render, that tells us whether the frame is there.
  const attachImg = (img: HTMLImageElement | null) => {
    if (!img || sawFirstFrame.current) return;
    if (img.complete && img.naturalWidth > 0) markLoaded();
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
        ref={attachImg}
        src={src}
        alt={name}
        className={`absolute inset-0 w-full h-full ${fill ? "object-cover" : "object-contain"}`}
        loading="lazy"
        onLoad={markLoaded}
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
export function CamEmbed({
  cam,
  resortSlug,
  variant,
  resortUrl,
  surface = "resort",
}: {
  cam: Cam;
  resortSlug: string;
  variant: "tile" | "lightbox";
  resortUrl?: string | null;
  /** Placement reported on `cam_played` ("resort", "home_live", …); see trackCamPlayed. */
  surface?: string;
}) {
  useEffect(() => { recordBugAction("camera-opened", { cameraId: cam.id }); }, [cam.id]);
  const name = camDisplayName(cam);
  // `cam_played` is the feed actually showing — the player document or the
  // first still has loaded — not the click that mounted it (cam_clicked covers
  // that). Once per mount: still refreshes and player retries are one play.
  const played = useRef(false);
  const handlePlayed = () => {
    if (played.current) return;
    played.current = true;
    trackCamPlayed(surface, cam.embed_type, resortSlug);
  };
  // Default to the still during SSR/hydration; never mount the viewer on mobile.
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  if (cam.embed_type === "youtube" && cam.youtube_id) {
    return <StreamFeed id={cam.id} url={`https://www.youtube.com/embed/${cam.youtube_id}?autoplay=1&mute=1`} name={name} resortUrl={resortUrl} onLoad={handlePlayed} />;
  }
  if (cam.embed_type === "iframe" && cam.embed_url) {
    // Palisades' Roundshot viewer is unusable on small screens; serve the still instead.
    const isPalisadesRoundshot = /palisadestahoe\.roundshot\.com\/silverado/i.test(cam.embed_url);
    if (isPalisadesRoundshot && !isDesktop) {
      return <ImageFeed url="https://palisadestahoe.roundshot.com/cams/249" name={name} refreshMs={REFRESH_MS[variant]} allowFill={variant === "lightbox"} onLoaded={handlePlayed} />;
    }
    return <StreamFeed id={cam.id} url={cam.embed_url} name={name} resortUrl={resortUrl} onLoad={handlePlayed} />;
  }

  if (cam.embed_type === "image" && cam.embed_url) {
    return <ImageFeed url={cam.embed_url} name={name} refreshMs={REFRESH_MS[variant]} allowFill={variant === "lightbox"} onLoaded={handlePlayed} />;
  }
  return null;
}
