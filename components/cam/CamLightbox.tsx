"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { X, ChevronLeft, ChevronRight, ExternalLink, Camera } from "lucide-react";
import type { Cam } from "@/lib/types";
import { CamEmbed } from "./CamEmbed";
import { camDisplayName } from "@/lib/cam-name";

interface Props {
  cams: Cam[];
  initialIndex: number;
  resortSlug: string;
  resortName: string;
  onClose: () => void;
}

export function CamLightbox({ cams, initialIndex, resortSlug, resortName, onClose }: Props) {
  const [index, setIndex] = useState(() => Math.max(0, Math.min(initialIndex, cams.length - 1)));
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const cam = cams[Math.min(index, cams.length - 1)];
  const prev = () => setIndex(i => (i - 1 + cams.length) % cams.length);
  const next = () => setIndex(i => (i + 1) % cams.length);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const dialog = dialogRef.current;
    dialog?.showModal();
    closeRef.current?.focus();
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  if (!cam || typeof document === "undefined") return null;
  const cameraUrl = cam.embed_type === "youtube" ? `https://www.youtube.com/watch?v=${cam.youtube_id}` : cam.embed_url;
  const externalOnly = cam.embed_type === "link" || cam.embed_url?.startsWith("http:");
  return createPortal(
    <dialog ref={dialogRef} aria-label={`${resortName} webcams`}
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={event => {
        if (event.key === "ArrowLeft") { event.preventDefault(); prev(); }
        if (event.key === "ArrowRight") { event.preventDefault(); next(); }
      }}
      className="fixed inset-0 m-auto max-h-[95dvh] w-[calc(100%_-_1.5rem)] max-w-5xl overflow-y-auto rounded-[20px] border-[1.5px] border-ink bg-cream-50 p-0 text-ink shadow-stamp backdrop:bg-ink/80">
      <div className="flex items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-bark">Live look · {resortName}</p>
          <h2 className="mt-1 truncate font-display text-xl font-black sm:text-2xl">{camDisplayName(cam)}</h2>
        </div>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Close camera preview"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-ink bg-cream text-ink focus-visible:ring-2 focus-visible:ring-alpen"><X size={19} aria-hidden /></button>
      </div>
      <div className="relative aspect-video w-full bg-ink">
        {externalOnly ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-5 text-center text-cream-50">
            <Camera size={30} aria-hidden />
            <p className="text-sm">This camera is available on the resort’s website.</p>
            <a href={cam.embed_url!} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-cream-50 px-4 text-sm font-bold">Open camera <ExternalLink size={14} aria-hidden /></a>
          </div>
        ) : <CamEmbed key={cam.id} cam={cam} resortSlug={resortSlug} variant="lightbox" />}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <button type="button" onClick={prev} disabled={cams.length < 2} aria-label="Previous cam" className="grid h-11 w-11 place-items-center rounded-full border border-ink/30 disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-alpen"><ChevronLeft size={19} aria-hidden /></button>
          <span className="min-w-12 text-center font-mono text-xs">{index + 1} / {cams.length}</span>
          <button type="button" onClick={next} disabled={cams.length < 2} aria-label="Next cam" className="grid h-11 w-11 place-items-center rounded-full border border-ink/30 disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-alpen"><ChevronRight size={19} aria-hidden /></button>
        </div>
        {cameraUrl && !externalOnly && <a href={cameraUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-xs font-bold underline underline-offset-4">Open original <ExternalLink size={12} aria-hidden /></a>}
        <Link href={`/resorts/${resortSlug}`} className="inline-flex min-h-11 items-center gap-1 text-sm font-bold text-alpen-dk underline underline-offset-4">Resort details <ExternalLink size={13} aria-hidden /></Link>
        <p className="w-full font-mono text-[10px] text-bark">{cam.embed_type === "image" ? "Camera still · Capture time is provided by the camera operator when available." : "Feed provided by the camera operator. Availability may change."}</p>
      </div>
    </dialog>, document.body,
  );
}
