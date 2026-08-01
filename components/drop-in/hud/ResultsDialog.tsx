"use client";

import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { HudState } from "@/lib/game/runtime/UiBridge";

export default function ResultsDialog({ store, onRestart }: { store: StoreApi<HudState>; onRestart(): void }) {
  const show = useStore(store, (state) => state.status === "results");
  const score = useStore(store, (state) => state.score);
  const time = useStore(store, (state) => state.elapsedSeconds);
  if (!show) return null;
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink/60 p-6" role="dialog" aria-modal="true" aria-labelledby="results-title">
      <div className="pc-paper rounded-lg border-[1.5px] border-ink p-6 text-center shadow-stamp-lg">
        <p className="pc-eyebrow">Run complete</p><h2 id="results-title" className="pc-display text-4xl">Your line</h2>
        <p className="mt-3 font-mono">{score.toLocaleString()} pts · {time.toFixed(1)}s</p>
        <button className="mt-5 rounded-full border-[1.5px] border-ink bg-alpen px-5 py-2 font-bold text-cream-50 shadow-stamp-sm" onClick={onRestart}>Drop again</button>
      </div>
    </div>
  );
}
