"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useDialogFocus } from "@/components/drop-in/hud/useDialogFocus";

type Tab = "keyboard" | "touch" | "gamepad";

interface Row { keys: string[]; label: string; note?: string; style?: string }
interface Section { title: string; rows: Row[] }

const KEYBOARD: Section[] = [
  {
    title: "Movement & steering",
    rows: [
      { keys: ["A", "D", "◀", "▶"], label: "Carve & Steer", note: "Air: 360 spins" },
      { keys: ["W", "▲"], label: "Speed Tuck", note: "Air: Frontflip" },
      { keys: ["S", "▼"], label: "Brake & Power Smear", note: "Air: Backflip" },
      { keys: ["BOARD"], label: "Snowboard: A/D = heelside / toeside edge; grabs become Indy · Method · Tail · Nose" },
    ],
  },
  {
    title: "Pop & propulsion",
    rows: [
      { keys: ["SPACE"], label: "Hold: crouch // Release: pop", note: "Air: fast spin" },
      { keys: ["W"], label: "Skate on the flats — hold forward and the rider pushes" },
    ],
  },
  {
    title: "Freestyle aerial grabs",
    rows: [
      { keys: ["J"], label: "Mute Grab", style: "+250" },
      { keys: ["K"], label: "Spread Eagle", style: "+300" },
      { keys: ["L"], label: "Daffy", style: "+350" },
      { keys: ["I"], label: "Twister", style: "+450" },
    ],
  },
  {
    title: "Shortcuts & camera",
    rows: [
      { keys: ["R"], label: "Reset to checkpoint" },
      { keys: ["E"], label: "Ride the lift" },
      { keys: ["V"], label: "Trail hint line" },
      { keys: ["C"], label: "Camera perspective" },
      { keys: ["N"], label: "Weather" },
      { keys: ["T"], label: "Trail map" },
      { keys: ["F"], label: "Fullscreen" },
      { keys: ["M"], label: "Audio mute" },
      { keys: ["H"], label: "This card" },
      { keys: ["ESC"], label: "Pause" },
    ],
  },
];

const TOUCH: Section[] = [
  { title: "Steering pad", rows: [{ keys: ["DRAG"], label: "Slide left / right on the pad to carve. In the air the same drag spins." }] },
  { title: "Buttons", rows: [
    { keys: ["TUCK"], label: "Hold to tuck. Air: frontflip." },
    { keys: ["BRAKE"], label: "Hold to smear and slow. Air: backflip." },
    { keys: ["JUMP"], label: "Hold to crouch, release to pop." },
    { keys: ["GRAB"], label: "Hold in the air for a mute grab." },
    { keys: ["LIFT"], label: "Board a lift when the prompt shows." },
  ] },
];

const GAMEPAD: Section[] = [
  { title: "Standard mapping", rows: [
    { keys: ["L-STICK"], label: "Carve & steer", note: "Air: spin" },
    { keys: ["RT"], label: "Tuck", note: "Air: frontflip" },
    { keys: ["LT"], label: "Brake & smear", note: "Air: backflip" },
    { keys: ["A"], label: "Hold: crouch // Release: pop" },
    { keys: ["X", "Y", "B"], label: "Grabs" },
    { keys: ["START"], label: "Pause" },
  ] },
];

const TABS: { id: Tab; label: string; sections: Section[] }[] = [
  { id: "keyboard", label: "Keyboard / PC", sections: KEYBOARD },
  { id: "touch", label: "Mobile / Touch", sections: TOUCH },
  { id: "gamepad", label: "Gamepad", sections: GAMEPAD },
];

export default function ControlsCard({ open, onClose, initialTab }: { open: boolean; onClose(): void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab ?? "keyboard");
  const ref = useDialogFocus(open);
  if (!open) return null;
  const active = TABS.find((t) => t.id === tab) ?? TABS[0];
  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-black/55 p-3" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="descent-controls-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto border border-[#1b222b] bg-[#0b0e13] p-4 font-mono text-[#e8edf2] shadow-[0_24px_60px_-20px_rgba(0,0,0,.8)] sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="descent-controls-title" className="text-lg font-bold uppercase tracking-[0.16em]">Controls & stance</h2>
            <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-[#7f8b99]">Press H in a run to open this card</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close controls" className="grid h-9 w-9 place-items-center border border-[#1b222b] text-[#7f8b99] hover:text-[#e8edf2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e8edf2]">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Input device">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e8edf2] ${tab === t.id ? "border-[#e8edf2] bg-[#e8edf2] text-[#06080b]" : "border-[#1b222b] text-[#7f8b99] hover:text-[#e8edf2]"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {active.sections.map((section) => (
            <section key={section.title} className="border border-[#1b222b] p-3">
              <h3 className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#7f8b99]">{section.title}</h3>
              <ul className="mt-2 space-y-1.5">
                {section.rows.map((row) => (
                  <li key={row.label} className="flex items-start justify-between gap-3 text-xs">
                    <span className="flex shrink-0 flex-wrap gap-1">
                      {row.keys.map((k) => (
                        <kbd key={k} className="rounded-sm border border-[#2a323d] bg-[#12161d] px-1.5 py-0.5 text-[10px] font-bold">{k}</kbd>
                      ))}
                    </span>
                    <span className="text-right leading-snug">
                      {row.label}
                      {row.note && <span className="ml-1 text-[#7f8b99]">({row.note})</span>}
                      {row.style && <span className="ml-2 rounded-sm bg-[#16351f] px-1.5 py-0.5 text-[10px] font-bold text-[#3ad686]">Style {row.style}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
