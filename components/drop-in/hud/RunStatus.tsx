"use client";

import { useStore } from "zustand";
import DescentProgress from "./DescentProgress";
import type { StoreApi } from "zustand/vanilla";
import type { HudState } from "@/lib/game/runtime/UiBridge";

export default function RunStatus({ store }: { store: StoreApi<HudState> }) {
  const time = useStore(store, (state) => state.elapsedSeconds);
  const vertical = useStore(store, (state) => state.verticalFeet);
  const altitude = useStore(store, (state) => state.altitudeFeet);
  const score = useStore(store, (state) => state.score);
  const combo = useStore(store, (state) => state.combo);
  return (
    <div className="rounded-lg border-[1.5px] border-ink bg-cream-50/95 px-3 py-2 text-ink shadow-stamp-sm">
      <DescentProgress store={store} />
      <dl data-testid="run-statistics" className="grid grid-cols-3 gap-x-3 gap-y-1 font-mono text-xs sm:grid-cols-5">
        <div><dt className="text-bark">Time</dt><dd>{time.toFixed(1)}s</dd></div>
        <div><dt className="text-bark">Vert</dt><dd>{Math.round(vertical)} ft</dd></div>
        <div><dt className="text-bark">Alt</dt><dd>{Math.round(altitude)} ft</dd></div>
        <div><dt className="text-bark">Score</dt><dd>{score.toLocaleString()}</dd></div>
        <div><dt className="text-bark">Combo</dt><dd>×{combo}</dd></div>
      </dl>
    </div>
  );
}
