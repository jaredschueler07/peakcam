"use client";

import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { HudState } from "@/lib/game/runtime/UiBridge";

export default function RunStatus({ store }: { store: StoreApi<HudState> }) {
  const time = useStore(store, (state) => state.elapsedSeconds);
  const vertical = useStore(store, (state) => state.verticalFeet);
  const altitude = useStore(store, (state) => state.altitudeFeet);
  const score = useStore(store, (state) => state.score);
  const combo = useStore(store, (state) => state.combo);
  return (
    <dl data-testid="run-statistics" className="grid grid-cols-5 gap-x-2 whitespace-nowrap rounded-lg border-[1.5px] border-ink bg-cream-50/90 px-3 py-2 font-mono text-[9px] uppercase text-ink shadow-stamp-sm sm:gap-x-4 sm:text-[10px]">
      <div><dt className="text-bark">Time</dt><dd>{time.toFixed(1)}s</dd></div>
      <div><dt className="text-bark">Vert</dt><dd>{Math.round(vertical)} ft</dd></div>
      <div><dt className="text-bark">Alt</dt><dd>{Math.round(altitude)} ft</dd></div>
      <div><dt className="text-bark">Score</dt><dd>{score.toLocaleString()}</dd></div>
      <div><dt className="text-bark">Combo</dt><dd>×{combo}</dd></div>
    </dl>
  );
}
