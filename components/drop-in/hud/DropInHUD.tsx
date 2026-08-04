"use client";

import type { StoreApi } from "zustand/vanilla";
import type { HudState } from "@/lib/game/runtime/UiBridge";
import MinimapCanvas from "./MinimapCanvas";
import RunStatus from "./RunStatus";
import Speedometer from "./Speedometer";
import TrailStatus from "./TrailStatus";
import { Volume2, VolumeX } from "lucide-react";

export default function DropInHUD({ store, audioEnabled, onToggleAudio }: {
  store: StoreApi<HudState>;
  audioEnabled: boolean;
  onToggleAudio: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 px-3 pb-3 pt-16 sm:px-5 sm:pb-5" aria-live="polite">
      <div className="flex items-start justify-between gap-3"><Speedometer store={store} /><TrailStatus store={store} /></div>
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2"><RunStatus store={store} /></div>
      <div className="absolute right-4 top-20 hidden sm:block"><MinimapCanvas store={store} /></div>
      <button
        type="button"
        aria-label={audioEnabled ? "Mute audio" : "Unmute audio"}
        aria-pressed={audioEnabled}
        onClick={onToggleAudio}
        className="pointer-events-auto absolute bottom-4 right-4 grid h-10 w-10 place-items-center rounded-full border-[1.5px] border-ink bg-cream-50 text-ink shadow-stamp-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-alpen"
      >
        {audioEnabled ? <Volume2 className="h-4 w-4" aria-hidden /> : <VolumeX className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );
}
