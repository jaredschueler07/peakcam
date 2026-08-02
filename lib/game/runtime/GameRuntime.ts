import type { ResortGameProfile } from "../config/schema";
import { COURSE_VERSION, PHYSICS_VERSION } from "../config/versions";
import { FIXED_DT, MAX_FRAME_DT, MAX_STEPS_PER_FRAME } from "../core/clock";
import { createSimulation, stepSimulation } from "../core/simulation";
import { beginLiftRide } from "../core/run-lifecycle";
import { spawnOnRunAtArcLength } from "../terrain/real-course";
import type { SimulationState, SimulationWorld, TerrainSampler } from "../core/types";
import { GamepadAdapter } from "../input/GamepadAdapter";
import { InputManager } from "../input/InputManager";
import { KeyboardAdapter } from "../input/KeyboardAdapter";
import { PointerDragAdapter } from "../input/PointerDragAdapter";
import { PointerLockAdapter } from "../input/PointerLockAdapter";
import { TouchAdapter } from "../input/TouchAdapter";
import type { ControlScheme, InputAdapter } from "../input/types";
import { GameRenderer, type RendererBackend, type RenderPerformanceSummary } from "../rendering/Renderer";
import type { NodeFactories } from "../rendering/nodeFactories";
import { createWorld } from "../terrain/obstacles";
import { UiBridge } from "./UiBridge";
import type { ConditionsSnapshot } from "../conditions";
import { simulationConfigForConditions } from "./physics-selection";
import type { PhysicsModel } from "../core/config";
import type { RuntimeAudio } from "./RuntimeAudio";
import { encodeGhost, type DecodedGhost, type GhostSample } from "../replay/codec";
import type { DecodedFarField } from "../terrain/far-field-format";
import { GHOST_SAMPLE_HZ, GhostRecorder } from "../replay/recorder";

interface FinishedRunRecording {
  samples: GhostSample[];
  encoded: Uint8Array;
}

interface RecordingRecorder {
  readonly recording: boolean;
  begin(nowSimTime: number): void;
  finish(): unknown;
}

/** Owns the armed-versus-active boundary at simulation reset time. */
export class CompetitiveRecordingArm {
  pending = false;

  arm(stateTime: number, begin: (nowSimTime: number) => void): void {
    this.pending = true;
    if (stateTime === 0) {
      begin(0);
      this.pending = false;
    }
  }

  onReset(
    stateTime: number,
    recorder: RecordingRecorder,
    liftFinished = false,
  ): "started" | "discarded" | "lift-discarded" | "ignored" {
    if (liftFinished) {
      if (recorder.recording) recorder.finish();
      // A lift drop is not a run start; wait for the next genuine restart reset.
      this.pending = true;
      return "lift-discarded";
    }
    if (this.pending) {
      if (stateTime !== 0) console.warn("[drop-in] competitive recorder reset did not land at state.time 0", stateTime);
      recorder.begin(stateTime);
      this.pending = false;
      return "started";
    }
    if (recorder.recording) {
      recorder.finish();
      // This reset is already the next run's start: discard, then begin immediately.
      recorder.begin(stateTime);
      // The active recorder is now the armed run; a later reset repeats this branch.
      this.pending = false;
      return "discarded";
    }
    return "ignored";
  }
}

/**
 * The last step of loading: hold the bar at 95% while the shaders compile, then start. Extracted
 * so the ordering is testable without a canvas — a pre-warm that resolves after `start()` would
 * defeat the point, and a pre-warm that throws must never strand the player on the loading screen.
 */
export async function warmUpAndStart(
  ui: Pick<UiBridge, "setLoadingProgress">,
  renderer: { prewarm(): Promise<void> },
  start: () => void,
): Promise<void> {
  ui.setLoadingProgress(0.95);
  try {
    await renderer.prewarm();
  } catch (reason) {
    // A failed pre-warm costs a stutter, not a run.
    console.warn("[Drop In] Shader pre-warm failed; starting anyway.", reason);
  }
  ui.setLoadingProgress(1);
  start();
}

export interface RuntimeAnalytics {
  controlActivated(scheme: ControlScheme): void;
  pointerLock(status: "acquired" | "denied" | "unsupported" | "lost", errorName?: string): void;
  terrainFallback(errorName: string): void;
  performance(summary: RenderPerformanceSummary): void;
}

export class GameRuntime {
  readonly state: SimulationState;
  readonly world: SimulationWorld;
  readonly input: InputManager;
  readonly touch: TouchAdapter;
  readonly sceneBuildMs: number;
  private readonly renderer: GameRenderer;
  private readonly keyboard: KeyboardAdapter;
  private readonly pointerDrag: PointerDragAdapter;
  private readonly pointerLock: PointerLockAdapter;
  private readonly gamepad: GamepadAdapter;
  private readonly adapters: InputAdapter[];
  private raf = 0;
  private lastMs = 0;
  private accumulator = 0;
  private paused = false;
  private disposed = false;
  private activated = false;
  private readonly ghostRecorder: GhostRecorder;
  private readonly recordingArm = new CompetitiveRecordingArm();
  private finishedRun: FinishedRunRecording | null = null;
  /** Reused listener payload — avoids allocating `{speed,carve,...}` every HUD tick. */
  private readonly listenerScratch = { speed: 0, carve: 0, onGround: false, liftRide: 0 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    profile: ResortGameProfile,
    readonly ui: UiBridge,
    private readonly analytics: RuntimeAnalytics,
    terrain: TerrainSampler,
    private readonly conditions: ConditionsSnapshot,
    private readonly physicsModel: PhysicsModel,
    private readonly audio: RuntimeAudio,
    readonly assetLoadMs = 0,
    /** Ticket seed for a competitive run; the profile seed otherwise. */
    readonly runSeed: number = profile.seed,
    /** Test-only start offset along the course; see `spawnOnRunAtArcLength`. */
    spawnArcM?: number,
    /** Prepared async renderer backend; omitted only by legacy direct-construction tests. */
    backend?: RendererBackend,
    /** Node-material pipeline, required alongside a WebGPU backend; see `nodeFactories`. */
    nodeFactories?: NodeFactories | null,
  ) {
    this.world = createWorld(
      profile,
      runSeed,
      terrain,
      simulationConfigForConditions(conditions, physicsModel),
    );
    this.state = createSimulation(profile, runSeed, terrain);
    const spawnRun = terrain.kind === "real" ? terrain.realRuns?.[this.state.selectedTrail] : undefined;
    if (spawnArcM !== undefined && Number.isFinite(spawnArcM) && spawnRun) {
      spawnOnRunAtArcLength(this.state, spawnRun, spawnArcM, terrain);
    }
    this.ghostRecorder = new GhostRecorder(this.world.terrain);
    ui.configureTerrain(terrain);
    this.input = new InputManager((scheme) => {
      if (!this.activated) { this.activated = true; analytics.controlActivated(scheme); }
    });
    const sceneStartedAt = performance.now();
    this.renderer = new GameRenderer(canvas, profile, this.world, this.state, { backend, nodeFactories });
    this.renderer.setWeather(conditions.weatherDefault);
    this.sceneBuildMs = performance.now() - sceneStartedAt;
    this.keyboard = new KeyboardAdapter(this.input);
    this.pointerDrag = new PointerDragAdapter(canvas, this.input);
    this.pointerLock = new PointerLockAdapter(canvas, this.input, { onResult: (result) => {
      analytics.pointerLock(result.status, result.errorName);
      ui.emit({ type: "pointer-lock", ...result });
    } });
    this.touch = new TouchAdapter(canvas.parentElement ?? canvas, this.input);
    this.gamepad = new GamepadAdapter(this.input);
    this.adapters = [this.keyboard, this.pointerDrag, this.pointerLock, this.touch, this.gamepad];
    for (const adapter of this.adapters) adapter.setActive(true);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("visibilitychange", this.onVisibility);
    canvas.addEventListener("dblclick", this.onPointerLockGesture);

  }

  start(): void {
    if (this.disposed || this.raf) return;
    this.paused = false; this.lastMs = performance.now(); this.ui.setStatus("running");
    this.raf = requestAnimationFrame(this.frame);
  }

  /**
   * Compile the shaders before the first frame so the run does not stutter its way through the
   * first appearance of each pipeline. Resolves once the loop is running.
   */
  async startWhenWarm(): Promise<void> {
    if (this.disposed) return;
    await warmUpAndStart(this.ui, this.renderer, () => this.start());
  }
  pause(): void { this.paused = true; this.input.clearHeld(); this.ui.setPaused(true); }
  resume(): void {
    if (this.disposed) return;
    this.paused = false; this.lastMs = performance.now(); this.accumulator = 0; this.ui.setPaused(false);
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }
  restart(): void { this.input.setAction("restart", true); this.input.setAction("restart", false); this.resume(); }

  beginCompetitiveRecording(): void {
    this.finishedRun = null;
    this.ui.setRunRecordingAvailable(false);
    this.recordingArm.arm(this.state.time, (nowSimTime) => {
      this.ghostRecorder.begin(nowSimTime);
      this.ghostRecorder.sample(this.state, nowSimTime);
    });
  }

  /**
   * Attach a decoded leaderboard replay to race against, or `null` to clear it.
   * The renderer is private because nothing else outside the loop should reach
   * it; this is the one thing the shell legitimately drives from a UI action.
   */
  setGhost(ghost: DecodedGhost | null): void { this.renderer.setGhost(ghost); }

  /**
   * Swap in the baked far field once it resolves. Optional by design: the run is already under
   * way on the procedural ridge bands, and a resort without an asset simply never calls this.
   */
  attachFarField(asset: DecodedFarField): void { this.renderer.attachFarField(asset); }

  /** Which renderer backend the run is actually using. */
  get backendKind(): "webgpu" | "webgl" { return this.renderer.backendKind; }

  takeFinishedRun(): { samples: GhostSample[]; encoded: Uint8Array } | null {
    const run = this.finishedRun;
    this.finishedRun = null;
    this.ui.setRunRecordingAvailable(false);
    return run;
  }

  private frame = (nowMs: number) => {
    this.raf = 0;
    if (this.disposed) return;
    const rawFrameMs = Math.max(0, nowMs - this.lastMs);
    const frameDt = Math.min(MAX_FRAME_DT, rawFrameMs / 1000);
    this.lastMs = nowMs;
    this.gamepad.poll();
    if (this.input.consumePausePressed()) {
      if (this.paused) this.resume(); else this.pause();
    }
    if (this.input.consumeLiftPressed() && this.state.liftRide <= 0) {
      beginLiftRide(this.state); this.audio.playLift();
    }
    const weather = this.input.consumeWeatherPressed();
    if (weather !== null) {
      this.renderer.setWeather(weather);
      this.weatherIndex = weather < 0
        ? (this.weatherIndex + 1) % this.world.profile.weather.length
        : (weather + this.world.profile.weather.length) % this.world.profile.weather.length;
      this.audio.playUi("confirm");
    }
    if (!this.paused) {
      this.accumulator += frameDt;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
        const events = stepSimulation(this.state, this.input.nextFrame(), FIXED_DT, this.world);
        this.audio.playSimulationEvents(events);
        if (events.reset) {
          const resetAction = this.recordingArm.onReset(this.state.time, this.ghostRecorder, events.liftFinished);
          if (resetAction === "started" || resetAction === "discarded") {
            this.ghostRecorder.sample(this.state, this.state.time);
          }
          if (resetAction === "discarded" || resetAction === "lift-discarded") {
            this.finishedRun = null;
            this.ui.setRunRecordingAvailable(false);
          }
        } else if (this.ghostRecorder.recording) {
          this.ghostRecorder.sample(this.state, this.state.time);
          if (this.state.finished) {
            const samples = this.ghostRecorder.finish();
            if (samples) {
              this.finishedRun = {
                samples,
                encoded: encodeGhost(samples, {
                  physicsVersion: PHYSICS_VERSION,
                  courseVersion: COURSE_VERSION,
                  sampleHz: GHOST_SAMPLE_HZ,
                  seed: this.world.seed,
                  originYCm: Math.round(this.state.startY * 100),
                }),
              };
              this.ui.setRunRecordingAvailable(true);
            }
          }
        }
        if (events.crashed && events.crashReason) this.ui.emit({ type: "crashed", reason: events.crashReason });
        if (events.landed) this.ui.emit({ type: "landed" });
        if (events.gatePassed) this.ui.emit({ type: "gate-passed" });
        if (events.trailChanged) this.ui.emit({ type: "trail-changed", trailIndex: this.state.selectedTrail });
        if (events.finished) { this.ui.emit({ type: "finished", reason: "finish" }); this.analytics.performance(this.renderer.takePerformanceSummary()); }
        this.accumulator -= FIXED_DT; steps += 1;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
      if (this.ui.publish(this.state, nowMs)) {
        const weatherPreset = this.world.profile.weather[this.weatherIndex];
        this.listenerScratch.speed = Math.hypot(this.state.vel.x, this.state.vel.z);
        this.listenerScratch.carve = this.state.carve;
        this.listenerScratch.onGround = this.state.onGround;
        this.listenerScratch.liftRide = this.state.liftRide;
        this.audio.updateListener(
          this.listenerScratch,
          this.conditions.surface,
          Math.min(1, weatherPreset.wind / 15),
          nowMs,
        );
      }
      this.renderer.render(this.state, this.world, frameDt, this.state.crouch, rawFrameMs);
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private onResize = () => this.renderer.resize(this.canvas.clientWidth, this.canvas.clientHeight);
  private onBlur = () => this.input.clearHeld();
  private onVisibility = () => { if (document.hidden) this.pause(); else this.input.clearHeld(); };
  private onPointerLockGesture = () => { void this.pointerLock.request(); };

  private weatherIndex: number = this.conditions.weatherDefault;

  setAudioEnabled(enabled: boolean): void { this.audio.setEnabled(enabled); }

  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0;
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.canvas.removeEventListener("dblclick", this.onPointerLockGesture);
    for (const adapter of this.adapters) adapter.dispose();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock?.();
    this.input.clearHeld(); this.renderer.dispose(); this.audio.dispose(); this.ui.dispose();
  }
}
