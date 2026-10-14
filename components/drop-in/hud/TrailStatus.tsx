"use client";

import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { HudState } from "@/lib/game/runtime/UiBridge";

export default function TrailStatus({ store }: { store: StoreApi<HudState> }) {
  const trail = useStore(store, (state) => state.trailName);
  return <div className="max-w-[55%] truncate font-mono text-[10px] font-bold uppercase rounded-full border-[1.5px] border-ink bg-mustard px-3 py-1.5 text-ink shadow-stamp-sm">{trail}</div>;
}

