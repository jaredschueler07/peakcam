"use client";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { HudState } from "@/lib/game/runtime/UiBridge";
export default function JunctionPrompt({ store, touchEnabled = false }: { store: StoreApi<HudState>; touchEnabled?: boolean }) {
  const prompt = useStore(store, state => state.junctionPrompt);
  if (!prompt) return null;
  return <div className={`absolute ${touchEnabled ? "top-48 [@media(max-height:500px)]:top-16" : "bottom-32"} left-1/2 w-max max-w-[60vw] -translate-x-1/2 rounded-lg border border-ink bg-cream-50/95 px-3 py-2 text-center text-sm text-ink shadow-stamp-sm`} data-testid="junction-prompt">
    <span className="pc-eyebrow block">Trail junction</span>{prompt}
  </div>;
}
