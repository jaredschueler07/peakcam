"use client";

import type { TouchAdapter } from "@/lib/game/input/TouchAdapter";
import type { InputAction } from "@/lib/game/input/types";

const actions: Array<[Exclude<InputAction, "pause">, string]> = [
  ["tuck", "Tuck"], ["brake", "Brake"], ["jump", "Jump"], ["trail", "Trail"], ["restart", "Restart"],
];

export default function TouchControls({ adapter }: { adapter: TouchAdapter }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 touch-none sm:hidden" aria-label="Touch controls">
      <div className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-[max(1rem,env(safe-area-inset-left))] h-28 w-36 rounded-full border border-cream-50/70 bg-ink/20" aria-hidden />
      <div className="pointer-events-auto absolute bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] grid grid-cols-3 gap-2">
        {actions.map(([action, label]) => (
          <button key={action} className="min-h-11 rounded-full border-[1.5px] border-ink bg-cream-50/90 px-3 font-mono text-[9px] font-bold uppercase shadow-stamp-sm"
            onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); adapter.setAction(action, true); }}
            onPointerUp={() => adapter.setAction(action, false)} onPointerCancel={() => adapter.setAction(action, false)} onLostPointerCapture={() => adapter.setAction(action, false)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
