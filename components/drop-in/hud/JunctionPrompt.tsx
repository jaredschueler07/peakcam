"use client";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { HudState } from "@/lib/game/runtime/UiBridge";
export default function JunctionPrompt({ store }: { store: StoreApi<HudState> }) {
  const prompt = useStore(store, state => state.junctionPrompt);
  if (!prompt) return null;
  return <div className="absolute bottom-64 sm:bottom-32 left-1/2 w-max max-w-[75vw] -translate-x-1/2 rounded-lg border border-ink bg-cream-50/95 px-4 py-2 text-center text-sm text-ink shadow-stamp-sm" data-testid="junction-prompt">
    <span className="pc-eyebrow block">Trail junction</span>{prompt}
  </div>;
}
