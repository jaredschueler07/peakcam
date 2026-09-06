"use client";

import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { HudState } from "@/lib/game/runtime/UiBridge";
import type { TouchAdapter } from "@/lib/game/input/TouchAdapter";
import type { TouchPreferences } from "./ControlSettings";

const actions = [["brake", "Brake"], ["jump", "Jump"], ["tuck", "Tuck"]] as const;
export default function TouchControls({ adapter, preferences, store }: { adapter: TouchAdapter; preferences: TouchPreferences; store: StoreApi<HudState> }) {
  const running = useStore(store, state => state.status === "running");
  const indicator = useRef<HTMLDivElement>(null);
  const heldDirections = useRef(new Map<number | string, number>());
  useEffect(() => {
    adapter.setDragEnabled(preferences.steering === "drag");
    heldDirections.current.clear();
    return () => adapter.clear();
  }, [adapter, preferences.steering, running]);
  useEffect(() => adapter.subscribeSteering(point => {
    if (!indicator.current) return;
    indicator.current.style.display = point ? "block" : "none";
    if (point) {
      indicator.current.style.left = `${point.x}px`;
      indicator.current.style.top = `${point.y}px`;
      indicator.current.style.setProperty("--steer-offset", `${point.offset}px`);
    }
  }), [adapter]);
  const steer = (id: number | string, direction: number) => {
    if (direction) heldDirections.current.set(id, direction); else heldDirections.current.delete(id);
    adapter.setSteer([...heldDirections.current.values()].reduce((sum, value) => sum + value, 0));
  };
  if (!running) return null;
  const steeringSide = preferences.hand === "left" ? "left-[max(1rem,env(safe-area-inset-left))]" : "right-[max(1rem,env(safe-area-inset-right))]";
  const actionSide = preferences.hand === "left" ? "right-[max(1rem,env(safe-area-inset-right))]" : "left-[max(1rem,env(safe-area-inset-left))]";
  const buttonClass = "grid min-h-14 min-w-14 touch-none select-none place-items-center rounded-full border-[1.5px] border-ink bg-cream-50/95 px-3 text-sm font-bold text-ink shadow-stamp-sm active:bg-mustard";
  return <div className="pointer-events-none absolute inset-0 z-20" aria-label="Touch controls" data-steering-hand={preferences.hand}>
    <div ref={indicator} aria-hidden className="absolute hidden h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/80 bg-ink/30">
      <div className="absolute left-3 top-3 h-5 w-5 rounded-full bg-cream-50" style={{ transform: "translateX(var(--steer-offset, 0px))" }} />
    </div>
    <div className={`absolute bottom-[max(1rem,env(safe-area-inset-bottom))] ${steeringSide}`}>
      {preferences.steering === "drag" ? <p className="max-w-28 rounded-lg bg-ink/70 px-3 py-2 text-center text-xs text-cream-50" aria-hidden>Drag anywhere<br />to steer</p> : <div className="pointer-events-auto flex gap-2">
        {([-1, 1] as const).map(direction => <button key={direction} type="button" aria-label={direction < 0 ? "Steer left" : "Steer right"} className={buttonClass}
          onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); steer(e.pointerId, direction); }}
          onPointerUp={e => steer(e.pointerId, 0)} onPointerCancel={e => steer(e.pointerId, 0)} onLostPointerCapture={e => steer(e.pointerId, 0)}
          onKeyDown={e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); steer(`key${direction}`, direction); } }}
          onKeyUp={() => steer(`key${direction}`, 0)} onBlur={() => steer(`key${direction}`, 0)}>{direction < 0 ? "←" : "→"}</button>)}
      </div>}
    </div>
    <div className={`pointer-events-auto absolute bottom-[max(1rem,env(safe-area-inset-bottom))] ${actionSide} grid grid-cols-2 gap-2`}>
      {actions.map(([action, label]) => <button key={action} type="button" className={`${buttonClass} ${action === "tuck" ? "col-span-2" : ""}`}
        onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); adapter.setAction(action, true); }}
        onPointerUp={() => adapter.setAction(action, false)} onPointerCancel={() => adapter.setAction(action, false)} onLostPointerCapture={() => adapter.setAction(action, false)}
        onKeyDown={e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); adapter.setAction(action, true); } }}
        onKeyUp={() => adapter.setAction(action, false)} onBlur={() => adapter.setAction(action, false)}>{label}</button>)}
    </div>
  </div>;
}
