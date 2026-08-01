"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ResortGameProfile } from "@/lib/game/config/schema";
import type { ConditionsSnapshot } from "@/lib/game/conditions";
import type { GameRuntime } from "@/lib/game/runtime/GameRuntime";
import { RuntimeAudio } from "@/lib/game/runtime/RuntimeAudio";
import { UiBridge } from "@/lib/game/runtime/UiBridge";
import { EVENTS, track } from "@/lib/analytics-events";
import DropInErrorBoundary from "./DropInErrorBoundary";
import DropInHUD from "./hud/DropInHUD";
import PauseDialog from "./hud/PauseDialog";
import ResultsDialog from "./hud/ResultsDialog";
import TouchControls from "./input/TouchControls";

type ShellPhase = "poster" | "loading" | "playing" | "error";

function ErrorPoster({ profile, message }: { profile: ResortGameProfile; message: string }) {
  return (
    <div className="pc-topo fixed inset-0 flex items-center justify-center p-6 text-center">
      <div className="pc-paper max-w-lg rounded-lg border-[1.5px] border-ink p-7 shadow-stamp-lg" role="alert">
        <p className="pc-eyebrow">Drop In v2</p><h1 className="pc-display mt-1 text-4xl">Couldn’t load {profile.name}</h1>
        <p className="mt-3 text-bark-dk">{message}</p>
        <button className="mt-5 rounded-full border-[1.5px] border-ink bg-alpen px-5 py-2 font-bold text-cream-50 shadow-stamp-sm" onClick={() => location.reload()}>Try again</button>
      </div>
    </div>
  );
}

const AUDIO_STORAGE_KEY = "drop-in-audio";

export default function DropInGame({ profile, conditions }: {
  profile: ResortGameProfile;
  conditions: ConditionsSnapshot;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<GameRuntime | null>(null);
  const audioRef = useRef<RuntimeAudio | null>(null);
  const teardownRef = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<ShellPhase>("poster");
  const [error, setError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<GameRuntime | null>(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const bridge = useMemo(() => new UiBridge(profile), [profile]);

  useEffect(() => {
    track(EVENTS.DROP_IN_OPENED, { resort: profile.slug, engine: "v2", game_version: "v2" });
  }, [profile.slug]);

  useEffect(() => {
    setAudioEnabled(localStorage.getItem(AUDIO_STORAGE_KEY) !== "off");
  }, []);

  useEffect(() => () => {
    teardownRef.current?.abort();
    teardownRef.current = null;
    runtimeRef.current?.dispose();
    runtimeRef.current = null;
    audioRef.current?.dispose();
    audioRef.current = null;
  }, []);

  useEffect(() => {
    if (phase !== "loading") return;
    let cancelled = false;
    const controller = teardownRef.current;
    const audio = audioRef.current;
    if (!controller || !audio) return;
    const unsubscribe = bridge.store.subscribe((state) => setLoadingProgress(state.loadingProgress));
    const startedAt = performance.now();
    void (async () => {
      try {
        const canvas = canvasRef.current;
        if (!canvas) throw new Error("Game canvas did not mount.");
        const { createGame } = await import("@/lib/game/runtime/createGame");
        if (cancelled) return;
        const created = await createGame({
          canvas, profile, uiBridge: bridge, signal: controller.signal, conditions, audio,
          analytics: {
            controlActivated: (scheme) => track(EVENTS.DROP_IN_CONTROL_ACTIVATED, { resort: profile.slug, engine: "v2", control_scheme: scheme }),
            pointerLock: (status, errorName) => track(EVENTS.DROP_IN_POINTER_LOCK_RESULT, { resort: profile.slug, engine: "v2", pointer_lock_state: status, failure_code: errorName }),
            terrainFallback: (errorName) => track(EVENTS.DROP_IN_TERRAIN_FALLBACK, { resort: profile.slug, engine: "v2", failure_code: errorName }),
            performance: (summary) => track(EVENTS.DROP_IN_PERFORMANCE, { resort: profile.slug, engine: "v2", p50_frame_ms: summary.p50FrameMs, p95_frame_ms: summary.p95FrameMs, quality_rung: summary.rung, dpr: summary.dpr, device_tier: summary.tier }),
          },
        });
        if (cancelled) { created.dispose(); return; }
        runtimeRef.current = created; setRuntime(created); setPhase("playing");
        track(EVENTS.DROP_IN_READY, {
          resort: profile.slug, engine: "v2",
          runtime_load_ms: Math.round(performance.now() - startedAt),
          asset_load_ms: Math.round(created.assetLoadMs),
          scene_build_ms: Math.round(created.sceneBuildMs),
        });
        track(EVENTS.DROP_IN_STARTED, {
          resort: profile.slug, engine: "v2", mode: "free_ride",
          surface: conditions.surface, powder_day: conditions.powderDay,
        });
      } catch (reason) {
        if (cancelled) return;
        const message = reason instanceof Error ? reason.message : "The game engine failed to initialize.";
        controller.abort(); audio.dispose();
        setError(message); setPhase("error");
        track(EVENTS.DROP_IN_FAILED, { resort: profile.slug, engine: "v2", failure_code: "runtime_init" });
      }
    })();
    return () => { cancelled = true; unsubscribe(); };
  }, [bridge, conditions, phase, profile]);

  const start = () => {
    if (teardownRef.current) return;
    const controller = new AbortController();
    const enabled = localStorage.getItem(AUDIO_STORAGE_KEY) !== "off";
    const audio = new RuntimeAudio();
    audio.start(enabled, conditions.surface);
    audio.playUi("confirm");
    void audio.loadSamples(controller.signal);
    teardownRef.current = controller;
    audioRef.current = audio;
    setAudioEnabled(enabled);
    track(EVENTS.DROP_IN_LOAD_STARTED, { resort: profile.slug, engine: "v2", load_stage: "runtime" });
    setPhase("loading");
  };

  const toggleAudio = () => {
    setAudioEnabled((current) => {
      const next = !current;
      localStorage.setItem(AUDIO_STORAGE_KEY, next ? "on" : "off");
      runtimeRef.current?.setAudioEnabled(next);
      audioRef.current?.setEnabled(next);
      return next;
    });
  };

  // v1 parity: Enter starts the descent from anywhere on the poster. The
  // button's autoFocus is not reliable across hydration, and keyboard users
  // shouldn't need to tab to it first.
  useEffect(() => {
    if (phase !== "poster") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      event.preventDefault();
      start();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, profile.slug]);

  return (
    <DropInErrorBoundary fallback={(caught) => <ErrorPoster profile={profile} message={caught.message} />}>
      <div className="fixed inset-0 overflow-hidden bg-ink" data-drop-in-state={phase === "playing" ? "running" : phase}>
        <Link href={`/resorts/${profile.slug}`} className="absolute left-3 top-3 z-40 inline-flex items-center gap-2 rounded-full border-[1.5px] border-ink bg-cream-50 px-3.5 py-2 text-xs font-bold uppercase text-ink shadow-stamp-sm">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Conditions
        </Link>
        {phase === "poster" && (
          <section className="pc-topo absolute inset-0 z-30 flex items-center justify-center px-6 text-center">
            <div className="pc-paper max-w-xl rounded-lg border-[1.5px] border-ink p-7 shadow-stamp-lg sm:p-10">
              <p className="pc-eyebrow">PeakCam Drop In · v2</p>
              <h1 className="pc-display mt-2 text-5xl text-ink sm:text-7xl">{profile.name}</h1>
              <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-bark">{profile.tagline}</p>
              <div className="mt-5 border-y-[1.5px] border-ink/20 py-3 font-mono text-[11px] uppercase tracking-[0.12em] text-bark-dk" data-testid="drop-in-conditions-stamp">
                {conditions.powderDay ? (
                  <span className="inline-block rotate-[-2deg] rounded-sm border-2 border-alpen px-3 py-1 font-black text-alpen">POWDER DAY</span>
                ) : (
                  <span className="font-bold">{conditions.stamp}</span>
                )}
                <span className="mt-2 flex justify-center gap-4">
                  <span>Base {conditions.baseDepthIn == null ? "—" : `${conditions.baseDepthIn}″`}</span>
                  <span>24h {conditions.snow24In == null ? "—" : `${conditions.snow24In}″`}</span>
                </span>
              </div>
              <p className="mx-auto mt-5 max-w-sm text-sm text-bark-dk">Carve with WASD or arrows. Tuck with W, brake with S, jump with Space. Mouse lock is optional.</p>
              <button autoFocus onClick={start} className="mt-7 rounded-full border-[1.5px] border-ink bg-alpen px-8 py-3 font-bold uppercase tracking-wide text-cream-50 shadow-stamp transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink">
                Start descent
              </button>
            </div>
          </section>
        )}
        {(phase === "loading" || phase === "playing") && <canvas ref={canvasRef} data-testid="drop-in-canvas" className="block h-full w-full touch-none" aria-label={`${profile.name} ski game`} />}
        {phase === "loading" && <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-ink/50" role="status"><span className="pc-eyebrow rounded-full bg-cream-50 px-4 py-2 text-ink">Loading real mountain… {Math.round(loadingProgress * 100)}%</span></div>}
        {phase === "playing" && runtime && <><DropInHUD store={bridge.store} audioEnabled={audioEnabled} onToggleAudio={toggleAudio} /><TouchControls adapter={runtime.touch} /><PauseDialog store={bridge.store} onResume={() => runtime.resume()} onRestart={() => runtime.restart()} /><ResultsDialog store={bridge.store} onRestart={() => runtime.restart()} /></>}
        {phase === "error" && <ErrorPoster profile={profile} message={error ?? "Unknown error"} />}
      </div>
    </DropInErrorBoundary>
  );
}
