"use client";

import { useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import type { Cam } from "@/lib/types";
import { CamEmbed } from "./CamEmbed";

interface Props {
  cams: Cam[];
  initialIndex: number;
  resortSlug: string;
  resortName: string;
  onClose: () => void;
}

export function CamLightbox({ cams, initialIndex, resortSlug, resortName, onClose }: Props) {
  const [index, setIndex] = useState(() => Math.min(Math.max(initialIndex, 0), cams.length - 1));
  const dialogRef = useRef<HTMLDivElement>(null);
  const cam = cams[index];

  const prev = () => setIndex((i) => (i - 1 + cams.length) % cams.length);
  const next = () => setIndex((i) => (i + 1) % cams.length);

  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prevFocus?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!cam) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${resortName} webcams`}
      tabIndex={-1}
      className="fixed inset-0 z-[200] bg-ink/95 flex flex-col outline-none"
      onClick={onClose}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0">
          <p className="font-mono text-[10.5px] font-bold text-cream-50/70 uppercase tracking-[0.14em]">{resortName}</p>
          <h2 className="font-display font-black text-cream-50 text-xl leading-tight truncate">{cam.name}</h2>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="font-mono text-[11px] text-cream-50/70">{index + 1} / {cams.length}</span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-2 bg-cream-50 border-[1.5px] border-ink rounded-full shadow-stamp text-ink hover:-translate-y-0.5 transition-transform"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Media */}
      <div className="flex-1 flex items-center justify-center px-4 pb-4 min-h-0" onClick={(e) => e.stopPropagation()}>
        {cams.length > 1 && (
          <button onClick={prev} aria-label="Previous cam"
            className="p-2.5 mr-3 bg-cream-50 border-[1.5px] border-ink rounded-full shadow-stamp text-ink hover:-translate-y-0.5 transition-transform shrink-0">
            <ChevronLeft size={18} />
          </button>
        )}
        <div className="relative w-full max-w-6xl aspect-video bg-ink rounded-[18px] overflow-hidden border-[1.5px] border-cream-50/20">
          <CamEmbed key={cam.id} cam={cam} resortSlug={resortSlug} variant="lightbox" />
        </div>
        {cams.length > 1 && (
          <button onClick={next} aria-label="Next cam"
            className="p-2.5 ml-3 bg-cream-50 border-[1.5px] border-ink rounded-full shadow-stamp text-ink hover:-translate-y-0.5 transition-transform shrink-0">
            <ChevronRight size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
