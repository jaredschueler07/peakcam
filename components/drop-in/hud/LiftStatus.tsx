"use client";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { HudState } from "@/lib/game/runtime/UiBridge";

export default function LiftStatus({ store }: { store: StoreApi<HudState> }) {
  const name = useStore(store, (state) => state.liftName);
  const remaining = useStore(store, (state) => state.liftSecondsRemaining);
  if (!name) return null;
  return <div className="absolute left-1/2 top-24 w-max max-w-[70vw] -translate-x-1/2 rounded-lg border-[1.5px] border-ink bg-cream-50/95 px-5 py-3 text-center text-ink shadow-stamp" data-testid="lift-ride-overlay">
    <p className="pc-eyebrow">Riding {name}</p>
    <p className="mt-1 text-xs">Unloading at the summit in {Math.ceil(remaining)}s</p>
  </div>;
}
