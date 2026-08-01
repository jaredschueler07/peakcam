import type { ResortGameProfile } from "../config/schema";
import { FIXED_DT, MAX_FRAME_DT, MAX_STEPS_PER_FRAME } from "../core/clock";
import { createSimulation, stepSimulation } from "../core/simulation";
import { beginLiftRide } from "../core/run-lifecycle";
import type { SimulationState, SimulationWorld, TerrainSampler } from "../core/types";
import { GamepadAdapter } from "../input/GamepadAdapter";
import { InputManager } from "../input/InputManager";
import { KeyboardAdapter } from "../input/KeyboardAdapter";
import { PointerDragAdapter } from "../input/PointerDragAdapter";
import { PointerLockAdapter } from "../input/PointerLockAdapter";
import { TouchAdapter } from "../input/TouchAdapter";
import type { ControlScheme, InputAdapter } from "../input/types";
import { GameRenderer } from "../rendering/Renderer";
import { createWorld } from "../terrain/obstacles";
import { UiBridge } from "./UiBridge";

export interface RuntimeAnalytics {
  controlActivated(scheme: ControlScheme): void;
  pointerLock(status: "acquired" | "denied" | "unsupported" | "lost", errorName?: string): void;
  terrainFallback(errorName: string): void;
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

  constructor(
    private readonly canvas: HTMLCanvasElement,
    profile: ResortGameProfile,
    readonly ui: UiBridge,
    analytics: RuntimeAnalytics,
    terrain: TerrainSampler,
    readonly assetLoadMs = 0,
  ) {
    this.world = createWorld(profile, profile.seed, terrain);
    this.state = createSimulation(profile, profile.seed, terrain);
    ui.configureTerrain(terrain);
    this.input = new InputManager((scheme) => {
      if (!this.activated) { this.activated = true; analytics.controlActivated(scheme); }
    });
    const sceneStartedAt = performance.now();
    this.renderer = new GameRenderer(canvas, profile, this.world, this.state);
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
  pause(): void { this.paused = true; this.input.clearHeld(); this.ui.setPaused(true); }
  resume(): void {
    if (this.disposed) return;
    this.paused = false; this.lastMs = performance.now(); this.accumulator = 0; this.ui.setPaused(false);
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }
  restart(): void { this.input.setAction("restart", true); this.input.setAction("restart", false); this.resume(); }

  private frame = (nowMs: number) => {
    this.raf = 0;
    if (this.disposed) return;
    const frameDt = Math.min(MAX_FRAME_DT, Math.max(0, (nowMs - this.lastMs) / 1000));
    this.lastMs = nowMs;
    this.gamepad.poll();
    if (this.input.consumePausePressed()) {
      if (this.paused) this.resume(); else this.pause();
    }
    if (this.input.consumeLiftPressed() && this.state.liftRide <= 0) beginLiftRide(this.state);
    const weather = this.input.consumeWeatherPressed();
    if (weather !== null) this.renderer.setWeather(weather);
    if (!this.paused) {
      this.accumulator += frameDt;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
        const events = stepSimulation(this.state, this.input.nextFrame(), FIXED_DT, this.world);
        if (events.crashed && events.crashReason) this.ui.emit({ type: "crashed", reason: events.crashReason });
        if (events.landed) this.ui.emit({ type: "landed" });
        if (events.gatePassed) this.ui.emit({ type: "gate-passed" });
        if (events.trailChanged) this.ui.emit({ type: "trail-changed", trailIndex: this.state.selectedTrail });
        if (events.finished) this.ui.emit({ type: "finished", reason: "finish" });
        this.accumulator -= FIXED_DT; steps += 1;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
      this.ui.publish(this.state, nowMs);
      this.renderer.render(this.state, this.world, frameDt, this.state.crouch);
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private onResize = () => this.renderer.resize(this.canvas.clientWidth, this.canvas.clientHeight);
  private onBlur = () => this.input.clearHeld();
  private onVisibility = () => { if (document.hidden) this.pause(); else this.input.clearHeld(); };
  private onPointerLockGesture = () => { void this.pointerLock.request(); };

  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0;
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.canvas.removeEventListener("dblclick", this.onPointerLockGesture);
    for (const adapter of this.adapters) adapter.dispose();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock?.();
    this.input.clearHeld(); this.renderer.dispose(); this.ui.dispose();
  }
}
