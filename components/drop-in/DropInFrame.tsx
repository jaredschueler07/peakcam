"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { track, EVENTS } from "@/lib/analytics-events";
import type { DropInProfile } from "@/lib/drop-in";

interface DropInFrameProps {
  profile: DropInProfile;
  gameUrl: string;
}

/**
 * Full-bleed host for the static Drop In engine.
 *
 * The engine is a plain HTML file under /public, so it can't import anything
 * from the app. The two talk over postMessage instead: the engine announces
 * `peakcam:drop-in-started` once the player actually clicks to start, which is
 * the only moment worth counting as a session (mount alone just means someone
 * followed a link).
 */
export default function DropInFrame({ profile, gameUrl }: DropInFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    track(EVENTS.DROP_IN_OPENED, { resort: profile.slug });
  }, [profile.slug]);

  // Backstop. The engine announces itself (see the ready message below) and the
  // iframe's own load event usually fires too — but the route is prerendered, so
  // the frame starts loading at parse time and can finish before hydration
  // attaches either handler. Never let the loading poster be the thing that
  // makes a working game look broken.
  useEffect(() => {
    const timer = window.setTimeout(() => setLoaded(true), 8000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // The frame is sandboxed without allow-same-origin, so its origin is the
      // opaque "null" rather than ours. Identity therefore rests on the source
      // check: this must be the exact window we mounted, not merely a frame
      // claiming the right origin string.
      if (event.origin !== "null" && event.origin !== window.location.origin) return;
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;

      const data = event.data as { type?: unknown; resort?: unknown } | null;
      if (!data || typeof data !== "object") return;

      // The engine has painted its start screen — drop our poster.
      if (data.type === "peakcam:drop-in-ready") {
        setLoaded(true);
        return;
      }

      // Only counted once the player actually clicks in; mounting just means
      // somebody followed a link.
      if (data.type !== "peakcam:drop-in-started") return;

      track(EVENTS.DROP_IN_STARTED, {
        resort: typeof data.resort === "string" ? data.resort : profile.slug,
      });
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [profile.slug]);

  return (
    <div className="fixed inset-0 bg-ink">
      {/* Back to conditions — always visible, above the canvas, and the first
          thing in the tab order so keyboard users are never trapped in the
          game frame. */}
      <div className="absolute left-3 top-36 z-20 sm:left-1/2 sm:top-4 sm:-translate-x-1/2">
        <Link
          href={`/resorts/${profile.slug}`}
          className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-ink bg-cream-50 px-3.5 py-2
                     text-[12px] font-bold uppercase tracking-[0.06em] text-ink shadow-stamp-sm
                     hover:shadow-stamp hover:-translate-x-[1px] hover:-translate-y-[1px]
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream-50
                     focus-visible:ring-offset-2 focus-visible:ring-offset-ink
                     transition-[transform,box-shadow] duration-100"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
          Back to conditions
        </Link>
      </div>

      {/* Branded loading state — covers the frame until the engine's own start
          screen is up. aria-live so screen readers hear the state change. */}
      {!loaded && (
        <div
          role="status"
          aria-live="polite"
          className="pc-topo absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 px-6 text-center"
        >
          <p className="pc-eyebrow" style={{ fontSize: 11 }}>
            PeakCam Drop In
          </p>
          <h1 className="pc-display text-4xl text-ink sm:text-6xl">
            {profile.name}
          </h1>
          <p className="max-w-sm font-mono text-[11px] uppercase tracking-[0.14em] text-bark">
            {profile.tagline}
          </p>
          <div
            className="mt-2 h-1.5 w-40 overflow-hidden rounded-full border-[1.5px] border-ink bg-cream-50"
            aria-hidden
          >
            <div
              className="h-full w-1/3 animate-pulse rounded-full"
              style={{ backgroundColor: profile.accent }}
            />
          </div>
          <span className="sr-only">Loading the {profile.name} descent…</span>
        </div>
      )}

      {/* `sandbox` deliberately omits allow-same-origin: the engine is served
          from /public and would otherwise run with full first-party access to
          peakcam.io — including the Supabase auth token, which is not httpOnly.
          It needs no storage or cookies, so an opaque origin costs it nothing. */}
      <iframe
        ref={frameRef}
        src={gameUrl}
        title={`Drop In — ${profile.name} arcade ski descent`}
        onLoad={() => setLoaded(true)}
        sandbox="allow-scripts allow-pointer-lock"
        allow="fullscreen; pointer-lock; autoplay"
        allowFullScreen
        className="h-full w-full border-0"
      />
    </div>
  );
}
