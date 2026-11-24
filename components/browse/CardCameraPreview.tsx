"use client";
import { useCallback, useMemo, useState } from "react";
import { Camera, ArrowUpRight, Play } from "lucide-react";
import type { Cam } from "@/lib/types";
import { cameraPreviews, type CameraPreview } from "@/lib/cam-preview";
import { camDisplayName } from "@/lib/cam-name";
import { formatLocalDateTime, formatUtcDate } from "@/lib/format-date";
import { useHydrated } from "@/lib/use-hydrated";

/**
 * "Still from Oct 14, 3:40 PM" for a frame our capture job stored (local time
 * after hydration; a timezone-free UTC date during SSR so server and client
 * HTML agree), else the provider label with no inferred capture time.
 */
function previewCaption(preview: CameraPreview, hydrated: boolean): string {
  // No stored frame, so no capture time we can vouch for: say what the
  // picture is and stop. Announcing "capture time unavailable" over an
  // operator still that prints its own clock read as a fault.
  if (!preview.capturedAt) return preview.label;
  const when = hydrated ? formatLocalDateTime(preview.capturedAt) : formatUtcDate(preview.capturedAt);
  return when ? `Still from ${when}` : preview.label;
}

export function CardCameraPreview({ cams, resortName, onOpen }: { cams: Cam[]; resortName: string; onOpen: (id?: string) => void }) {
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const hydrated = useHydrated();
  const preview = useMemo(
    () => cameraPreviews(cams).find((item) => !failed.has(item.src)) ?? null,
    [cams, failed],
  );
  const loading = Boolean(preview && preview.src !== loadedSrc);
  const markLoaded = useCallback((src: string) => {
    setLoadedSrc((prev) => (prev === src ? prev : src));
  }, []);
  const markFailed = useCallback((src: string) => {
    setFailed((previous) => {
      if (previous.has(src)) return previous;
      return new Set(previous).add(src);
    });
  }, []);
  const previewSrc = preview?.src ?? "";
  const attachImg = useCallback(
    (img: HTMLImageElement | null) => {
      if (!img || !img.complete || !previewSrc) return;
      if (img.naturalWidth > 0) markLoaded(previewSrc);
      else markFailed(previewSrc);
    },
    [markFailed, markLoaded, previewSrc],
  );
  const count = `${cams.length} cam${cams.length === 1 ? "" : "s"} available`;
  return (
    <div className="relative aspect-[16/9] overflow-hidden border-b border-ink bg-cream">
      <button type="button" disabled={!cams.length} onClick={event => { event.currentTarget.focus(); onOpen(preview?.cam.id); }}
        aria-label={`Live look at ${resortName}${preview ? ` — ${camDisplayName(preview.cam)}` : ""}`}
        className="group/preview absolute inset-0 block h-full w-full text-left outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-alpen disabled:cursor-default">
        {loading && <span className="pc-topo pointer-events-none absolute inset-0 grid place-items-center bg-cream text-ink/50" aria-hidden><Camera size={30} strokeWidth={1.5} /></span>}
        {preview ? (
          // Provider-supplied image or YouTube thumbnail; no video is loaded in the grid.
          // eslint-disable-next-line @next/next/no-img-element
          <img ref={attachImg} key={preview.src} src={preview.src} alt={`${camDisplayName(preview.cam)} at ${resortName}`}
            loading="lazy" decoding="async"
            // Fill the 16:9 box: crops YouTube's baked letterbox bars and the sides of ultra-wide panoramas instead of letterboxing them.
            className="relative h-full w-full object-cover"
            onLoad={() => setLoadedSrc(preview.src)}
            onError={() => setFailed(previous => new Set(previous).add(preview.src))} />
        ) : (
          <span className="pc-topo absolute inset-0 flex flex-col items-center justify-center gap-2 bg-cream text-ink">
            <Camera size={30} strokeWidth={1.5} aria-hidden />
            <span className="font-display text-xl font-bold">{cams.length ? "Take a look around." : "The mountain awaits."}</span>
            <span className="font-mono text-[10px] uppercase tracking-wide">{cams.length ? "Preview unavailable · Open cameras" : "No cameras available yet"}</span>
          </span>
        )}
        {preview && <>
          <span className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/85 to-transparent" aria-hidden />
          <span className="absolute bottom-3 left-4 right-16 text-white">
            <span className="block truncate text-sm font-semibold">{camDisplayName(preview.cam)}</span>
            <span className="mt-0.5 block font-mono text-[9px] uppercase tracking-wide">{loading ? "Loading preview…" : previewCaption(preview, hydrated)}</span>
          </span>
          <span className="absolute bottom-3 right-3 grid h-10 w-10 place-items-center rounded-full border border-white/60 bg-black/30 text-white"><Play size={17} fill="currentColor" aria-hidden /></span>
        </>}
        <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-ink bg-cream-50 px-2.5 py-1.5 font-mono text-[10px] font-bold text-ink shadow-stamp-sm">
          <Camera size={12} aria-hidden />{count}{cams.length > 0 && <ArrowUpRight size={12} aria-hidden />}
        </span>
      </button>
    </div>
  );
}
