"use client";

import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { HudState } from "@/lib/game/runtime/UiBridge";

export default function DescentProgress({ store }: { store: StoreApi<HudState> }) {
  const trail = useStore(store, state => state.trailName);
  const top = useStore(store, state => state.trailTopFeet);
  const bottom = useStore(store, state => state.trailBottomFeet);
  const altitude = useStore(store, state => state.altitudeFeet);
  if (top === null || bottom === null || top <= bottom) return null;

  // Elevation progress stays meaningful off-piste and moves back toward the
  // top while riding a lift. It is not the race's distance/checkpoint progress.
  const fraction = Math.max(0, Math.min(1, (top - altitude) / (top - bottom)));
  const percent = Math.floor(fraction * 100);
  const remaining = Math.ceil(Math.max(0, altitude - bottom));
  return (
    <div data-testid="descent-progress" className="mb-2 border-b border-ink/15 pb-2">
      <div className="mb-1.5 flex items-baseline justify-between gap-3 font-mono text-[9px] uppercase tracking-wide sm:text-[10px]">
        <span className="font-bold">{percent}% down</span>
        <span className="text-bark">{remaining.toLocaleString()} vertical ft left</span>
      </div>
      <div
        role="progressbar"
        aria-label={`${trail} descent`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}% down, ${remaining.toLocaleString()} vertical feet to the bottom of ${trail}`}
        className="h-2 overflow-hidden rounded-full bg-ink/15"
      >
        <div className="h-full origin-left rounded-full bg-alpen transition-transform duration-100 motion-reduce:transition-none" style={{ transform: `scaleX(${fraction})` }} />
      </div>
    </div>
  );
}
