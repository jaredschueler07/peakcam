"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import type { CameraPreset, ConditionsSnapshot, DescentRuntime, RiderStyle, World } from "@/lib/descent/types";
import { CAMERA_PRESETS } from "@/lib/descent/types";
import type { CompetitiveRunMode } from "@/lib/game/config/modes";
import { GEAR, OUTFITS, type GearId, type OutfitId, type RiderCharacter } from "@/lib/game/config/rider-style";
import type { RiderMode, SnowboardStance } from "@/lib/game/core/config";
import TrailMapCanvas from "./TrailMapCanvas";
import { difficultyMeta } from "./runtime-types";

export type MenuPanel = "ski" | "map" | "controls" | "settings" | null;
export type ModeChoice = "free_ski" | CompetitiveRunMode;

const ITEMS: { id: Exclude<MenuPanel, null>; label: string }[] = [
  { id: "ski", label: "Ski now" },
  { id: "map", label: "Trail map" },
  { id: "controls", label: "Controls" },
  { id: "settings", label: "Settings" },
];

const MODES: { mode: ModeChoice; title: string; blurb: string }[] = [
  { mode: "free_ski", title: "Free Ski", blurb: "No clock, no board. The whole mountain." },
  { mode: "time_trial", title: "Time Trial", blurb: "Fixed line, fixed seed. Chase the record." },
  { mode: "score_attack", title: "Daily Line", blurb: "One course a day, same for everyone." },
];

const PANEL = "pointer-events-auto max-h-[calc(100vh-1.5rem)] w-full max-w-md overflow-y-auto border border-[#1b222b] bg-[#0b0e13]/92 p-4 font-mono text-[#e8edf2] backdrop-blur-sm sm:max-w-lg";
const LABEL = "text-[10px] font-bold uppercase tracking-[0.18em] text-[#7f8b99]";
const OPTION = "border px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e8edf2]";
const optionClass = (active: boolean) => `${OPTION} ${active ? "border-[#e8edf2] bg-[#e8edf2] text-[#06080b]" : "border-[#2a323d] text-[#7f8b99] hover:text-[#e8edf2]"}`;

export interface SessionUi {
  mode: ModeChoice;
  pending: boolean;
  notice: string | null;
  onSelectMode(mode: ModeChoice): void;
}

export interface SettingsUi {
  audio: boolean;
  onAudio(enabled: boolean): void;
  camera: CameraPreset;
  onCamera(preset: CameraPreset): void;
  weatherIndex: number;
  onWeather(index: number): void;
  touch: boolean | null;
  onTouch(value: boolean | null): void;
  lowQuality: boolean;
  onQuality(low: boolean): void;
}

function verticalFt(world: World, index: number): number {
  const c = world.courses[index];
  return c ? Math.max(0, (c.topElevationM - c.bottomElevationM) * 3.28084) : 0;
}

function CourseLine({ world, index }: { world: World; index: number }) {
  const c = world.courses[index];
  if (!c) return null;
  const meta = difficultyMeta(c.difficulty);
  return (
    <span>
      <span className="text-[#e8edf2]">{c.name}</span>
      <span className="text-[#7f8b99]"> · </span><span style={{ color: meta.color }}>{meta.label}</span>
      <span className="text-[#7f8b99]"> · {Math.round(c.lengthM)} m · {Math.round(verticalFt(world, index))} ft vert</span>
    </span>
  );
}

export default function DescentMenu({ runtime, conditions, panel, onPanel, session, riderStyle, onRiderStyle, riderMode, onRiderMode, stance, onStance, onDropIn, settings }: {
  runtime: DescentRuntime;
  conditions: ConditionsSnapshot;
  panel: MenuPanel;
  onPanel(panel: MenuPanel): void;
  session: SessionUi;
  riderStyle: RiderStyle;
  onRiderStyle(style: RiderStyle): void;
  riderMode: RiderMode;
  onRiderMode(mode: RiderMode): void;
  stance: SnowboardStance;
  onStance(stance: SnowboardStance): void;
  onDropIn(): void;
  settings: SettingsUi;
}) {
  const world = runtime.world;
  const profile = world.profile;
  const [highlight, setHighlight] = useState(0);
  const [query, setQuery] = useState("");
  // Subscribing to the course name re-renders this menu when the runtime changes line.
  useStore(runtime.hud, (s) => s.courseName);
  const selected = runtime.courseIndex;

  // Keyboard menu navigation while no panel is open.
  useEffect(() => {
    if (panel !== null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => (h + 1) % ITEMS.length); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => (h + ITEMS.length - 1) % ITEMS.length); }
      else if (e.key === "Enter") { e.preventDefault(); onPanel(ITEMS[highlight].id); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, highlight, onPanel]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return world.courses.map((c, i) => ({ c, i })).filter(({ c }) => !q || c.name.toLowerCase().includes(q));
  }, [world, query]);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col font-mono sm:flex-row">
      <div className="flex shrink-0 flex-col p-4 sm:w-72 sm:p-6">
        <div className="pointer-events-auto">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#7f8b99]">PeakCam Drop In</p>
          <h1 className="mt-1 text-3xl font-bold uppercase leading-none tracking-[0.04em] text-[#e8edf2] sm:text-4xl">
            {profile.name}
          </h1>
          <p className="mt-1 text-[9px] uppercase tracking-[0.2em] text-[#e8edf2]/80">{profile.tagline}</p>
        </div>

        <nav aria-label="Main menu" className="pointer-events-auto mt-8 flex flex-col items-start gap-2 sm:mt-16">
          {ITEMS.map((item, i) => {
            const active = panel === item.id || (panel === null && highlight === i);
            return (
              <button
                key={item.id}
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onFocus={() => setHighlight(i)}
                onClick={() => onPanel(panel === item.id ? null : item.id)}
                className={`px-3 py-1 text-base font-bold uppercase tracking-[0.18em] transition-colors focus-visible:outline-none ${active ? "bg-[#e8edf2] text-[#06080b] shadow-[4px_4px_0_rgba(232,237,242,.25)]" : "text-[#e8edf2] hover:text-white"}`}
              >
                {item.label}
              </button>
            );
          })}
          <Link href={`/resorts/${profile.slug}`} className="mt-3 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-[#7f8b99] hover:text-[#e8edf2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e8edf2]">
            ← Back to conditions
          </Link>
        </nav>

        <div className="pointer-events-auto mb-16 mt-auto pt-6 text-[10px] uppercase tracking-[0.14em] text-[#e8edf2]">
          <p className="font-bold">{conditions.stamp}</p>
          {(conditions.baseDepthIn !== null || conditions.snow24In !== null) && (
            <p>{conditions.baseDepthIn !== null && `Base ${conditions.baseDepthIn}"`}{conditions.baseDepthIn !== null && conditions.snow24In !== null && " · "}{conditions.snow24In !== null && `24h ${conditions.snow24In}"`}</p>
          )}
          <p className="mt-1 normal-case tracking-normal"><CourseLine world={world} index={selected} /></p>
        </div>
      </div>

      {panel === "ski" && (
        <div className="flex flex-1 items-start p-3 sm:items-center sm:p-6">
          <section className={PANEL} aria-label="Ski now">
            <p className={LABEL}>Choose your run</p>
            <div role="radiogroup" aria-label="Run mode" className="mt-2 grid gap-2 sm:grid-cols-3">
              {MODES.map((m) => (
                <button key={m.mode} type="button" role="radio" aria-checked={session.mode === m.mode} onClick={() => session.onSelectMode(m.mode)} className={`border p-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e8edf2] ${session.mode === m.mode ? "border-[#e8edf2] bg-[#e8edf2] text-[#06080b]" : "border-[#2a323d] text-[#e8edf2] hover:border-[#7f8b99]"}`}>
                  <span className="block text-sm font-bold uppercase tracking-[0.12em]">{m.title}</span>
                  <span className={`mt-1 block text-[10px] ${session.mode === m.mode ? "text-[#06080b]/70" : "text-[#7f8b99]"}`}>{m.blurb}</span>
                  {session.pending && session.mode === m.mode && m.mode !== "free_ski" && <span role="status" className="mt-1 block text-[9px] uppercase tracking-[0.14em]">Reserving run…</span>}
                </button>
              ))}
            </div>
            {session.notice && <p role="status" className="mt-2 border border-[#ffe08a]/60 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[#ffe08a]">{session.notice}</p>}

            <p className={`${LABEL} mt-4`}>Line</p>
            <p className="mt-1 text-xs"><CourseLine world={world} index={selected} /></p>
            <button type="button" onClick={() => onPanel("map")} className={`${optionClass(false)} mt-2`}>Change line on the trail map</button>

            <p className={`${LABEL} mt-4`}>Rider</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(["yeti", "human"] as RiderCharacter[]).map((c) => (
                <button key={c} type="button" className={optionClass(riderStyle.character === c)} onClick={() => onRiderStyle({ ...riderStyle, character: c })}>{c}</button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(Object.keys(OUTFITS) as OutfitId[]).map((o) => (
                <button key={o} type="button" className={optionClass(riderStyle.outfit === o)} onClick={() => onRiderStyle({ ...riderStyle, outfit: o })}>
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: `#${OUTFITS[o].jacket.toString(16).padStart(6, "0")}` }} />{OUTFITS[o].name}
                </button>
              ))}
            </div>
            <p className={`${LABEL} mt-3`}>Gear</p>
            <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Gear">
              <button type="button" role="radio" aria-checked={riderMode === "skier"} className={optionClass(riderMode === "skier")} onClick={() => onRiderMode("skier")}>Skis</button>
              <button type="button" role="radio" aria-checked={riderMode === "snowboarder"} className={optionClass(riderMode === "snowboarder")} onClick={() => onRiderMode("snowboarder")}>Snowboard</button>
            </div>
            {riderMode === "snowboarder" && (
              <>
                <p className={`${LABEL} mt-3`}>Stance</p>
                <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Stance">
                  <button type="button" role="radio" aria-checked={stance === "regular"} className={optionClass(stance === "regular")} onClick={() => onStance("regular")}>Regular</button>
                  <button type="button" role="radio" aria-checked={stance === "goofy"} className={optionClass(stance === "goofy")} onClick={() => onStance("goofy")}>Goofy</button>
                </div>
              </>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(Object.keys(GEAR) as GearId[]).map((g) => (
                <button key={g} type="button" className={optionClass(riderStyle.skis === g)} onClick={() => onRiderStyle({ ...riderStyle, skis: g, board: g })}>
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: `#${GEAR[g].base.toString(16).padStart(6, "0")}` }} />{GEAR[g].name} {riderMode === "snowboarder" ? "board" : "skis"}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={onDropIn}
              data-testid="descent-drop-in"
              className="mt-5 w-full border-2 border-[#e8edf2] bg-[#e8edf2] py-3 text-base font-bold uppercase tracking-[0.24em] text-[#06080b] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0e13] focus-visible:ring-[#e8edf2]"
              style={{ boxShadow: `5px 5px 0 ${profile.accent}` }}
            >
              Drop in
            </button>
          </section>
        </div>
      )}

      {panel === "map" && (
        <div className="flex flex-1 items-start p-3 sm:p-6">
          <section className={`${PANEL} sm:max-w-3xl lg:max-w-4xl`} aria-label="Trail map">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className={LABEL}>Trail map explorer · {world.courses.length} lines</p>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search trails…"
                aria-label="Search trails"
                className="border border-[#2a323d] bg-[#06080b] px-2 py-1 text-xs text-[#e8edf2] placeholder:text-[#7f8b99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e8edf2]"
              />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-[320px_minmax(0,1fr)]">
              <TrailMapCanvas world={world} selected={selected} accent={profile.accent} size={320} className="mx-auto max-w-full" />
              <ul className="max-h-[52vh] space-y-px overflow-y-auto" role="listbox" aria-label="Lines">
                {filtered.map(({ c, i }) => {
                  const meta = difficultyMeta(c.difficulty);
                  const active = i === selected;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => runtime.setCourse(i)}
                        className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e8edf2] ${active ? "bg-[#e8edf2] text-[#06080b]" : "text-[#e8edf2] hover:bg-[#1b222b]"}`}
                      >
                        <span className="inline-block h-2.5 w-2.5 shrink-0" style={{ background: meta.color, borderRadius: meta.shape === "circle" ? 999 : meta.shape === "diamond" || meta.shape === "double" ? 1 : 2, transform: meta.shape === "diamond" || meta.shape === "double" ? "rotate(45deg)" : undefined, outline: meta.shape === "double" ? `1px solid ${meta.color}` : undefined, outlineOffset: 2 }} />
                        <span className="min-w-0 flex-1 font-bold leading-tight [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
                          {c.name}
                          <span className={`ml-1.5 hidden font-normal sm:inline ${active ? "text-[#06080b]/60" : "text-[#7f8b99]"}`}>{meta.label}</span>
                          {i < 6 && <span className={`ml-1 text-[9px] uppercase ${active ? "text-[#06080b]/60" : "text-[#7f8b99]"}`}>featured</span>}
                        </span>
                        <span className={`shrink-0 tabular-nums ${active ? "text-[#06080b]/70" : "text-[#7f8b99]"}`}>{Math.round(c.lengthM)} m · {Math.round(verticalFt(world, i))} ft</span>
                      </button>
                    </li>
                  );
                })}
                {filtered.length === 0 && <li className="px-2 py-2 text-xs text-[#7f8b99]">No trail matches “{query}”.</li>}
              </ul>
            </div>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => onPanel("ski")} className={`${optionClass(true)}`}>Ski this line</button>
              <button type="button" onClick={() => onPanel(null)} className={optionClass(false)}>Close</button>
            </div>
          </section>
        </div>
      )}

      {panel === "settings" && (
        <div className="flex flex-1 items-start p-3 sm:items-center sm:p-6">
          <section className={PANEL} aria-label="Settings">
            <p className={LABEL}>Audio</p>
            <div className="mt-2 flex gap-1.5">
              <button type="button" className={optionClass(settings.audio)} onClick={() => settings.onAudio(true)}>On</button>
              <button type="button" className={optionClass(!settings.audio)} onClick={() => settings.onAudio(false)}>Muted</button>
            </div>
            <p className={`${LABEL} mt-4`}>Camera</p>
            <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Camera preset">
              {CAMERA_PRESETS.map((p) => (
                <button key={p} type="button" role="radio" aria-checked={settings.camera === p} className={optionClass(settings.camera === p)} onClick={() => settings.onCamera(p)}>{p}</button>
              ))}
            </div>
            <p className={`${LABEL} mt-4`}>Weather</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {profile.weather.map((w, i) => (
                <button key={w.name} type="button" className={optionClass(settings.weatherIndex === i)} onClick={() => settings.onWeather(i)}>{w.name}</button>
              ))}
            </div>
            <p className={`${LABEL} mt-4`}>Touch controls</p>
            <div className="mt-2 flex gap-1.5">
              <button type="button" className={optionClass(settings.touch === null)} onClick={() => settings.onTouch(null)}>Auto</button>
              <button type="button" className={optionClass(settings.touch === true)} onClick={() => settings.onTouch(true)}>On</button>
              <button type="button" className={optionClass(settings.touch === false)} onClick={() => settings.onTouch(false)}>Off</button>
            </div>
            <p className={`${LABEL} mt-4`}>Graphics</p>
            <div className="mt-2 flex gap-1.5">
              <button type="button" className={optionClass(!settings.lowQuality)} onClick={() => settings.onQuality(false)}>Auto</button>
              <button type="button" className={optionClass(settings.lowQuality)} onClick={() => settings.onQuality(true)}>Low</button>
            </div>
            <p className="mt-2 text-[10px] text-[#7f8b99]">Quality changes apply on the next load.</p>
            <button type="button" onClick={() => onPanel(null)} className={`${optionClass(false)} mt-5`}>Close</button>
          </section>
        </div>
      )}
    </div>
  );
}
