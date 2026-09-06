"use client";

import JunctionPrompt from "./JunctionPrompt";
import LiftStatus from "./LiftStatus";
import type { StoreApi } from "zustand/vanilla";
import type { HudState } from "@/lib/game/runtime/UiBridge";
import MinimapCanvas from "./MinimapCanvas";
import RunStatus from "./RunStatus";
import Speedometer from "./Speedometer";
import TrailStatus from "./TrailStatus";
import { Volume2, VolumeX } from "lucide-react";

export default function DropInHUD({ store, audioEnabled, onToggleAudio, onPause, touchEnabled }: {
  store: StoreApi<HudState>;
  touchEnabled: boolean;
  audioEnabled: boolean;
  onToggleAudio: () => void;
  onPause: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 px-3 pb-3 pt-16 sm:px-5 sm:pb-5">
      <div className="flex items-start justify-between gap-3"><Speedometer store={store} /><TrailStatus store={store} /></div>
      <LiftStatus store={store} />
      <JunctionPrompt store={store} touchEnabled={touchEnabled} />
      <div className={`absolute left-1/2 -translate-x-1/2 ${touchEnabled ? "bottom-40 w-[calc(100%_-_2rem)] max-w-sm [@media(max-height:500px)]:bottom-4 [@media(max-height:500px)]:max-w-xs" : "bottom-4 w-auto"}`}><RunStatus store={store} /></div>
      {!touchEnabled && <div className="absolute right-4 top-52 hidden sm:block"><MinimapCanvas store={store} /></div>}
      <button data-gameplay-control type="button" onClick={event => { event.currentTarget.focus(); onPause(); }} className="pointer-events-auto absolute left-4 top-32 min-h-11 rounded-full border-[1.5px] border-ink bg-cream-50 px-4 text-sm font-bold text-ink shadow-stamp-sm focus-visible:ring-2 focus-visible:ring-alpen" aria-label="Pause game">Pause</button>
      {!touchEnabled && <p className="absolute left-4 top-48 hidden max-w-sm rounded bg-cream-50/90 px-2 py-1 text-xs text-ink sm:block">← → carve · ↑ tuck · ↓ brake · Space jump · Esc pause</p>}
      <button
        type="button"
        data-gameplay-control
        aria-label={audioEnabled ? "Mute audio" : "Unmute audio"}
        aria-pressed={audioEnabled}
        onClick={onToggleAudio}
        className="pointer-events-auto absolute top-32 right-4 grid h-11 w-11 place-items-center rounded-full border-[1.5px] border-ink bg-cream-50 text-ink shadow-stamp-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-alpen"
      >
        {audioEnabled ? <Volume2 className="h-4 w-4" aria-hidden /> : <VolumeX className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );
}
