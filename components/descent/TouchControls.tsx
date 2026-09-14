"use client";

import { useRef } from "react";
import type { ShellInput, TouchButton } from "./runtime-types";

/** Pointer capture keeps a drag alive off the pad; a synthetic event has no pointer to capture, so never let that throw. */
function capture(e: React.PointerEvent): void {
  try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* no active pointer (synthetic / test events) */ }
}

const BUTTON = "pointer-events-auto select-none border border-[#e8edf2]/40 bg-[#0b0e13]/60 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[#e8edf2] active:bg-[#e8edf2] active:text-[#06080b]";

/**
 * Thumb controls for phones: a horizontal steering pad on the left and five
 * hold buttons on the right. Everything goes through the runtime's input
 * controller, so touch and keyboard share one `InputState`.
 */
export default function TouchControls({ input }: { input: ShellInput }) {
  const padRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<number | null>(null);

  const steerFrom = (clientX: number) => {
    const pad = padRef.current;
    if (!pad) return;
    const rect = pad.getBoundingClientRect();
    const t = ((clientX - rect.left) / rect.width) * 2 - 1;
    input.setTouchSteer(Math.max(-1, Math.min(1, t * 1.15)));
  };

  const hold = (button: TouchButton) => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); capture(e); input.setTouchButton(button, true); },
    onPointerUp: () => input.setTouchButton(button, false),
    onPointerCancel: () => input.setTouchButton(button, false),
    onLostPointerCapture: () => input.setTouchButton(button, false),
  });

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" style={{ touchAction: "none" }}>
      <div
        ref={padRef}
        role="slider"
        aria-label="Steer"
        aria-valuemin={-1}
        aria-valuemax={1}
        aria-valuenow={0}
        className="pointer-events-auto relative h-24 w-[46vw] max-w-[220px] select-none border border-[#e8edf2]/40 bg-[#0b0e13]/55"
        style={{ touchAction: "none" }}
        onPointerDown={(e) => { e.preventDefault(); pointerRef.current = e.pointerId; capture(e); steerFrom(e.clientX); }}
        onPointerMove={(e) => { if (pointerRef.current === e.pointerId) steerFrom(e.clientX); }}
        onPointerUp={() => { pointerRef.current = null; input.setTouchSteer(0); }}
        onPointerCancel={() => { pointerRef.current = null; input.setTouchSteer(0); }}
      >
        <span className="absolute inset-y-0 left-1/2 w-px bg-[#e8edf2]/30" />
        <span className="absolute left-2 top-1/2 -translate-y-1/2 font-mono text-[10px] font-bold text-[#e8edf2]/70">◀</span>
        <span className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] font-bold text-[#e8edf2]/70">▶</span>
        <span className="absolute bottom-1 left-1/2 -translate-x-1/2 font-mono text-[9px] uppercase tracking-[0.16em] text-[#7f8b99]">Carve</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={`${BUTTON} h-12 w-20`} {...hold("lift")}>Lift</button>
        <button type="button" className={`${BUTTON} h-12 w-20`} {...hold("grab")}>Grab</button>
        <button type="button" className={`${BUTTON} h-14 w-20`} {...hold("brake")}>Brake</button>
        <button type="button" className={`${BUTTON} h-14 w-20`} {...hold("tuck")}>Tuck</button>
        <button type="button" className={`${BUTTON} col-span-2 h-14`} {...hold("jump")}>Jump</button>
      </div>
    </div>
  );
}
