"use client";

import ControlSettings, { type TouchPreferences } from "../input/ControlSettings";
import { useDialogFocus } from "./useDialogFocus";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { HudState } from "@/lib/game/runtime/UiBridge";

export default function PauseDialog({ store, onResume, onRestart, preferences, onPreferencesChange, touchEnabled, onTrail }: { store: StoreApi<HudState>; onResume(): void; onRestart(): void; preferences: TouchPreferences; onPreferencesChange(value: TouchPreferences): void; touchEnabled: boolean; onTrail?: () => void }) {
  const paused = useStore(store, (state) => state.status === "paused");
  const dialogRef = useDialogFocus(paused);
  if (!paused) return null;
  return (
    <div ref={dialogRef} tabIndex={-1} className="absolute inset-0 z-50 overflow-y-auto overscroll-contain bg-ink/60 px-4 py-6" role="dialog" aria-modal="true" aria-labelledby="pause-title" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onResume(); } }}>
      <div className="pc-paper mx-auto w-full max-w-sm rounded-lg border-[1.5px] border-ink p-6 text-center shadow-stamp-lg">
        <p className="pc-eyebrow">Run held</p><h2 id="pause-title" className="pc-display mt-1 text-4xl">Paused</h2>
        <p className="mt-3 text-sm text-bark-dk">{touchEnabled ? "Steer with a drag or arrow buttons. Brake, tuck, and jump with your other thumb." : "WASD or arrows steer. Hold W to tuck, S to brake, and Space to jump."}</p>
          <button className="min-h-11 rounded-full border-[1.5px] border-ink bg-alpen-dk px-5 py-2 font-bold text-cream-50 shadow-stamp-sm" onClick={onResume}>Resume</button>
        <ControlSettings preferences={preferences} onChange={onPreferencesChange} />
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          {onTrail && <button className="min-h-11 rounded-full border border-ink bg-cream-50 px-5 py-2 font-bold" onClick={onTrail}>Next trail</button>}
          <button className="min-h-11 rounded-full border-[1.5px] border-ink bg-cream-50 px-5 py-2 font-bold shadow-stamp-sm" onClick={onRestart}>Restart</button>
        </div>
      </div>
    </div>
  );
}

