"use client";

import { useState } from "react";
import type { Cam } from "@/lib/types";
import type { CamTimeline } from "@/lib/cam-timeline";
import { CamCaption, CamPlayer } from "@/components/cam/CamPlayer";
import { CamLightbox } from "@/components/cam/CamLightbox";
import { CamTimelineStrip } from "@/components/resort/CamTimelineStrip";
import { camLive } from "@/lib/public-api/serialize";
import { useHydrated } from "@/lib/use-hydrated";

interface Props {
  cams: Cam[];
  resortSlug: string;
  resortName: string;
  resortUrl?: string | null;
  /** camId → still-archive timeline (getResortCamTimelines); cams without one get no strip. */
  timelines: Record<string, CamTimeline>;
}

/**
 * Every active cam for /resorts/[slug]/webcams: the same click-to-play tile
 * as the overview, a health line per cam, and the still-archive strip for
 * every cam that has frames on tape. Holds only the lightbox index.
 */
export function WebcamGrid({ cams, resortSlug, resortName, resortUrl, timelines }: Props) {
  const embeddable = cams.filter((c) => c.embed_type !== "link");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  return (
    <>
      <ol className="grid grid-cols-1 gap-8 md:grid-cols-2" aria-label="Webcams">
        {cams.map((cam, i) => (
          <li key={cam.id} id={`cam-${cam.id}`} className="scroll-mt-20">
            <CamPlayer
              cam={cam}
              resortSlug={resortSlug}
              resortName={resortName}
              resortUrl={resortUrl}
              index={i}
              onExpand={cam.embed_type !== "link" ? () => setLightboxIndex(embeddable.findIndex((c) => c.id === cam.id)) : undefined}
            />
            <CamCaption cam={cam} />
            <CamHealth cam={cam} />
            <CamTimelineStrip timeline={timelines[cam.id] ?? null} cams={[cam]} />
          </li>
        ))}
      </ol>
      {lightboxIndex !== null && (
        <CamLightbox
          cams={embeddable}
          initialIndex={lightboxIndex}
          resortSlug={resortSlug}
          resortName={resortName}
          resortUrl={resortUrl}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  );
}

const UTC_TIME = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });

/** "Live · checked Oct 18, 6:02 AM UTC" — the same health rule as the public API's `cams[].live`. */
function CamHealth({ cam }: { cam: Cam }) {
  const hydrated = useHydrated();
  const live = camLive(cam);
  const word = live === true ? "Live" : live === false ? "Offline at last check" : "Not yet health-checked";
  const tone = live === true ? "text-forest" : live === false ? "text-alpen" : "text-bark";
  const checked = cam.last_checked_at ? new Date(cam.last_checked_at) : null;
  const when =
    checked && !Number.isNaN(checked.getTime())
      ? hydrated
        ? checked.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
        : UTC_TIME.format(checked)
      : null;
  return (
    <p className="mt-1 px-1 font-mono text-[11px] uppercase tracking-wider text-bark">
      <span className={`font-bold ${tone}`}>{word}</span>
      {when && cam.last_checked_at && (
        <>
          {" · checked "}
          <time dateTime={cam.last_checked_at}>{when}</time>
        </>
      )}
      {cam.embed_type === "link" && " · opens on the resort site"}
    </p>
  );
}
