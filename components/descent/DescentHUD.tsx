"use client";

import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { DescentRuntime, HudSnapshot, World } from "@/lib/descent/types";
import TrailMapCanvas from "./TrailMapCanvas";
import { difficultyMeta, formatRunTime } from "./runtime-types";

export interface TrickToast { id: number; label: string; points: number }

const CHIP = "pointer-events-auto border border-[#2a323d] bg-[#0b0e13]/85 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[#e8edf2] hover:bg-[#e8edf2] hover:text-[#06080b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e8edf2]";

function DifficultyDot({ difficulty }: { difficulty: string | null }) {
  const meta = difficultyMeta(difficulty);
  return <span aria-label={meta.label} className="inline-block h-2 w-2 rounded-full" style={{ background: meta.color }} />;
}

function TopStrip({ store, resortName, onHelp, onHint, onMap, onFullscreen }: {
  store: StoreApi<HudSnapshot>; resortName: string; onHelp(): void; onHint(): void; onMap(): void; onFullscreen(): void;
}) {
  const courseName = useStore(store, (s) => s.courseName);
  const trailHint = useStore(store, (s) => s.trailHint);
  return (
    <div className="pointer-events-none absolute left-2 top-2 flex flex-nowrap items-center gap-1 font-mono sm:left-3 sm:top-3">
      <span className="max-w-[60vw] truncate border border-[#2a323d] bg-[#0b0e13]/85 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#e8edf2] sm:max-w-none">
        <span className="text-[#7f8b99]">{resortName}</span>{" // "}{courseName}
      </span>
      <button type="button" className={`${CHIP} hidden sm:inline-block`} onClick={onFullscreen} aria-label="Toggle fullscreen">Full</button>
      <button type="button" className={`${CHIP} hidden sm:inline-block`} onClick={onHelp} aria-label="Controls">H</button>
      <button type="button" className={`${CHIP} ${trailHint ? "bg-[#e8edf2] text-[#06080b]" : ""}`} onClick={onHint} aria-pressed={trailHint} aria-label="Trail hint line">Hint</button>
      <button type="button" className={CHIP} onClick={onMap} aria-label="Trail map">Map</button>
    </div>
  );
}

function Speed({ store }: { store: StoreApi<HudSnapshot> }) {
  const speed = useStore(store, (s) => s.speedKmh);
  const tucked = useStore(store, (s) => s.tucked);
  const braking = useStore(store, (s) => s.braking);
  const airborne = useStore(store, (s) => s.airborne);
  const crashed = useStore(store, (s) => s.crashed);
  const badge = crashed ? "CRASH" : airborne ? "AIR" : tucked ? "TUCK" : braking ? "BRAKE" : null;
  return (
    <div className="font-mono">
      <div className="h-4">
        {badge && (
          <span className={`inline-block px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] ${crashed ? "bg-[#ff6b57] text-[#06080b]" : airborne ? "bg-[#ffe08a] text-[#06080b]" : "bg-[#3ea0ff] text-[#06080b]"}`}>{badge}</span>
        )}
      </div>
      <div className="mt-1 flex items-end gap-1 border border-[#2a323d] bg-[#0b0e13]/85 px-2 py-1">
        <span className="text-3xl font-bold leading-none tabular-nums text-[#e8edf2] sm:text-4xl">{speed}</span>
        <span className="pb-0.5 text-[9px] uppercase tracking-[0.16em] text-[#7f8b99]">km/h</span>
      </div>
    </div>
  );
}

/** Shows once the rider has been standing still for a while: at the gate, or after a crash-stop. */
function StillPrompt({ store }: { store: StoreApi<HudSnapshot> }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let armed = false;
    const check = (s: HudSnapshot) => {
      const still = s.phase === "riding" && s.speedKmh === 0 && !s.crashed && s.liftRiding === null;
      if (still && !armed) { armed = true; timer = setTimeout(() => setShow(true), 1500); }
      else if (!still && armed) { armed = false; if (timer) clearTimeout(timer); timer = null; setShow(false); }
    };
    const unsubscribe = store.subscribe(check);
    // The store may already be still: arm from a callback, not synchronously.
    timer = setTimeout(() => check(store.getState()), 0);
    return () => { unsubscribe(); if (timer) clearTimeout(timer); };
  }, [store]);
  if (!show) return null;
  return <p className="descent-pulse mt-1 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-[#e8edf2]" style={{ textShadow: "0 1px 6px rgba(0,0,0,.6)" }}>Press any control to drop in</p>;
}

function CourseBar({ store, world }: { store: StoreApi<HudSnapshot>; world: World }) {
  const progress = useStore(store, (s) => s.progress);
  const runTime = useStore(store, (s) => s.runTime);
  const courseName = useStore(store, (s) => s.courseName);
  const course = world.courses.find((c) => c.name === courseName) ?? world.courses[0];
  const gates = course ? course.gates.map((g) => g.distanceM / Math.max(1, course.lengthM)) : [];
  return (
    <div className="mt-1 w-40 border border-[#2a323d] bg-[#0b0e13]/85 px-2 py-1 font-mono sm:w-52">
      <div className="flex items-center justify-between text-[9px] uppercase tracking-[0.14em] text-[#7f8b99]">
        <span><span className="sm:hidden">Gate</span><span className="hidden sm:inline">Start gate</span></span>
        <span className="tabular-nums text-[#e8edf2]">{formatRunTime(runTime)}</span>
        <span><span className="sm:hidden">Fin</span><span className="hidden sm:inline">Finish</span></span>
      </div>
      <div className="relative mt-1 h-1.5 bg-[#1b222b]">
        {gates.map((g, i) => (
          <span key={i} className="absolute top-0 h-full w-px bg-[#7f8b99]/70" style={{ left: `${g * 100}%` }} />
        ))}
        <div className="h-full bg-[#e8edf2] transition-[width] duration-150" style={{ width: `${Math.min(100, progress * 100)}%` }} />
      </div>
    </div>
  );
}

function Style({ store, toasts }: { store: StoreApi<HudSnapshot>; toasts: TrickToast[] }) {
  const style = useStore(store, (s) => s.style);
  const combo = useStore(store, (s) => s.combo);
  return (
    <div className="pointer-events-none absolute right-2 top-2 flex flex-col items-end gap-1 font-mono sm:right-3 sm:top-3">
      <div className="border border-[#2a323d] bg-[#0b0e13]/85 px-2 py-1 text-right">
        <div className="text-[9px] uppercase tracking-[0.16em] text-[#7f8b99]">Style</div>
        <div className="text-xl font-bold leading-none tabular-nums text-[#e8edf2] sm:text-2xl">{style.toLocaleString()}</div>
        {combo > 1 && <div className="mt-0.5 text-[10px] font-bold text-[#ffe08a]">×{combo} combo</div>}
      </div>
      <ul className="space-y-1" aria-live="polite">
        {toasts.map((t) => (
          <li key={t.id} className="descent-toast border border-[#ffe08a]/60 bg-[#0b0e13]/90 px-2 py-1 text-right text-[11px] font-bold uppercase tracking-[0.12em] text-[#ffe08a]">
            {t.label} <span className="text-[#e8edf2]">+{t.points}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CentreMessages({ store, statusToast }: { store: StoreApi<HudSnapshot>; statusToast: string | null }) {
  const junction = useStore(store, (s) => s.junction);
  const liftPrompt = useStore(store, (s) => s.liftPrompt);
  const liftRiding = useStore(store, (s) => s.liftRiding);
  const runtimeToast = useStore(store, (s) => s.toast);
  const toast = statusToast ?? runtimeToast;
  return (
    <div className="pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 flex-col items-center gap-1.5 font-mono">
      {toast && <div className="descent-toast border border-[#2a323d] bg-[#0b0e13]/85 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.18em] text-[#e8edf2]">{toast}</div>}
      {junction && junction.length > 0 && (
        <div className="border border-[#e8edf2]/60 bg-[#0b0e13]/85 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#e8edf2]">
          {junction.map((j, i) => (
            <span key={j.name}>
              {i > 0 && <span className="mx-2 text-[#7f8b99]">·</span>}
              <DifficultyDot difficulty={j.difficulty} /> <span className="ml-1">{j.name}</span>
            </span>
          ))}
        </div>
      )}
      {liftPrompt && (
        <div className="border border-[#3ad686]/70 bg-[#0b0e13]/85 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#3ad686]">
          <kbd className="mr-1 rounded-sm border border-[#3ad686]/70 px-1">E</kbd> Ride {liftPrompt}
        </div>
      )}
      {liftRiding && (
        <div className="w-44 border border-[#2a323d] bg-[#0b0e13]/85 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[#e8edf2]">
          Riding {liftRiding.name}
          <div className="mt-1 h-1 bg-[#1b222b]"><div className="h-full bg-[#3ad686]" style={{ width: `${liftRiding.progress * 100}%` }} /></div>
        </div>
      )}
    </div>
  );
}

function TrailLine({ store }: { store: StoreApi<HudSnapshot> }) {
  const trailName = useStore(store, (s) => s.trailName);
  const surface = useStore(store, (s) => s.surface);
  const onTrail = useStore(store, (s) => s.onTrail);
  return (
    <div className="max-w-[60vw] truncate border border-[#2a323d] bg-[#0b0e13]/85 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#e8edf2]">
      {onTrail && trailName ? trailName : "Off piste"} <span className="text-[#7f8b99]">· {surface}</span>
    </div>
  );
}

function Vertical({ store }: { store: StoreApi<HudSnapshot> }) {
  const verticalFt = useStore(store, (s) => s.verticalFt);
  const altitudeFt = useStore(store, (s) => s.altitudeFt);
  const trailName = useStore(store, (s) => s.trailName);
  const surface = useStore(store, (s) => s.surface);
  const onTrail = useStore(store, (s) => s.onTrail);
  return (
    <div className="border border-[#2a323d] bg-[#0b0e13]/85 px-2 py-1 font-mono text-right text-[10px] uppercase tracking-[0.14em] text-[#7f8b99]">
      <div><span className="text-[#e8edf2]">{Math.round(verticalFt).toLocaleString()}</span> ft down</div>
      <div><span className="text-[#e8edf2]">{Math.round(altitudeFt).toLocaleString()}</span> ft alt</div>
      <div className="mt-0.5 truncate text-[#e8edf2]">{onTrail && trailName ? trailName : "Off piste"} <span className="text-[#7f8b99]">· {surface}</span></div>
    </div>
  );
}

function Minimap({ store, world, accent }: { store: StoreApi<HudSnapshot>; world: World; accent: string }) {
  const x = useStore(store, (s) => Math.round(s.x / 4) * 4);
  const z = useStore(store, (s) => Math.round(s.z / 4) * 4);
  const yaw = useStore(store, (s) => Math.round(s.travelYaw * 8) / 8);
  const courseName = useStore(store, (s) => s.courseName);
  const selected = Math.max(0, world.courses.findIndex((c) => c.name === courseName));
  return <TrailMapCanvas world={world} selected={selected} accent={accent} rider={{ x, z, yaw }} size={150} followRadiusM={600} />;
}

export default function DescentHUD({ runtime, toasts, statusToast, touch, onHelp, onMap, onFullscreen }: {
  runtime: DescentRuntime;
  toasts: TrickToast[];
  statusToast: string | null;
  touch: boolean;
  onHelp(): void;
  onMap(): void;
  onFullscreen(): void;
}) {
  const store = runtime.hud;
  const world = runtime.world;
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <TopStrip store={store} resortName={world.profile.name} onHelp={onHelp} onHint={() => runtime.toggleTrailHint()} onMap={onMap} onFullscreen={onFullscreen} />
      <Style store={store} toasts={toasts} />
      <CentreMessages store={store} statusToast={statusToast} />
      <div className={`absolute left-2 sm:left-3 ${touch ? "bottom-40" : "bottom-2 sm:bottom-3"}`}>
        <Speed store={store} />
        <CourseBar store={store} world={world} />
        {!touch && <StillPrompt store={store} />}
      </div>
      {touch ? (
        <div className="absolute left-2 top-9 sm:left-3 sm:top-10"><TrailLine store={store} /></div>
      ) : (
        <div className="absolute bottom-2 right-2 flex flex-col items-end gap-1.5 sm:bottom-3 sm:right-3">
          <div className="hidden sm:block"><Minimap store={store} world={world} accent={world.profile.accent} /></div>
          <Vertical store={store} />
        </div>
      )}
    </div>
  );
}
