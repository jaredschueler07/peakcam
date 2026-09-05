"use client";
import { useEffect, useRef } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { HudState } from "@/lib/game/runtime/UiBridge";

export default function MinimapCanvas({ store }: { store: StoreApi<HudState> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let previous: HudState["trailPolyline"] | null = null;
    let centerX = 0, centerZ = 0, scale = 1;
    const draw = (state: HudState) => {
      const canvas = ref.current, context = canvas?.getContext("2d");
      if (!canvas || !context) return;
      if (state.trailPolyline !== previous) {
        previous = state.trailPolyline;
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const p of previous) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
        if (previous.length) { centerX = (minX + maxX) / 2; centerZ = (minZ + maxZ) / 2; scale = Math.min(158 / Math.max(500, maxX - minX), 100 / Math.max(500, maxZ - minZ)); }
      }
      context.clearRect(0, 0, 190, 166);
      context.save(); context.beginPath(); context.rect(4, 4, 182, 114); context.clip();
      context.strokeStyle = "#9a875e"; context.lineWidth = 1;
      let nearest = -1, best = Infinity;
      for (let i = 0; i < state.lifts.length; i++) {
        const lift = state.lifts[i]; context.beginPath();
        for (let j = 0; j < lift.points.length; j++) {
          const p = lift.points[j], x = 95 + (p.x - centerX) * scale, y = 58 + (p.z - centerZ) * scale;
          if (j === 0) context.moveTo(x, y); else context.lineTo(x, y);
          const d = (p.x - state.position.x) ** 2 + (p.z - state.position.z) ** 2;
          if (d < best) { best = d; nearest = i; }
        }
        context.stroke();
      }
      context.strokeStyle = "#2a1f14"; context.lineWidth = 2; context.beginPath();
      for (let i = 0; i < state.trailPolyline.length; i++) {
        const p = state.trailPolyline[i], x = 95 + (p.x - centerX) * scale, y = 58 + (p.z - centerZ) * scale;
        if (i === 0) context.moveTo(x, y); else context.lineTo(x, y);
      }
      context.stroke(); context.fillStyle = "#d9552f"; context.beginPath();
      context.arc(95 + (state.position.x - centerX) * scale, 58 + (state.position.z - centerZ) * scale, 4, 0, Math.PI * 2); context.fill(); context.restore();
      context.fillStyle = "#2a1f14"; context.font = "10px system-ui";
      context.fillText(state.trailName, 9, 133, 172);
      context.fillStyle = "#796638";
      if (nearest >= 0) context.fillText(`Lift: ${state.liftName ?? state.lifts[nearest].name}`, 9, 152, 172);
    };
    draw(store.getState()); return store.subscribe(draw);
  }, [store]);
  return <canvas ref={ref} width={190} height={166} aria-label="Named run and lift minimap" className="rounded-lg border-[1.5px] border-ink bg-cream-50/90 shadow-stamp-sm" />;
}
