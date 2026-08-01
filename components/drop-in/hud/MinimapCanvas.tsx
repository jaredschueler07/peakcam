"use client";

import { useEffect, useRef } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { HudState } from "@/lib/game/runtime/UiBridge";

export default function MinimapCanvas({ store }: { store: StoreApi<HudState> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => store.subscribe((state) => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#2a1f14"; context.lineWidth = 2;
    context.beginPath(); context.moveTo(canvas.width / 2, 8); context.lineTo(canvas.width / 2, canvas.height - 8); context.stroke();
    context.fillStyle = "#d9552f"; context.beginPath();
    context.arc(canvas.width / 2 + state.position.x * 0.08, 16 + (state.position.z % 1000) * 0.08, 4, 0, Math.PI * 2); context.fill();
  }), [store]);
  return <canvas ref={ref} width={96} height={112} aria-label="Run minimap" className="rounded-lg border-[1.5px] border-ink bg-cream-50/90 shadow-stamp-sm" />;
}

