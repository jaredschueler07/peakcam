"use client";

import dynamic from "next/dynamic";
import { ChevronDown, Check } from "lucide-react";
import type { RiderMode, SnowboardStance } from "@/lib/game/config/rider-style";
import { GEAR, OUTFITS, type GearId, type OutfitId, type RiderStyle } from "@/lib/game/config/rider-style";

const Preview = dynamic(() => import("./RiderPreviewCanvas"), { ssr: false, loading: () => <p role="status" className="flex min-h-64 items-center justify-center text-sm text-bark-dk">Getting your rider ready…</p> });
const hex = (value: number) => `#${value.toString(16).padStart(6, "0")}`;

export default function RiderLocker({ style, onChange, riderMode, stance, open, onToggle }: {
  style: RiderStyle; onChange(style: RiderStyle): void; riderMode: RiderMode; stance: SnowboardStance;
  open: boolean; onToggle(): void;
}) {
  const gearSlot = riderMode === "skier" ? "skis" : "board";
  return <section className="mt-5 border-y border-ink/20 text-left" aria-label="Rider locker">
    <button type="button" onClick={onToggle} aria-expanded={open} aria-controls="rider-locker-options" className="flex w-full items-center justify-between gap-3 py-4 text-ink">
      <span><span className="block font-bold">Style your rider</span><span className="mt-1 block text-xs text-bark-dk">{style.character === "yeti" ? "Yeti" : "Human"} · {OUTFITS[style.outfit].name} · {GEAR[style[gearSlot]].name} {gearSlot === "board" ? "board" : "skis"}</span></span>
      <ChevronDown aria-hidden="true" size={18} className={open ? "rotate-180" : ""} />
    </button>
    {open && <div id="rider-locker-options" className="pb-5">
      <div className="grid gap-4 sm:grid-cols-[.9fr_1.1fr]">
        <div className="overflow-hidden rounded-xl bg-cream-dk/60"><Preview style={style} riderMode={riderMode} stance={stance} /></div>
        <div className="space-y-5">
          <fieldset><legend className="mb-2 text-sm font-bold text-ink">Character</legend>
            <div className="flex gap-2">{(["yeti", "human"] as const).map(character => <button key={character} type="button" aria-pressed={style.character === character} onClick={() => onChange({ ...style, character })} className={`min-h-11 flex-1 rounded-lg border px-3 text-sm font-bold ${style.character === character ? "border-forest bg-forest text-cream-50" : "border-ink/25 text-ink hover:bg-cream-dk"}`}>{character === "yeti" ? "Yeti" : "Human"}</button>)}</div>
          </fieldset>
          <fieldset><legend className="mb-1 text-sm font-bold text-ink">Outfit</legend>
            {(Object.keys(OUTFITS) as OutfitId[]).map(id => <button key={id} type="button" aria-pressed={style.outfit === id} onClick={() => onChange({ ...style, outfit: id })} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-cream-dk/60">
              <span aria-hidden="true" className="flex h-8 w-8 shrink-0 overflow-hidden rounded-full border border-ink/25"><span className="w-2/3" style={{ backgroundColor: hex(OUTFITS[id].jacket) }} /><span className="w-1/3" style={{ backgroundColor: hex(OUTFITS[id].accent) }} /></span>
              <span className="flex-1 text-sm text-ink"><span className="block font-semibold">{OUTFITS[id].name}</span><span className="block text-xs text-bark-dk">{OUTFITS[id].description}</span></span>
              {style.outfit === id && <Check aria-hidden="true" size={16} className="text-forest" />}
            </button>)}
          </fieldset>
          <fieldset><legend className="mb-2 text-sm font-bold text-ink">{riderMode === "skier" ? "Ski graphics" : "Board graphics"}</legend>
            <div className="flex gap-1">{(Object.keys(GEAR) as GearId[]).map(id => <button key={id} type="button" aria-pressed={style[gearSlot] === id} onClick={() => onChange({ ...style, [gearSlot]: id })} className={`min-h-16 min-w-0 flex-1 rounded-lg border p-1 text-xs ${style[gearSlot] === id ? "border-forest bg-cream-dk/60 font-bold text-forest" : "border-transparent text-bark-dk hover:bg-cream-dk/60"}`}>
              <span aria-hidden="true" className="mx-auto mb-2 flex h-2 w-12 overflow-hidden rounded-full" style={{ backgroundColor: hex(GEAR[id].base) }}><span className="ml-auto w-1/3" style={{ backgroundColor: hex(GEAR[id].accent) }} /></span>{GEAR[id].name}
            </button>)}</div>
          </fieldset>
        </div>
      </div>
      <p className="mt-4 text-xs text-bark-dk">Your look, your line. Outfits and graphics don’t change handling. Choices stay on this device.</p>
    </div>}
  </section>;
}
