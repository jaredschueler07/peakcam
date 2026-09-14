"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import type { ResortGameProfile } from "@/lib/game/config/schema";
import type { ConditionsSnapshot } from "@/lib/game/conditions";
import type { CourseChoice } from "@/lib/game/config/course-choices";
import type { CameraPreset, DescentEvent, DescentRuntime, RiderStyle } from "@/lib/descent/types";
import { EVENTS, track } from "@/lib/analytics-events";
import { DEFAULT_RIDER_STYLE, readRiderStyle, saveRiderStyle } from "@/lib/game/config/rider-style";
import type { RiderMode, SnowboardStance } from "@/lib/game/core/config";
import { isRunSessionFailure, requestRunSession, type RunSessionTicket } from "@/lib/game/competition/session-client";
import { NO_TICKET, usableTicket, type TicketState } from "@/lib/game/competition/ticket-lifecycle";
import { freezeConditions } from "@/lib/game/competition/freeze-conditions";
import type { SubmittableRunSession } from "@/lib/game/competition/run-client";
import type { DecodedGhost } from "@/lib/game/replay/codec";
import { useDialogFocus } from "@/components/drop-in/hud/useDialogFocus";
import ControlsCard from "./ControlsCard";
import DescentHUD, { type TrickToast } from "./DescentHUD";
import DescentMenu, { type MenuPanel, type ModeChoice } from "./DescentMenu";
import ResultsCard, { type RunSummary } from "./ResultsCard";
import TouchControls from "./TouchControls";
import TrailMapCanvas from "./TrailMapCanvas";
import {
  AUDIO_STORAGE_KEY, CAMERA_STORAGE_KEY, QUALITY_STORAGE_KEY, RIDER_MODE_STORAGE_KEY, STANCE_STORAGE_KEY, TOUCH_STORAGE_KEY,
  readStorage, shellInput, writeStorage, type Hotkey,
} from "./runtime-types";

type Boot = { phase: "boot"; lines: string[] } | { phase: "ready" } | { phase: "error"; message: string };

const OFFLINE_NOTICE = "Leaderboard unavailable — playing offline";
const PHYSICS_MODEL = "v2" as const;

function BootLog({ lines }: { lines: string[] }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-30 p-4 font-mono text-[11px] leading-5 text-[#7f8b99]" role="status" aria-live="polite">
      {lines.map((line, i) => (
        <p key={i} className={i === lines.length - 1 ? "text-[#e8edf2]" : ""}>:: {line}</p>
      ))}
    </div>
  );
}

function PauseDialog({ open, onResume, onRestart, onMenu, onControls }: { open: boolean; onResume(): void; onRestart(): void; onMenu(): void; onControls(): void }) {
  const ref = useDialogFocus(open);
  if (!open) return null;
  const btn = "block w-full border px-4 py-2 text-left font-mono text-[11px] font-bold uppercase tracking-[0.16em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e8edf2]";
  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-4">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="descent-pause-title" tabIndex={-1} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onResume(); } }} className="w-full max-w-xs border border-[#1b222b] bg-[#0b0e13] p-4 text-[#e8edf2]">
        <h2 id="descent-pause-title" className="font-mono text-lg font-bold uppercase tracking-[0.16em]">Paused</h2>
        <div className="mt-3 space-y-1.5">
          <button type="button" className={`${btn} border-[#e8edf2] bg-[#e8edf2] text-[#06080b]`} onClick={onResume}>Resume</button>
          <button type="button" className={`${btn} border-[#2a323d] hover:border-[#e8edf2]`} onClick={onRestart}>Restart</button>
          <button type="button" className={`${btn} border-[#2a323d] hover:border-[#e8edf2]`} onClick={onControls}>Controls</button>
          <button type="button" className={`${btn} border-[#2a323d] text-[#7f8b99] hover:text-[#e8edf2]`} onClick={onMenu}>Back to menu</button>
        </div>
      </div>
    </div>
  );
}

export default function DescentGame({ profile, conditions }: {
  profile: ResortGameProfile;
  conditions: ConditionsSnapshot;
  courseChoices: readonly CourseChoice[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [runtime, setRuntime] = useState<DescentRuntime | null>(null);
  const runtimeRef = useRef<DescentRuntime | null>(null);
  const [boot, setBoot] = useState<Boot>({ phase: "boot", lines: [] });
  const [generation, setGeneration] = useState(0);

  const [riderStyle, setRiderStyle] = useState<RiderStyle>(DEFAULT_RIDER_STYLE);
  const [riderMode, setRiderMode] = useState<RiderMode>("skier");
  const [stance, setStance] = useState<SnowboardStance>("regular");
  const [audio, setAudio] = useState(true);
  const [camera, setCamera] = useState<CameraPreset>("chase");
  const [weatherIndex, setWeatherIndex] = useState<number>(conditions.weatherDefault);
  const [touchPref, setTouchPref] = useState<boolean | null>(null);
  const [lowQuality, setLowQuality] = useState(false);
  const [touchDevice, setTouchDevice] = useState(false);

  const [panel, setPanel] = useState<MenuPanel>(null);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [toasts, setToasts] = useState<TrickToast[]>([]);
  const [statusToast, setStatusToast] = useState<string | null>(null);
  const [results, setResults] = useState<RunSummary | null>(null);
  const [racedRunId, setRacedRunId] = useState<string | null>(null);
  const [runsStarted, setRunsStarted] = useState(0);

  // Competitive session.
  const [mode, setMode] = useState<ModeChoice>("free_ski");
  const modeRef = useRef<ModeChoice>("free_ski");
  const [ticketState, setTicketState] = useState<TicketState>(NO_TICKET);
  const ticketStateRef = useRef<TicketState>(NO_TICKET);
  const [notice, setNotice] = useState<string | null>(null);
  const [runTicket, setRunTicket] = useState<RunSessionTicket | null>(null);
  const runTicketRef = useRef<RunSessionTicket | null>(null);
  const playedTrailRef = useRef<string>("");
  const playedDateRef = useRef<string | undefined>(undefined);
  const sessionAbortRef = useRef<AbortController | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const phase = useStore(runtime?.hud ?? fallbackStore, (s) => s.phase);

  // Preferences.
  useEffect(() => {
    setRiderStyle(readRiderStyle(localStorage));
    setRiderMode(readStorage(RIDER_MODE_STORAGE_KEY) === "snowboarder" ? "snowboarder" : "skier");
    setStance(readStorage(STANCE_STORAGE_KEY) === "goofy" ? "goofy" : "regular");
    setAudio(readStorage(AUDIO_STORAGE_KEY) !== "off");
    const cam = readStorage(CAMERA_STORAGE_KEY);
    if (cam === "chase" || cam === "far" || cam === "high" || cam === "helmet") setCamera(cam);
    const touch = readStorage(TOUCH_STORAGE_KEY);
    setTouchPref(touch === "on" ? true : touch === "off" ? false : null);
    setLowQuality(readStorage(QUALITY_STORAGE_KEY) === "low");
    setTouchDevice("ontouchstart" in window || navigator.maxTouchPoints > 0);
    track(EVENTS.DROP_IN_OPENED, { resort: profile.slug, engine: "v3", game_version: "v3" });
  }, [profile.slug]);

  const showStatus = useCallback((text: string) => {
    setStatusToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setStatusToast(null), 1800);
  }, []);

  const applyTicketState = (next: TicketState) => { ticketStateRef.current = next; setTicketState(next); };
  const freezeRunTicket = (ticket: RunSessionTicket | null) => { runTicketRef.current = ticket; setRunTicket(ticket); };

  // Runtime lifecycle — recreated when the rider style changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    const controller = new AbortController();
    const lines: string[] = [
      `DROP IN v3 // ${profile.name}, ${profile.tagline}`,
      "renderer: WebGL2",
      `conditions: ${conditions.stamp}`,
    ];
    setBoot({ phase: "boot", lines: [...lines] });
    setRuntime(null);
    runtimeRef.current = null;
    let created: DescentRuntime | null = null;

    void (async () => {
      try {
        const { createDescent } = await import("@/lib/descent");
        if (cancelled) return;
        created = await createDescent({
          canvas, profile, conditions, riderStyle, weatherIndex, riderMode, stance,
          forceLowQuality: readStorage(QUALITY_STORAGE_KEY) === "low",
          signal: controller.signal,
          onProgress: (_fraction, label) => {
            if (cancelled) return;
            if (lines[lines.length - 1] !== label) lines.push(label);
            setBoot({ phase: "boot", lines: [...lines] });
          },
          onEvent: (event) => handleEvent(event),
        });
        if (cancelled) { created.dispose(); return; }
        created.setAudioEnabled(readStorage(AUDIO_STORAGE_KEY) !== "off");
        const cam = readStorage(CAMERA_STORAGE_KEY);
        if (cam === "chase" || cam === "far" || cam === "high" || cam === "helmet") created.setCamera(cam);
        runtimeRef.current = created;
        setRuntime(created);
        setBoot({ phase: "ready" });
      } catch (reason) {
        if (cancelled || controller.signal.aborted) return;
        setBoot({ phase: "error", message: reason instanceof Error ? reason.message : "The engine failed to start." });
        track(EVENTS.DROP_IN_FAILED, { resort: profile.slug, engine: "v3", failure_code: "runtime_init" });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      created?.dispose();
      runtimeRef.current = null;
    };
    // Rider style / weather are applied at creation; a change recreates the runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, conditions, riderStyle.character, riderStyle.outfit, riderStyle.skis, riderMode, stance, generation]);

  const handleEvent = useCallback((event: DescentEvent) => {
    const rt = runtimeRef.current;
    switch (event.type) {
      case "trick": {
        const toast: TrickToast = { id: Date.now() + Math.random(), label: event.label, points: event.points };
        setToasts((list) => [...list.slice(-2), toast]);
        setTimeout(() => setToasts((list) => list.filter((t) => t.id !== toast.id)), 2200);
        break;
      }
      case "finished": {
        const hud = rt?.hud.getState();
        setResults({
          courseName: hud?.courseName ?? "",
          runTimeMs: event.runTimeMs,
          style: event.style,
          bestTrick: hud?.bestTrick ?? null,
          crashes: hud?.crashes ?? 0,
          verticalFt: hud?.verticalFt ?? 0,
        });
        break;
      }
      case "reset": showStatus("Checkpoint"); break;
      case "lift": showStatus(event.state === "boarded" ? `Riding ${event.name}` : `Off ${event.name}`); break;
      case "crashed": break;
      case "trail": break;
    }
  }, [showStatus]);

  // Hotkeys from the runtime's input controller.
  useEffect(() => {
    if (!runtime) return;
    const off = shellInput(runtime).onHotkey((key: Hotkey) => {
      const current = runtime.hud.getState().phase;
      if (key === "help") setControlsOpen((v) => !v);
      else if (key === "trailMap" && current !== "menu") setMapOpen((v) => !v);
      else if (key === "restart") { setResults(null); setPaused(false); }
      else if (key === "fullscreen") toggleFullscreen();
      else if (key === "mute") { setAudio((a) => { const next = !a; runtime.setAudioEnabled(next); writeStorage(AUDIO_STORAGE_KEY, next ? "on" : "off"); showStatus(next ? "Audio on" : "Audio muted"); return next; }); }
      else if (key === "pause") {
        if (current === "menu") { setPanel((p) => (p ? null : p)); return; }
        setPaused((p) => { if (p) runtime.resume(); else runtime.pause(); return !p; });
      } else if (key === "menu") { runtime.toMenu(); setPaused(false); setResults(null); }
    });
    return off;
  }, [runtime, showStatus]);

  // Mirror runtime toasts (camera / weather / hint) into the status toast timer.
  useEffect(() => {
    if (!runtime) return;
    return runtime.hud.subscribe((s, prev) => { if (s.toast && s.toast !== prev.toast) showStatus(s.toast); });
  }, [runtime, showStatus]);

  const toggleFullscreen = () => {
    const el = document.documentElement;
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void el.requestFullscreen?.();
  };

  // Competitive flow.
  const selectedCourse = runtime?.world.courses[runtime.courseIndex] ?? null;
  const trailId = selectedCourse?.id ?? "";

  const mintTicket = (choice: Exclude<ModeChoice, "free_ski">, requestedTrailId: string) => {
    sessionAbortRef.current?.abort();
    const controller = new AbortController();
    sessionAbortRef.current = controller;
    applyTicketState({ status: "requesting" });
    void requestRunSession(
      { resortSlug: profile.slug, mode: choice, trailId: requestedTrailId, surface: conditions.surface, physicsModel: PHYSICS_MODEL, riderMode, stance },
      { signal: controller.signal },
    ).then((result) => {
      if (controller.signal.aborted) return;
      sessionAbortRef.current = null;
      if (isRunSessionFailure(result)) {
        if (result.aborted) return;
        applyTicketState({ status: "offline" });
        setNotice(OFFLINE_NOTICE);
        return;
      }
      applyTicketState({ status: "ready", ticket: result });
      setNotice(null);
    });
  };

  const selectMode = (choice: ModeChoice) => {
    if (choice === modeRef.current) {
      const settled = choice === "free_ski" || usableTicket(ticketStateRef.current, Date.now()) !== null;
      if (settled || ticketStateRef.current.status === "requesting") return;
    }
    sessionAbortRef.current?.abort();
    sessionAbortRef.current = null;
    setMode(choice); modeRef.current = choice;
    setNotice(null);
    runtime?.setGhost(null); setRacedRunId(null);
    if (choice === "free_ski") { applyTicketState(NO_TICKET); return; }
    mintTicket(choice, trailId);
  };

  // A new line invalidates a Time Trial ticket minted for the old one.
  useEffect(() => {
    if (!runtime || modeRef.current === "free_ski") return;
    const held = usableTicket(ticketStateRef.current, Date.now());
    if (held && modeRef.current === "time_trial" && held.trailId !== trailId) mintTicket("time_trial", trailId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, trailId]);

  useEffect(() => () => { sessionAbortRef.current?.abort(); if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const dropIn = () => {
    const rt = runtimeRef.current;
    if (!rt) return;
    const frozen = freezeConditions(conditions, ticketStateRef.current, PHYSICS_MODEL, profile.slug, modeRef.current, trailId, Date.now(), riderMode, stance);
    freezeRunTicket(frozen.ticket);
    playedTrailRef.current = frozen.trailId;
    playedDateRef.current = frozen.ticket?.conditionsDate;
    // Daily Line may name a different trail than the one on screen.
    if (frozen.trailId !== trailId) {
      const index = rt.world.courses.findIndex((c) => c.id === frozen.trailId);
      if (index >= 0) rt.setCourse(index);
    }
    setPanel(null); setResults(null); setPaused(false); setToasts([]);
    setRunsStarted((n) => n + 1);
    rt.start({ recordGhost: modeRef.current !== "free_ski", seed: frozen.ticket?.seed });
    track(EVENTS.DROP_IN_STARTED, { resort: profile.slug, engine: "v3", mode: modeRef.current === "free_ski" ? "free_ride" : modeRef.current, surface: conditions.surface, powder_day: conditions.powderDay });
  };

  const session: SubmittableRunSession = useMemo(() => ({
    mode,
    trailId: playedTrailRef.current || trailId,
    ticket: runTicket,
    offline: mode !== "free_ski" && runTicket === null,
    markSubmitted: () => { applyTicketState({ status: "spent", ticket: runTicketRef.current! }); freezeRunTicket(null); },
  }), [mode, trailId, runTicket]);

  const changeRiderStyle = (next: RiderStyle) => { setRiderStyle(next); saveRiderStyle(localStorage, next); };
  const changeRiderMode = (next: RiderMode) => { setRiderMode(next); writeStorage(RIDER_MODE_STORAGE_KEY, next); };
  const changeStance = (next: SnowboardStance) => { setStance(next); writeStorage(STANCE_STORAGE_KEY, next); };

  const touch = touchPref ?? touchDevice;
  const inGame = phase === "countdown" || phase === "riding" || phase === "finished";
  const showMenu = runtime !== null && phase === "menu";

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#06080b] text-[#e8edf2]" data-descent-phase={phase}>
      <canvas ref={canvasRef} data-testid="drop-in-canvas" aria-label={`Drop In — skiing ${profile.name}`} className="absolute inset-0 h-full w-full touch-none outline-none" tabIndex={0} />

      {boot.phase === "boot" && <BootLog lines={boot.lines} />}

      {boot.phase === "error" && (
        <div className="absolute inset-0 z-30 flex items-center justify-center p-4">
          <div role="alert" className="w-full max-w-md border border-[#ff6b57]/60 bg-[#0b0e13] p-5 font-mono">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#ff6b57]">Runtime failed</p>
            <h1 className="mt-1 text-xl font-bold uppercase tracking-[0.08em]">Couldn’t load {profile.name}</h1>
            <p className="mt-2 break-words text-xs text-[#7f8b99]">{boot.message}</p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setGeneration((g) => g + 1)} className="border border-[#e8edf2] bg-[#e8edf2] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[#06080b]">Try again</button>
              <Link href={`/resorts/${profile.slug}`} className="border border-[#2a323d] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[#7f8b99] hover:text-[#e8edf2]">Back to conditions</Link>
            </div>
          </div>
        </div>
      )}

      {showMenu && <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 z-10 w-[440px] max-w-full bg-gradient-to-r from-[#06080b]/85 via-[#06080b]/55 to-transparent" />}
      {showMenu && runtime && (
        <DescentMenu
          runtime={runtime}
          conditions={conditions}
          panel={panel}
          onPanel={(p) => { if (p === "controls") { setControlsOpen(true); return; } setPanel(p); }}
          session={{ mode, pending: ticketState.status === "requesting", notice, onSelectMode: selectMode }}
          riderStyle={riderStyle}
          onRiderStyle={changeRiderStyle}
          riderMode={riderMode}
          onRiderMode={changeRiderMode}
          stance={stance}
          onStance={changeStance}
          onDropIn={dropIn}
          settings={{
            audio, onAudio: (v) => { setAudio(v); runtime.setAudioEnabled(v); writeStorage(AUDIO_STORAGE_KEY, v ? "on" : "off"); },
            camera, onCamera: (p) => { setCamera(p); runtime.setCamera(p); writeStorage(CAMERA_STORAGE_KEY, p); },
            weatherIndex, onWeather: (i) => { setWeatherIndex(i); runtime.setWeather(i); },
            touch: touchPref, onTouch: (v) => { setTouchPref(v); writeStorage(TOUCH_STORAGE_KEY, v === null ? "auto" : v ? "on" : "off"); },
            lowQuality, onQuality: (low) => { setLowQuality(low); writeStorage(QUALITY_STORAGE_KEY, low ? "low" : "auto"); },
          }}
        />
      )}

      {runtime && inGame && (
        <DescentHUD
          runtime={runtime}
          toasts={toasts}
          statusToast={statusToast}
          touch={touch}
          onHelp={() => setControlsOpen(true)}
          onMap={() => setMapOpen((v) => !v)}
          onFullscreen={toggleFullscreen}
        />
      )}

      {runtime && inGame && touch && !paused && <TouchControls input={shellInput(runtime)} />}

      {runtime && phase === "countdown" && <Countdown runtime={runtime} firstRun={runsStarted <= 1} />}

      {runtime && mapOpen && inGame && (
        <div className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={() => setMapOpen(false)}>
          <div className="border border-[#1b222b] bg-[#0b0e13] p-3" onClick={(e) => e.stopPropagation()}>
            <MapOverlay runtime={runtime} />
          </div>
        </div>
      )}

      <ControlsCard open={controlsOpen} onClose={() => setControlsOpen(false)} initialTab={touch ? "touch" : "keyboard"} />

      {runtime && (
        <PauseDialog
          open={paused && inGame}
          onResume={() => { setPaused(false); runtime.resume(); }}
          onRestart={() => { setPaused(false); setResults(null); runtime.restart(); }}
          onMenu={() => { setPaused(false); setResults(null); runtime.toMenu(); }}
          onControls={() => setControlsOpen(true)}
        />
      )}

      {runtime && results && (
        <ResultsCard
          summary={results}
          competition={mode === "free_ski" ? null : {
            session,
            mode,
            resortSlug: profile.slug,
            trailId: playedTrailRef.current || trailId,
            conditionsDate: playedDateRef.current,
            takeRecording: () => runtime.takeFinishedRun(),
            onRaceGhost: (ghost: DecodedGhost, runId: string) => { runtime.setGhost({ ghost, label: runId }); setRacedRunId(runId); },
            racedRunId,
            onClearGhost: () => { runtime.setGhost(null); setRacedRunId(null); },
          }}
          onSkiOn={() => setResults(null)}
          onRestart={() => { setResults(null); if (mode !== "free_ski") mintTicket(mode, playedTrailRef.current || trailId); runtime.restart(); }}
          onMenu={() => { setResults(null); runtime.toMenu(); }}
        />
      )}

      <style>{`
        .descent-toast { animation: descent-toast-in 220ms ease-out; }
        @keyframes descent-toast-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
        .descent-pulse { animation: descent-pulse 1.4s ease-in-out infinite; }
        @keyframes descent-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        @media (prefers-reduced-motion: reduce) { .descent-toast, .descent-pulse { animation: none; } }
      `}</style>
    </div>
  );
}

function Countdown({ runtime, firstRun }: { runtime: DescentRuntime; firstRun: boolean }) {
  const countdown = useStore(runtime.hud, (s) => s.countdown);
  const courseName = useStore(runtime.hud, (s) => s.courseName);
  const label = countdown > 0 ? String(Math.ceil(countdown)) : "GO";
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center font-mono" aria-live="assertive">
      <span key={label} className="descent-toast text-[9rem] font-bold uppercase leading-none tracking-[0.1em] text-[#e8edf2] sm:text-[12rem]" style={{ textShadow: "0 4px 24px rgba(0,0,0,.55), 0 0 2px rgba(0,0,0,.6)" }}>{label}</span>
      <span className="mt-2 text-xs font-bold uppercase tracking-[0.3em] text-[#e8edf2]" style={{ textShadow: "0 1px 6px rgba(0,0,0,.6)" }}>{courseName}</span>
      {firstRun && <span className="mt-3 text-[10px] uppercase tracking-[0.2em] text-[#e8edf2]/85" style={{ textShadow: "0 1px 6px rgba(0,0,0,.6)" }}>A / D carve · W tuck · S brake · Space pop</span>}
    </div>
  );
}

function MapOverlay({ runtime }: { runtime: DescentRuntime }) {
  const x = useStore(runtime.hud, (s) => s.x);
  const z = useStore(runtime.hud, (s) => s.z);
  const yaw = useStore(runtime.hud, (s) => s.travelYaw);
  return <TrailMapCanvas world={runtime.world} selected={runtime.courseIndex} accent={runtime.world.profile.accent} rider={{ x, z, yaw }} size={Math.min(420, window.innerWidth - 48)} />;
}


// A store to select from before the runtime exists, so hooks stay unconditional.
import { createStore } from "zustand/vanilla";
import type { HudSnapshot } from "@/lib/descent/types";
const fallbackStore = createStore<HudSnapshot>(() => ({
  phase: "menu", speedKmh: 0, style: 0, combo: 1, runTime: 0, progress: 0, verticalFt: 0, altitudeFt: 0,
  courseName: "", courseDifficulty: null, trailName: null, onTrail: false, surface: "packed", tucked: false, braking: false,
  airborne: false, crashed: false, junction: null, liftPrompt: null, liftRiding: null, x: 0, z: 0, travelYaw: 0,
  camera: "chase", weatherName: "", trailHint: false, fps: 0, gpu: "", countdown: 0, toast: null, trick: null, bestTrick: null, crashes: 0, mode: "skier",
}));
