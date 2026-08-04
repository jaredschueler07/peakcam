"use client";

import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { HudState } from "@/lib/game/runtime/UiBridge";

export default function Speedometer({ store }: { store: StoreApi<HudState> }) {
  const speed = useStore(store, (state) => state.speedKmh);
  return (
    <div data-testid="drop-in-speedometer" className="rounded-lg border-[1.5px] border-ink bg-cream-50/90 px-3 py-2 text-ink shadow-stamp-sm">
      <span className="font-display text-3xl tabular-nums">{speed}</span>
      <span className="ml-1 font-mono text-[9px] font-bold uppercase tracking-wider">km/h</span>
    </div>
  );
}
