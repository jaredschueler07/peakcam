"use client";

import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { HudState } from "@/lib/game/runtime/UiBridge";

export default function PauseDialog({ store, onResume, onRestart }: { store: StoreApi<HudState>; onResume(): void; onRestart(): void }) {
  const paused = useStore(store, (state) => state.status === "paused");
  if (!paused) return null;
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink/60 p-6" role="dialog" aria-modal="true" aria-labelledby="pause-title">
      <div className="pc-paper max-w-sm rounded-lg border-[1.5px] border-ink p-6 text-center shadow-stamp-lg">
        <p className="pc-eyebrow">Run held</p><h2 id="pause-title" className="pc-display mt-1 text-4xl">Paused</h2>
        <p className="mt-3 text-sm text-bark-dk">WASD or arrows steer. Hold W to tuck, S to brake, and Space to jump.</p>
        <div className="mt-5 flex justify-center gap-3">
          <button className="rounded-full border-[1.5px] border-ink bg-alpen px-5 py-2 font-bold text-cream-50 shadow-stamp-sm" onClick={onResume}>Resume</button>
          <button className="rounded-full border-[1.5px] border-ink bg-cream-50 px-5 py-2 font-bold shadow-stamp-sm" onClick={onRestart}>Restart</button>
        </div>
      </div>
    </div>
  );
}

