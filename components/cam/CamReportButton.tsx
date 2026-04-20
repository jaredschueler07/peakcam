// components/cam/CamReportButton.tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { Flag } from "lucide-react";
import type { Cam } from "@/lib/types";
import { CamReportModal } from "./CamReportModal";

const STORAGE_KEY = "peakcam_cam_reports";       // { [cam_id]: isoTimestamp }
const REPORT_COOLDOWN_MS = 24 * 3600 * 1000;

type Status = "idle" | "submitted" | "alreadyReported";

interface Props {
  cam: Cam;
  resortName: string;
}

function readReportedMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function writeReportedAt(camId: string, iso: string) {
  if (typeof window === "undefined") return;
  const map = readReportedMap();
  map[camId] = iso;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota exceeded — ignore */
  }
}

export function CamReportButton({ cam, resortName }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [open, setOpen] = useState(false);

  // On mount: if this cam was reported in the last 24h from this device,
  // start in the disabled state.
  useEffect(() => {
    const map = readReportedMap();
    const iso = map[cam.id];
    if (!iso) return;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return;
    if (Date.now() - t < REPORT_COOLDOWN_MS) {
      setStatus("alreadyReported");
    }
  }, [cam.id]);

  const handleSubmitted = useCallback(() => {
    writeReportedAt(cam.id, new Date().toISOString());
    setStatus("submitted");
  }, [cam.id]);

  const disabled = status !== "idle";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className={`absolute top-3 right-3 z-10 inline-flex items-center gap-1.5
          px-2.5 py-0.5 rounded-full border-[1.5px] text-[11px] font-bold
          uppercase tracking-[0.14em] shadow-[2px_2px_0_#2a1f14]
          transition-[transform,box-shadow] duration-100
          ${disabled
            ? "bg-cream border-bark text-bark cursor-not-allowed shadow-none"
            : "bg-cream-50 border-ink text-ink hover:bg-ink hover:text-cream-50 hover:-translate-x-[1px] hover:-translate-y-[1px]"
          }`}
        aria-label={
          status === "submitted"
            ? "Report submitted"
            : status === "alreadyReported"
            ? "Already reported"
            : `Report ${cam.name} broken`
        }
      >
        <Flag size={11} strokeWidth={2.5} />
        {status === "submitted"
          ? "Reported"
          : status === "alreadyReported"
          ? "Reported"
          : "Report"}
      </button>

      {open && (
        <CamReportModal
          cam={cam}
          resortName={resortName}
          onClose={() => setOpen(false)}
          onSubmitted={() => {
            handleSubmitted();
            setOpen(false);
          }}
          onAlreadyReported={() => {
            setStatus("alreadyReported");
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
