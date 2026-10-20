"use client";

import { useState } from "react";
import Link from "next/link";
import type { Cam } from "@/lib/types";
import { clipDurationSeconds, type CamTimelapseClip, type CamTimelapses } from "@/lib/cam-timelapse";
import { camDisplayName } from "@/lib/cam-name";
import { useHydrated } from "@/lib/use-hydrated";

/**
 * Timelapse clips (migrations 025 + 031, docs/cams/still-archive-policy.md
 * section 8). Data arrives as a prop from the page (getResortTimelapses);
 * nothing is fetched here, and the MP4 is never requested until the visitor
 * presses play: every tile is the poster JPEG with a play button, and only
 * then a <video preload="none"> is mounted. Both exports render nothing
 * without a clip, so a resort with no clips is byte-for-byte unchanged.
 *
 * Poster tokens only (cream / ink / bark / forest, stamp shadows, mono readouts).
 */

/** One cam's clip and name, flattened for the strip. */
interface StripEntry {
  camId: string;
  camName: string;
  clip: CamTimelapseClip;
}

function entries(timelapses: readonly CamTimelapses[], cams: readonly Cam[]): { current: StripEntry[]; storm: StripEntry | null } {
  const nameOf = (id: string) => {
    const cam = cams.find((c) => c.id === id);
    return cam ? camDisplayName(cam, "") : "";
  };
  const current: StripEntry[] = [];
  let storm: StripEntry | null = null;
  for (const t of timelapses) {
    if (t.current) current.push({ camId: t.camId, camName: nameOf(t.camId), clip: t.current });
    const s = t.storms[0];
    if (s && (!storm || (s.stormDate ?? "") > (storm.clip.stormDate ?? ""))) storm = { camId: t.camId, camName: nameOf(t.camId), clip: s };
  }
  return { current, storm };
}

/**
 * Webcams subpage: "Last 24 hours" strip (one tile per cam with a clip) and
 * the "Last storm on tape" tile when a storm reel exists.
 */
export function TimelapseStrip({ timelapses, cams }: { timelapses: readonly CamTimelapses[] | null | undefined; cams: readonly Cam[] }) {
  if (!timelapses?.length) return null;
  const { current, storm } = entries(timelapses, cams);
  if (!current.length && !storm) return null;

  return (
    <section aria-labelledby="timelapse-heading" className="rounded-[18px] border-[1.5px] border-ink bg-cream-50 p-5 shadow-stamp-sm" data-testid="timelapse-strip">
      {current.length > 0 && (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="timelapse-heading" className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
              Last 24 hours
            </h2>
            <span className="font-mono text-[11px] uppercase tracking-wider text-bark">
              {current.length} clip{current.length === 1 ? "" : "s"} · 7 fps · re-rendered every 6 h
            </span>
          </div>
          <ol className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="24-hour timelapses">
            {current.map((e) => (
              <li key={e.clip.id}>
                <ClipPlayer clip={e.clip} title={e.camName} caption={<ClipCaption clip={e.clip} />} camId={e.camId} />
              </li>
            ))}
          </ol>
        </>
      )}

      {storm && (
        <section aria-labelledby="storm-reel-heading" className={current.length ? "mt-6 border-t border-bark/30 pt-5" : ""}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="storm-reel-heading" className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
              Last storm on tape
            </h2>
            <span className="font-mono text-[11px] uppercase tracking-wider text-forest">
              {storm.clip.stormDate ? <StormDate day={storm.clip.stormDate} /> : "storm reel"}
            </span>
          </div>
          <div className="mt-4 max-w-xl">
            <ClipPlayer clip={storm.clip} title={`${storm.camName} during the storm`} caption={<ClipCaption clip={storm.clip} storm />} camId={storm.camId} />
          </div>
        </section>
      )}

      <p className="mt-4 text-xs leading-relaxed text-bark">
        Clips are PeakCam renders of its own archived frames of cams whose operators allow archiving; rights stay with the operator. The 24-hour clip is replaced every render; storm reels are kept for a year.
      </p>
    </section>
  );
}

/**
 * Resort overview: one small "last 24 h" tile for the newest clip at the
 * resort, linking to the webcams page for the rest.
 */
export function TimelapseTile({ clip, cams, webcamsHref }: { clip: (CamTimelapseClip & { camId: string }) | null | undefined; cams: readonly Cam[]; webcamsHref: string }) {
  if (!clip) return null;
  const cam = cams.find((c) => c.id === clip.camId);
  const camName = cam ? camDisplayName(cam, "") : "";
  return (
    <div className="mt-6 rounded-xl border-[1.5px] border-ink bg-cream-50 p-4 shadow-stamp-sm" data-testid="timelapse-tile">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-heading text-sm font-bold uppercase tracking-[0.18em] text-ink">
          Last 24 h on tape
          {camName && <span className="ml-2 font-sans text-xs font-normal normal-case tracking-normal text-bark">{camName}</span>}
        </h3>
        <Link href={webcamsHref} className="text-xs font-bold text-ink underline-offset-2 hover:underline">
          All clips →
        </Link>
      </div>
      <div className="mt-3 max-w-md">
        <ClipPlayer clip={clip} title={camName} caption={<ClipCaption clip={clip} />} camId={clip.camId} />
      </div>
    </div>
  );
}

/** Poster + play button; mounts the <video> only after the first press. */
function ClipPlayer({ clip, title, caption, camId }: { clip: CamTimelapseClip; title: string; caption: React.ReactNode; camId: string }) {
  const [playing, setPlaying] = useState(false);
  const label = `${title || "Cam"} timelapse${clip.stormDate ? `, storm of ${clip.stormDate}` : ", last 24 hours"}`;
  return (
    <figure className="m-0">
      <div className="relative aspect-video w-full overflow-hidden rounded-md border border-ink bg-ink">
        {playing ? (
          <video
            controls
            autoPlay
            muted
            playsInline
            loop
            preload="none"
            poster={clip.posterUrl ?? undefined}
            className="h-full w-full object-contain"
            aria-label={label}
          >
            <source src={clip.url} type="video/mp4" />
          </video>
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="group absolute inset-0 h-full w-full cursor-pointer"
            aria-label={`Play ${label}`}
            data-testid="timelapse-play"
            data-cam-id={camId}
          >
            {clip.posterUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={clip.posterUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center font-mono text-xs uppercase tracking-wider text-cream">
                MP4 clip
              </span>
            )}
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full border-[1.5px] border-ink bg-cream shadow-stamp-sm transition group-hover:scale-105" aria-hidden="true">
                <svg viewBox="0 0 24 24" className="ml-1 h-6 w-6 fill-ink"><path d="M8 5v14l11-7z" /></svg>
              </span>
            </span>
          </button>
        )}
      </div>
      <figcaption className="mt-1.5 flex items-baseline justify-between gap-2 px-0.5 text-[11px] leading-tight">{caption}</figcaption>
    </figure>
  );
}

function ClipCaption({ clip, storm = false }: { clip: CamTimelapseClip; storm?: boolean }) {
  const secs = clipDurationSeconds(clip.frames);
  return (
    <>
      <span className="truncate text-bark">
        {clip.startsAt && clip.endsAt ? (
          <>
            <ClipTime iso={clip.startsAt} /> – <ClipTime iso={clip.endsAt} />
          </>
        ) : (
          <>rendered <ClipTime iso={clip.renderedAt} /></>
        )}
      </span>
      <span className={`shrink-0 font-mono font-semibold ${storm ? "text-forest" : "text-ink"}`}>
        {clip.frames != null ? `${clip.frames} frames` : "clip"}
        {secs != null && <span className="ml-1 font-sans font-normal text-bark">{secs} s</span>}
      </span>
    </>
  );
}

const UTC_TIME = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });

/** Hydration-safe instant: UTC on the server-rendered first paint, the browser's zone after hydration (same pattern as CamTimelineStrip). */
function ClipTime({ iso }: { iso: string }) {
  const hydrated = useHydrated();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const label = hydrated ? d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : UTC_TIME.format(d);
  return <time dateTime={iso}>{label}</time>;
}

function StormDate({ day }: { day: string }) {
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return <>{day}</>;
  return <time dateTime={day}>{d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</time>;
}
