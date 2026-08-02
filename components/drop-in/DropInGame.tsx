"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ResortGameProfile } from "@/lib/game/config/schema";
import type { ConditionsSnapshot } from "@/lib/game/conditions";
import type { GameRuntime } from "@/lib/game/runtime/GameRuntime";
import { RuntimeAudio } from "@/lib/game/runtime/RuntimeAudio";
import { UiBridge } from "@/lib/game/runtime/UiBridge";
import { EVENTS, track, whenPostHogReady } from "@/lib/analytics-events";
import { trackDropIn } from "@/lib/game/analytics/events";
import {
  isRunSessionFailure,
  requestRunSession,
  type RunSessionTicket,
} from "@/lib/game/competition/session-client";
import {
  NO_TICKET,
  needsRemint,
  resolveRunSeed,
  ticketForConfig,
  ticketForWorld,
  ticketReducer,
  usableTicket,
  type TicketState,
} from "@/lib/game/competition/ticket-lifecycle";
import type { CompetitiveRunMode } from "@/lib/game/config/modes";
import type { DecodedGhost } from "@/lib/game/replay/codec";
import { physicsModelForSessionRequest, resolveRuntimePhysicsModel } from "@/lib/game/runtime/physics-selection";
// Shared with the sessions route, which must derive the same ids. Imported from
// config/ rather than server/ so the browser bundle skips profiles + bake configs.
import { trailIdFromName } from "@/lib/game/config/course-ids";
import { cameraPresetName } from "@/lib/game/rendering/debugFlags";
import type { CameraPresetName } from "@/lib/game/rendering/camera-presets";
import DropInErrorBoundary from "./DropInErrorBoundary";
import DropInHUD from "./hud/DropInHUD";
import ModeSelect, { type DropInModeChoice } from "./hud/ModeSelect";
import PauseDialog from "./hud/PauseDialog";
import ResultsDialog from "./hud/ResultsDialog";
import TouchControls from "./input/TouchControls";

type ShellPhase = "poster" | "loading" | "playing" | "error";

/**
 * Everything Task A4 needs to submit the run.
 *
 * `ticket` is frozen when the descent starts and is the ticket whose seed the
 * world was actually built from — submitting anything else is a `seed_mismatch`
 * rejection. It is null for Free Ski and for competitive play that fell back to
 * offline, so **A4's rule is simply: submit iff `ticket !== null`**.
 *
 * After a successful submission A4 must call `markSubmitted()`. The nonce is
 * one-time-use, so that call is what tells the shell to re-mint before the next
 * run instead of replaying a spent ticket into a 409.
 */
export interface DropInRunSession {
  mode: DropInModeChoice;
  trailId: string;
  ticket: RunSessionTicket | null;
  offline: boolean;
  markSubmitted(): void;
}

const OFFLINE_NOTICE = "Leaderboard unavailable — playing offline";

/**
 * `?e2espawn=<metres>` — start the descent that far along the course so the
 * automated play→submit→board check can reach the finish gate. Undefined for
 * every normal visit. See `spawnOnRunAtArcLength` for why this is harmless in
 * production: the run it produces cannot be submitted.
 */
function e2eSpawnArcM(): number | undefined {
  if (typeof location === "undefined") return undefined;
  const raw = new URLSearchParams(location.search).get("e2espawn");
  if (raw === null) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

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
  // Which renderer actually initialised. The e2e matrix asserts against this rather than guessing
  // from navigator.gpu, because a browser can advertise WebGPU and still fall back.
  const [gfxBackend, setGfxBackend] = useState<"webgpu" | "webgl" | "pending">("pending");
  // Which chase-camera framing `?cam=` selected, so a comparison shoot can label its frames.
  // Read after mount, not during render: the server has no location and would hydrate-mismatch.
  const [camPreset, setCamPreset] = useState<CameraPresetName>("classic");
  useEffect(() => setCamPreset(cameraPresetName()), []);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const bridge = useMemo(() => new UiBridge(profile), [profile]);

  // The server derives legal trail ids from the profile, and a run always drops
  // in on the first trail, so that is the course we ask a ticket for.
  const trailId = useMemo(() => trailIdFromName(profile.trails[0].name), [profile]);
  const physicsModel = resolveRuntimePhysicsModel(conditions.physicsModel);
  const [mode, setMode] = useState<DropInModeChoice>("free_ski");
  const [ticketState, setTicketState] = useState<TicketState>(NO_TICKET);
  /** The ticket this descent was actually seeded from; frozen at start. */
  const [runTicket, setRunTicket] = useState<RunSessionTicket | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  /** The leaderboard row whose ghost is loaded into the renderer, if any. */
  const [racedRunId, setRacedRunId] = useState<string | null>(null);
  const sessionAbortRef = useRef<AbortController | null>(null);
  // Read from the load effect and the dialogs, outside the render that set them.
  const modeRef = useRef<DropInModeChoice>("free_ski");
  const ticketStateRef = useRef<TicketState>(NO_TICKET);
  const runTicketRef = useRef<RunSessionTicket | null>(null);
  const cancelPendingTrackRef = useRef<(() => void) | null>(null);

  const applyTicketState = (next: TicketState) => {
    ticketStateRef.current = next;
    setTicketState(next);
  };

  const freezeRunTicket = (ticket: RunSessionTicket | null) => {
    runTicketRef.current = ticket;
    setRunTicket(ticket);
  };

  /**
   * Ask for a ticket. Always non-blocking: play never waits on this, and a
   * failure degrades to offline rather than stopping the run.
   *
   * `duringPlay` re-mints for a run already underway (restart after a
   * submission, or an expired ticket). The world is not rebuilt by a restart,
   * so a re-minted ticket is only usable if its seed still matches the world we
   * are skiing — across a UTC-day rollover the Daily Line seed moves, and that
   * run has to finish offline.
   */
  const mintTicket = (choice: CompetitiveRunMode, duringPlay = false) => {
    sessionAbortRef.current?.abort();
    const controller = new AbortController();
    sessionAbortRef.current = controller;
    applyTicketState({ status: "requesting" });

    void requestRunSession(
      {
        resortSlug: profile.slug,
        mode: choice,
        trailId,
        surface: conditions.surface,
        physicsModel: physicsModelForSessionRequest(conditions),
      },
      { signal: controller.signal },
    ).then((result) => {
      if (controller.signal.aborted) return;
      sessionAbortRef.current = null;

      if (isRunSessionFailure(result)) {
        // An abort is our own cancellation; it is not worth a notice.
        if (result.aborted) return;
        applyTicketState({ status: "offline" });
        if (duringPlay) freezeRunTicket(null);
        setSessionNotice(OFFLINE_NOTICE);
        return;
      }

      const ready: TicketState = { status: "ready", ticket: result };
      if (duringPlay) {
        // Fails closed on an unknown world seed; refuses a ticket minted for a
        // different course than the one being skied.
        const forThisRun = ticketForWorld(
          ready,
          runtimeRef.current?.runSeed,
          runtimeRef.current?.world.config ?? { surface: conditions.surface, physicsModel },
          Date.now(),
        );
        if (!forThisRun) {
          applyTicketState({ status: "offline" });
          freezeRunTicket(null);
          setSessionNotice(OFFLINE_NOTICE);
          return;
        }
        applyTicketState(ready);
        setSessionNotice(null);
        freezeRunTicket(forThisRun);
        return;
      }

      applyTicketState(ready);
      setSessionNotice(null);
    });
  };

  const session: DropInRunSession = useMemo(
    () => ({
      mode,
      trailId,
      ticket: runTicket,
      offline: mode !== "free_ski" && runTicket === null,
      markSubmitted: () => {
        applyTicketState(ticketReducer(ticketStateRef.current, { type: "submitted" }));
        // Clearing the frozen ticket makes "submit iff ticket !== null"
        // self-limiting: a spent nonce can no longer be submitted twice.
        freezeRunTicket(null);
      },
    }),
    [mode, trailId, runTicket],
  );

  /**
   * `local` Free Ski · `pending` ticket in flight · `ticketed` submittable ·
   * `offline` competitive but unsubmittable.
   *
   * Phase matters. Before the descent starts, holding a ready ticket is what
   * makes the run submittable. Once it has started, only the ticket actually
   * frozen onto the run counts — a run that began offline stays offline even if
   * a later ticket lands, and reporting otherwise would advertise a run that
   * can never be submitted.
   */
  // `data-drop-in-ticket` (rendered below) reports the ticket the *shell*
  // holds; `data-drop-in-session` reports whether the *running descent* can be
  // submitted. Mid-run those deliberately diverge — a ticket arriving after the
  // start moves the first and must not move the second — and keeping both in
  // the DOM is what lets a test wait for a response to be processed rather than
  // sleeping and hoping.
  const sessionStateAttribute = mode === "free_ski"
    ? "local"
    : phase === "poster"
      ? ticketState.status === "requesting"
        ? "pending"
        : ticketState.status === "ready" ? "ticketed" : "offline"
      : session.ticket
        ? "ticketed"
        : ticketState.status === "requesting" ? "pending" : "offline";

  const dailyCourseName = useMemo(() => {
    const held = ticketState.status === "ready" ? ticketState.ticket : null;
    const id = held?.mode === "score_attack" ? held.trailId : trailId;
    return profile.trails.find((trail) => trailIdFromName(trail.name) === id)?.name
      ?? profile.trails[0].name;
  }, [profile, ticketState, trailId]);

  /** Drop the loaded ghost. See the lifetime rule on `raceGhost`. */
  const clearGhost = () => {
    runtimeRef.current?.setGhost(null);
    setRacedRunId(null);
  };

  const selectMode = (choice: DropInModeChoice) => {
    // Re-picking the mode you already have would throw away a live ticket, or
    // abort and re-fire a request that is already on its way — either way
    // spending another of the 20-per-5-minutes session limit for nothing.
    if (choice === modeRef.current) {
      const settled = choice === "free_ski"
        || usableTicket(ticketStateRef.current, Date.now()) !== null;
      if (settled || ticketStateRef.current.status === "requesting") return;
    }

    sessionAbortRef.current?.abort();
    sessionAbortRef.current = null;
    setMode(choice);
    modeRef.current = choice;
    setSessionNotice(null);
    // Back at mode select: the ghost belonged to the course just left.
    clearGhost();
    // Post-init only: a capture made before posthog.init() is silently dropped.
    cancelPendingTrackRef.current?.();
    cancelPendingTrackRef.current = whenPostHogReady(() =>
      trackDropIn({
        name: "drop_in_mode_selected",
        properties: { resort_slug: profile.slug, mode: choice },
      }),
    );

    if (choice === "free_ski") {
      applyTicketState(NO_TICKET);
      return;
    }
    mintTicket(choice);
  };

  useEffect(() => {
    track(EVENTS.DROP_IN_OPENED, { resort: profile.slug, engine: "v2", game_version: "v2" });
  }, [profile.slug]);

  useEffect(() => {
    setAudioEnabled(localStorage.getItem(AUDIO_STORAGE_KEY) !== "off");
  }, []);

  useEffect(() => () => {
    sessionAbortRef.current?.abort();
    sessionAbortRef.current = null;
    cancelPendingTrackRef.current?.();
    cancelPendingTrackRef.current = null;
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
          canvas, profile, uiBridge: bridge, signal: controller.signal, conditions, physicsModel, audio,
          // The ghost header carries world.seed; it must equal the ticket seed
          // or the server rejects the submission with seed_mismatch.
          seed: resolveRunSeed(runTicketRef.current, profile.seed),
          // Test-only start offset (`?e2espawn=<metres>`). The run it produces
          // finishes through real physics but is refused by the server
          // validator's start-zone and minimum-distance checks.
          spawnArcM: e2eSpawnArcM(),
          analytics: {
            controlActivated: (scheme) => track(EVENTS.DROP_IN_CONTROL_ACTIVATED, { resort: profile.slug, engine: "v2", control_scheme: scheme }),
            pointerLock: (status, errorName) => track(EVENTS.DROP_IN_POINTER_LOCK_RESULT, { resort: profile.slug, engine: "v2", pointer_lock_state: status, failure_code: errorName }),
            terrainFallback: (errorName) => track(EVENTS.DROP_IN_TERRAIN_FALLBACK, { resort: profile.slug, engine: "v2", failure_code: errorName }),
            performance: (summary) => track(EVENTS.DROP_IN_PERFORMANCE, { resort: profile.slug, engine: "v2", p50_frame_ms: summary.p50FrameMs, p95_frame_ms: summary.p95FrameMs, quality_rung: summary.rung, dpr: summary.dpr, device_tier: summary.tier }),
          },
        });
        if (cancelled) { created.dispose(); return; }
        setGfxBackend(created.backendKind);
        // Arm before the first simulation step: the runtime owns begin timing,
        // and at t=0 arming starts the recorder immediately. Free Ski never
        // records.
        if (modeRef.current !== "free_ski") created.beginCompetitiveRecording();
        runtimeRef.current = created; setRuntime(created); setPhase("playing");
        track(EVENTS.DROP_IN_READY, {
          resort: profile.slug, engine: "v2",
          runtime_load_ms: Math.round(performance.now() - startedAt),
          asset_load_ms: Math.round(created.assetLoadMs),
          scene_build_ms: Math.round(created.sceneBuildMs),
        });
        track(EVENTS.DROP_IN_STARTED, {
          resort: profile.slug, engine: "v2",
          mode: modeRef.current === "free_ski" ? "free_ride" : modeRef.current,
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
    // Freeze the ticket now: the world is about to be built from its seed, and
    // one that arrives later cannot retroactively describe this run. A request
    // still in flight (or an expired ticket) therefore starts offline rather
    // than making the player wait — the run is recorded, just not submitted.
    //
    // Checked against the config this world will actually use, not just
    // readiness. Under `?phys=v2` with the rollout off the server mints a v1
    // ticket while the runtime builds a v2 world, and freezing on readiness
    // alone submitted that v2 run to the v1 board. No world exists yet, so
    // there is no seed to compare — that check lands on the restart path.
    const frozen = modeRef.current === "free_ski"
      ? null
      : ticketForConfig(
          ticketStateRef.current,
          { surface: conditions.surface, physicsModel },
          Date.now(),
        );
    freezeRunTicket(frozen);
    if (modeRef.current !== "free_ski" && !frozen) setSessionNotice(OFFLINE_NOTICE);
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

  /** Arm first, then reset: the runtime begins recording at the reset itself. */
  const restartRun = (active: GameRuntime) => {
    const choice = modeRef.current;
    if (choice !== "free_ski") {
      // Only a spent or expired ticket is re-minted. A run that was never
      // submitted keeps its ticket, so restart-heavy play does not farm the
      // sessions rate limit. The re-mint is in flight while the run proceeds.
      const now = Date.now();
      if (needsRemint(ticketStateRef.current, now)) {
        freezeRunTicket(null);
        mintTicket(choice, true);
      } else {
        // Must match the world we are still skiing — a restart does not rebuild
        // it, so an otherwise-valid ticket for another seed is not usable here.
        freezeRunTicket(ticketForWorld(ticketStateRef.current, active.runSeed, active.world.config, now));
      }
      active.beginCompetitiveRecording();
    }
    active.restart();
  };

  /**
   * "Race this ghost": hand the decoded replay to the renderer, then restart so
   * the ghost and the player leave the gate together. The restart re-arms the
   * recorder and re-mints a spent ticket exactly as any other restart does, so
   * a raced run is still a submittable run.
   *
   * Lifetime rule: a loaded ghost **persists across restarts** — racing one is
   * a retry against it, and clearing it every restart would mean re-picking the
   * row after every attempt. It is cleared only by an explicit "Clear ghost"
   * and by returning to mode select, where the next run may be a different
   * course entirely (and, for Daily Line, a different seed).
   */
  const raceGhost = (ghost: DecodedGhost, runId: string) => {
    const active = runtimeRef.current;
    if (!active) return;
    active.setGhost(ghost);
    setRacedRunId(runId);
    restartRun(active);
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
      // On a focused control, preventDefault() here would swallow the click
      // Enter is meant to produce — picking a mode would silently start a run.
      if (target?.closest("button")) return;
      event.preventDefault();
      start();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, profile.slug]);

  return (
    <DropInErrorBoundary fallback={(caught) => <ErrorPoster profile={profile} message={caught.message} />}>
      <div
        className="fixed inset-0 overflow-hidden bg-ink"
        data-drop-in-state={phase === "playing" ? "running" : phase}
        data-drop-in-mode={session.mode}
        data-drop-in-session={sessionStateAttribute}
        data-drop-in-ticket={ticketState.status}
        data-drop-in-gfx={gfxBackend}
        data-drop-in-cam={camPreset}
        data-drop-in-physics={runtime?.world.config.physicsModel ?? physicsModel}
      >
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
                {conditions.narrative && (
                  <span
                    className="mt-2 block normal-case tracking-normal text-bark"
                    data-testid="drop-in-conditions-narrative"
                  >
                    {conditions.narrative}
                  </span>
                )}
              </div>
              <p className="mx-auto mt-5 max-w-sm text-sm text-bark-dk">Carve with WASD or arrows. Tuck with W, brake with S, jump with Space. Mouse lock is optional.</p>
              <ModeSelect
                selected={session.mode}
                onSelect={selectMode}
                dailyCourseName={dailyCourseName}
                pending={ticketState.status === "requesting" ? session.mode : null}
                notice={sessionNotice}
              />
              <button autoFocus onClick={start} className="mt-7 rounded-full border-[1.5px] border-ink bg-alpen px-8 py-3 font-bold uppercase tracking-wide text-cream-50 shadow-stamp transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink">
                Start descent
              </button>
            </div>
          </section>
        )}
        {(phase === "loading" || phase === "playing") && <canvas ref={canvasRef} data-testid="drop-in-canvas" className="block h-full w-full touch-none" aria-label={`${profile.name} ski game`} />}
        {phase === "loading" && <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-ink/50" role="status"><span className="pc-eyebrow rounded-full bg-cream-50 px-4 py-2 text-ink">Loading real mountain… {Math.round(loadingProgress * 100)}%</span></div>}
        {phase === "playing" && runtime && <><DropInHUD store={bridge.store} audioEnabled={audioEnabled} onToggleAudio={toggleAudio} /><TouchControls adapter={runtime.touch} /><PauseDialog store={bridge.store} onResume={() => runtime.resume()} onRestart={() => restartRun(runtime)} /><ResultsDialog
          store={bridge.store}
          onRestart={() => restartRun(runtime)}
          // Free Ski passes null, which is what removes the leaderboard,
          // submission and ghost surfaces entirely rather than disabling them.
          competition={session.mode === "free_ski" ? null : {
            session,
            mode: session.mode,
            resortSlug: profile.slug,
            trailId: session.trailId,
            // The runtime hands over its recording once; the dialog takes it
            // when it opens and holds it for the life of the results screen.
            takeRecording: () => runtimeRef.current?.takeFinishedRun() ?? null,
            onRaceGhost: raceGhost,
            racedRunId,
            onClearGhost: clearGhost,
          }}
        /></>}
        {phase === "error" && <ErrorPoster profile={profile} message={error ?? "Unknown error"} />}
      </div>
    </DropInErrorBoundary>
  );
}
