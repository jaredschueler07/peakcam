"use client";

import { useEffect, useState } from "react";

export type TouchPreferences = { hand: "left" | "right"; steering: "drag" | "buttons"; controls: "auto" | "touch" | "keyboard" };
const KEY = "drop-in-touch-preferences";
const DEFAULTS: TouchPreferences = { hand: "left", steering: "drag", controls: "auto" };

export function useTouchPreferences() {
  const [preferences, setPreferences] = useState<TouchPreferences>(DEFAULTS);
  const [hasTouch, setHasTouch] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(any-pointer: coarse)");
    const detect = () => setHasTouch(query.matches || navigator.maxTouchPoints > 0);
    const onTouch = (event: PointerEvent) => { if (event.pointerType === "touch") setHasTouch(true); };
    detect();
    query.addEventListener("change", detect);
    window.addEventListener("pointerdown", onTouch);
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate optional device preferences after SSR
      if (saved) setPreferences({
        hand: saved.hand === "right" ? "right" : "left",
        steering: saved.steering === "buttons" ? "buttons" : "drag",
        controls: ["touch", "keyboard"].includes(saved.controls) ? saved.controls : "auto",
      });
    } catch { /* Preferences are optional when storage is unavailable. */ }
    return () => { query.removeEventListener("change", detect); window.removeEventListener("pointerdown", onTouch); };
  }, []);
  const update = (next: TouchPreferences) => {
    setPreferences(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* Play still works without storage. */ }
  };
  return { preferences, update, touchEnabled: preferences.controls === "touch" || (preferences.controls === "auto" && hasTouch) };
}

export default function ControlSettings({ preferences, onChange }: { preferences: TouchPreferences; onChange(value: TouchPreferences): void }) {
  const selectClass = "mt-1 min-h-11 w-full min-w-0 rounded-lg border border-ink bg-cream-50 px-2 text-base text-ink";
  return <fieldset className="mt-4 space-y-3 text-left text-sm">
    <legend className="font-bold">Controls</legend>
    <label className="block">Input
      <select aria-label="Input" className={selectClass} value={preferences.controls} onChange={e => onChange({ ...preferences, controls: e.target.value as TouchPreferences["controls"] })}>
        <option value="auto">Automatic</option><option value="touch">Touch controls</option><option value="keyboard">Keyboard / controller</option>
      </select>
    </label>
    {preferences.controls !== "keyboard" && <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
      <label className="block min-w-0">Steering hand
        <select aria-label="Steering hand" className={selectClass} value={preferences.hand} onChange={e => onChange({ ...preferences, hand: e.target.value as TouchPreferences["hand"] })}>
          <option value="left">Left thumb</option><option value="right">Right thumb</option>
        </select>
      </label>
      <label className="block min-w-0">Steering style
        <select aria-label="Steering style" className={selectClass} value={preferences.steering} onChange={e => onChange({ ...preferences, steering: e.target.value as TouchPreferences["steering"] })}>
          <option value="drag">Drag anywhere</option><option value="buttons">Hold arrow buttons</option>
        </select>
      </label>
    </div>}
  </fieldset>;
}
