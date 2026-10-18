"use client";

import type { Cam } from "@/lib/types";
import type { CamTimeline, CamTimelineFrame } from "@/lib/cam-timeline";
import { camDisplayName } from "@/lib/cam-name";
import { useHydrated } from "@/lib/use-hydrated";

/**
 * "Last 24 h" strip + "Last storm on tape" for one archive-allowed cam
 * (migration 024, docs/cams/still-archive-policy.md). Data arrives as a prop
 * from app/resorts/[slug]/page.tsx (getResortCamTimeline); nothing is fetched
 * here. Renders nothing without a timeline, so a resort with no archived
 * frames — every resort until the first 6-hourly run after deploy — is
 * byte-for-byte unchanged.
 *
 * Poster tokens only (cream / ink / bark / forest, stamp shadows, mono readouts).
 */
export function CamTimelineStrip({ timeline, cams }: { timeline: CamTimeline | null | undefined; cams: readonly Cam[] }) {
  if (!timeline || (timeline.frames.length === 0 && !timeline.lastStorm)) return null;
  const cam = cams.find((c) => c.id === timeline.camId);
  const camName = cam ? camDisplayName(cam, "") : "";
  const { frames, lastStorm } = timeline;

  return (
    <div className="mt-6 rounded-xl border-[1.5px] border-ink bg-cream-50 p-4 shadow-stamp-sm" data-testid="cam-timeline">
      {frames.length > 0 && (
        <section aria-labelledby="cam-timeline-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 id="cam-timeline-heading" className="font-heading text-sm font-bold uppercase tracking-[0.18em] text-ink">
              Last {timeline.hours} h
              {camName && <span className="ml-2 font-sans text-xs font-normal normal-case tracking-normal text-bark">{camName}</span>}
            </h3>
            <span className="font-mono text-[11px] uppercase tracking-wider text-bark">
              {frames.length} frame{frames.length === 1 ? "" : "s"} · every 6 h
            </span>
          </div>
          <ol className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {frames.map((frame) => (
              <li key={frame.id}>
                <Frame frame={frame} camName={camName} />
              </li>
            ))}
          </ol>
        </section>
      )}

      {lastStorm && (
        <section
          aria-labelledby="cam-storm-heading"
          className={frames.length > 0 ? "mt-4 flex gap-3 border-t border-bark/30 pt-4" : "flex gap-3"}
        >
          <figure className="m-0 w-28 shrink-0 sm:w-36">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lastStorm.url}
              alt={`${camName || "Cam"} during the last storm on tape`}
              loading="lazy"
              decoding="async"
              className="aspect-video w-full rounded-md border border-ink object-cover"
            />
          </figure>
          <div className="min-w-0">
            <h3 id="cam-storm-heading" className="font-heading text-sm font-bold uppercase tracking-[0.18em] text-ink">
              Last storm on tape
            </h3>
            <p className="mt-1 font-mono text-2xl font-bold leading-none text-forest">
              {formatInches(lastStorm.snow24hAtCapture)}
              <span className="ml-1.5 font-sans text-xs font-normal text-bark">in 24 h</span>
            </p>
            <p className="mt-1 text-xs text-bark">
              <FrameTime iso={lastStorm.capturedAt} />
            </p>
          </div>
        </section>
      )}
    </div>
  );
}

function Frame({ frame, camName }: { frame: CamTimelineFrame; camName: string }) {
  return (
    <figure className="m-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={frame.url}
        alt={`${camName || "Cam"} still${frame.snow24hAtCapture != null ? `, ${formatInches(frame.snow24hAtCapture)} new snow in 24 h` : ""}`}
        loading="lazy"
        decoding="async"
        className={`aspect-video w-full rounded-md border object-cover ${frame.keeper ? "border-forest ring-2 ring-forest/40" : "border-ink"}`}
      />
      <figcaption className="mt-1.5 flex items-baseline justify-between gap-2 px-0.5 text-[11px] leading-tight">
        <span className="truncate text-bark">
          <FrameTime iso={frame.capturedAt} />
        </span>
        <span className={`shrink-0 font-mono font-semibold ${frame.keeper ? "text-forest" : "text-ink"}`}>
          {frame.snow24hAtCapture != null ? formatInches(frame.snow24hAtCapture) : "—"}
          <span className="ml-0.5 font-sans font-normal text-bark">24 h</span>
        </span>
      </figcaption>
    </figure>
  );
}

function formatInches(value: number | null): string {
  if (value == null) return "—″";
  return `${Number.isInteger(value) ? value : value.toFixed(1)}″`;
}

const UTC_TIME = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

/**
 * Hydration-safe capture time: the page is server-rendered (UTC) and
 * ISR-cached, so the first paint shows the UTC time and the browser's zone
 * replaces it after hydration (same pattern as UpdatedStamp in
 * ResortDetailPage). The ISO instant is in `dateTime` either way.
 */
function FrameTime({ iso }: { iso: string }) {
  const hydrated = useHydrated();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const label = hydrated
    ? d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : UTC_TIME.format(d);
  return <time dateTime={iso}>{label}</time>;
}
