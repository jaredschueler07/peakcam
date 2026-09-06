"use client";

import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { HudState } from "@/lib/game/runtime/UiBridge";

export default function TrailStatus({ store }: { store: StoreApi<HudState> }) {
  const trail = useStore(store, (state) => state.trailName);
  const top = useStore(store, (state) => state.trailTopFeet);
  const bottom = useStore(store, (state) => state.trailBottomFeet);
  return <div className="pc-eyebrow rounded-lg border-[1.5px] border-ink bg-mustard px-3 py-1.5 text-ink shadow-stamp-sm"><span className="block">{trail}</span>{top !== null && bottom !== null && <span className="mt-1 block text-xs tracking-normal">{Math.round(top).toLocaleString()} → {Math.round(bottom).toLocaleString()} ft</span>}</div>;
}

