/**
 * lib/descent/Descent.ts
 * ──────────────────────
 * The runtime: one requestAnimationFrame loop that polls input, steps the
 * rider sim at a fixed 120 Hz, drives audio, records the ghost, publishes the
 * HUD store and renders. Implements `DescentRuntime` for the React shell.
 */

import { createStore, type StoreApi } from "zustand/vanilla";
import { COURSE_VERSION, PHYSICS_VERSION } from "@/lib/game/config/versions";
import { GHOST_SAMPLE_HZ } from "@/lib/game/replay/recorder";
import { encodeGhost, MAX_KEYFRAMES, POSE_AIRBORNE, POSE_BRAKING, POSE_CRASHED, POSE_TUCKED, dequantizeYaw, quantizeYaw, type GhostSample } from "@/lib/game/replay/codec";
import type { FinishedRunRecording } from "@/lib/game/competition/run-client";
import { nearestJunction } from "@/lib/game/terrain/junctions";
import { Sound } from "./audio/Sound";
import { createInput, type HotKey } from "./input/Input";
import { Renderer } from "./render/Renderer";
import { createRiderSim, type RiderSim } from "./sim/rider";
import { autopilot } from "./testing/autopilot";
import {
  CAMERA_PRESETS, SIM_DT, SIM_HZ,
  type CameraPreset, type DescentEvent, type DescentPhase, type DescentRuntime, type GhostSource, type HudSnapshot, type RiderMode, type RiderStyle, type SnowboardStance, type StartRunOptions, type World,
} from "./types";

const MAX_FRAME_DT = 0.1;
const MAX_STEPS_PER_FRAME = 12;
const HUD_HZ = 20;
const COUNTDOWN_S = 3;
const STEPS_PER_GHOST_SAMPLE = SIM_HZ / GHOST_SAMPLE_HZ;

export interface DescentInit {
  canvas: HTMLCanvasElement;
  world: World;
  riderStyle: RiderStyle;
  riderMode?: RiderMode;
  stance?: SnowboardStance;
  weatherIndex: number;
  audioEnabled: boolean;
  forceLowQuality?: boolean;
  onEvent?(event: DescentEvent): void;
}

export class Descent implements DescentRuntime {
  readonly world: World;
  readonly hud: StoreApi<HudSnapshot>;
  readonly input = createInput();
  private readonly renderer: Renderer;
  private readonly sim: RiderSim;
  private readonly sound = new Sound();
  private readonly onEvent: (event: DescentEvent) => void;
  private phase: DescentPhase = "menu";
  private _paused = false;
  private courseIdx = 0;
  private weatherIdx: number;
  private cameraPreset: CameraPreset = "chase";
  private trailHint = true;
  private countdown = 0;
  private toast: string | null = null;
  private toastUntil = 0;
  private trickUntil = 0;
  private accumulator = 0;
  private lastFrame = 0;
  private startedAt = 0;
  private lastHud = 0;
  private raf = 0;
  private disposed = false;
  private readonly fpsWindow: number[] = [];
  private readonly offHotkey: () => void;
  // Ghost recording (competitive runs).
  private recording: GhostSample[] | null = null;
  private recordSeed = 0;
  private stepsSinceSample = 0;
  private stepCount = 0;
  private finishedRun: FinishedRunRecording | null = null;
  // Ghost playback.
  private ghost: GhostSource | null = null;
  private ghostClock = 0;
  /** Dev/e2e only: let the line-following bot drive. */
  private autopilotOn = false;

  constructor(init: DescentInit) {
    this.world = init.world;
    this.weatherIdx = init.weatherIndex;
    this.onEvent = init.onEvent ?? (() => {});
    this.renderer = new Renderer({ canvas: init.canvas, world: init.world, riderStyle: init.riderStyle, riderMode: init.riderMode, stance: init.stance, forceLowQuality: init.forceLowQuality });
    this.sim = createRiderSim(init.world, 0, { riderMode: init.riderMode, stance: init.stance });
    this.sim.resetToStart();
    this.hud = createStore<HudSnapshot>(() => this.snapshot(true));
    this.renderer.terrain.flush(this.sim.state.x, this.sim.state.z);
    this.renderer.snapCamera(this.sim.state);
    this.sound.setEnabled(init.audioEnabled);
    this.input.attach(init.canvas);
    this.offHotkey = this.input.onHotkey((key) => this.hotkey(key));
    this.lastFrame = performance.now();
    this.startedAt = this.lastFrame;
    this.hud.setState(this.snapshot(true));
    // Dev and e2e hook (`?e2e=1` in production): the runtime, diagnostics and the autopilot bot.
    if (typeof window !== "undefined" && (process.env.NODE_ENV !== "production" || new URLSearchParams(window.location.search).has("e2e"))) {
      (window as unknown as { __descent?: Descent }).__descent = this;
    }
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Dev/e2e only: hand the controls to the line-following bot (or take them back). */
  setAutopilot(enabled: boolean): void { this.autopilotOn = enabled; }

  /** Dev diagnostics: renderer timings and GL info. */
  get diagnostics(): { timings: Record<string, number>; fps: number; info: unknown; quality: number } {
    const fps = this.fpsWindow.length ? this.fpsWindow.length / this.fpsWindow.reduce((a, b) => a + b, 0) : 0;
    return { timings: this.renderer.timings, fps, info: this.renderer.gl.info.render, quality: this.renderer.qualityRung };
  }

  // ─── DescentRuntime ──────────────────────────────────────

  get courseIndex(): number { return this.courseIdx; }
  get paused(): boolean { return this._paused; }

  toMenu(): void {
    this.phase = "menu";
    this._paused = false;
    this.recording = null;
    this.sim.resetToStart();
    this.renderer.tracks.clear();
    this.renderer.terrain.flush(this.sim.state.x, this.sim.state.z);
    this.publish(true);
  }

  setCourse(index: number): void {
    if (index < 0 || index >= this.world.courses.length) return;
    this.courseIdx = index;
    this.sim.setCourse(index);
    this.renderer.tracks.clear();
    this.renderer.terrain.flush(this.sim.state.x, this.sim.state.z);
    if (this.phase !== "menu") this.renderer.snapCamera(this.sim.state);
    this.publish(true);
  }

  start(options: StartRunOptions = {}): void {
    this.sound.unlock();
    this.sim.resetToStart();
    this.renderer.tracks.clear();
    this.renderer.terrain.flush(this.sim.state.x, this.sim.state.z);
    this.renderer.snapCamera(this.sim.state);
    this.finishedRun = null;
    this.recording = options.recordGhost ? [] : null;
    this.recordSeed = options.seed ?? this.world.seed;
    this.stepsSinceSample = 0;
    this.stepCount = 0;
    this.ghostClock = 0;
    this.phase = "countdown";
    this._paused = false;
    this.countdown = COUNTDOWN_S;
    this.sound.play("countdown");
    this.publish(true);
  }

  restart(): void {
    const recordGhost = this.recording !== null || this.finishedRun !== null;
    this.start({ recordGhost, seed: this.recordSeed });
  }

  pause(): void {
    if (this.phase === "menu" || this._paused) return;
    this._paused = true;
    this.publish(true);
  }

  resume(): void {
    if (!this._paused) return;
    this._paused = false;
    this.lastFrame = performance.now();
    this.publish(true);
  }

  setWeather(index: number): void {
    const count = this.world.profile.weather.length;
    this.weatherIdx = ((index % count) + count) % count;
    this.say(`WEATHER: ${this.world.profile.weather[this.weatherIdx].name.toUpperCase()}`);
  }

  cycleWeather(): void { this.setWeather(this.weatherIdx + 1); }

  cycleCamera(): void {
    const next = CAMERA_PRESETS[(CAMERA_PRESETS.indexOf(this.cameraPreset) + 1) % CAMERA_PRESETS.length];
    this.setCamera(next);
  }

  setCamera(preset: CameraPreset): void {
    this.cameraPreset = preset;
    this.renderer.snapCamera(this.sim.state);
    this.say(`CAMERA ${preset.toUpperCase()}`);
  }

  toggleTrailHint(): void {
    this.trailHint = !this.trailHint;
    this.say(`TRAIL HINT ${this.trailHint ? "ON" : "OFF"}`);
  }

  setAudioEnabled(enabled: boolean): void {
    this.sound.setEnabled(enabled);
    if (enabled) this.sound.unlock();
  }

  setGhost(source: GhostSource | null): void {
    this.ghost = source;
    this.ghostClock = 0;
    this.renderer.setGhost(source ? { character: "human", outfit: "glacier", board: "nightfall", skis: "nightfall" } : null);
    if (source) this.say(`RACING ${source.label.toUpperCase()}`);
  }

  takeFinishedRun(): FinishedRunRecording | null {
    const run = this.finishedRun;
    this.finishedRun = null;
    return run;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.offHotkey();
    this.input.detach();
    this.sound.dispose();
    this.renderer.dispose();
  }

  // ─── Loop ────────────────────────────────────────────────

  private readonly frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    let dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, MAX_FRAME_DT);
    this.fpsWindow.push(dt);
    if (this.fpsWindow.length > 30) this.fpsWindow.shift();

    this.input.poll();
    const state = this.sim.state;

    if (this.phase === "countdown" && !this._paused) {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const after = Math.ceil(this.countdown);
      if (after < before && after > 0) this.sound.play("countdown");
      if (this.countdown <= 0) {
        this.countdown = 0;
        this.phase = "riding";
        this.sound.play("go");
        this.startedAt = now;
        if (this.recording) { this.sampleGhost(); }
      }
    }

    if (this.phase === "riding" && !this._paused) {
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= SIM_DT && steps < MAX_STEPS_PER_FRAME) {
        if (this.autopilotOn && !state.finished) autopilot(state, this.sim.course, this.input.state);
        this.sim.step(this.input.state, SIM_DT);
        this.input.endStep();
        this.afterStep();
        this.accumulator -= SIM_DT;
        steps += 1;
      }
      if (steps >= MAX_STEPS_PER_FRAME) this.accumulator = 0;
      if (this.ghost) this.advanceGhost(dt);
    } else if (this.phase === "menu") {
      // Keep the rider idle at the gate; the camera drifts.
      this.input.endStep();
    } else {
      this.input.endStep();
    }

    this.updateSound(dt);
    if (now - this.lastHud >= 1000 / HUD_HZ) { this.lastHud = now; this.publish(false); }

    this.renderer.render({
      state, time: (now - this.startedAt) / 1000, dt, phase: this.phase, cameraPreset: this.cameraPreset,
      weatherIndex: this.weatherIdx, courseIndex: this.courseIdx, trailHint: this.trailHint,
    });
  };

  private afterStep(): void {
    const s = this.sim.state;
    const e = s.events;
    this.stepCount += 1;
    if (e.popped) this.sound.play("pop");
    if (e.landed) this.sound.play(e.landingImpact > 6 ? "landHard" : "land");
    if (e.crashed) { this.sound.play("crash"); this.onEvent({ type: "crashed", reason: e.crashed }); }
    if (e.gatePassed) { this.sound.play("gate"); this.say("CHECKPOINT"); }
    if (e.trick) { this.sound.play("trick"); this.trickUntil = performance.now() + 2600; this.hud.setState({ trick: e.trick }); this.onEvent({ type: "trick", label: e.trick.label, points: e.trick.points }); }
    if (e.liftBoarded) { this.sound.play("liftBoard"); this.onEvent({ type: "lift", name: this.world.lifts[s.liftIndex]?.name ?? "Lift", state: "boarded" }); }
    if (e.liftExited) { this.onEvent({ type: "lift", name: "Lift", state: "exited" }); this.renderer.snapCamera(s); }
    if (e.reset) { this.renderer.snapCamera(s); this.renderer.tracks.clear(); this.say("CHECKPOINT RESET"); this.onEvent({ type: "reset" }); }
    if (e.trailChanged) this.onEvent({ type: "trail", name: s.nearRunName });

    if (this.recording) {
      this.stepsSinceSample += 1;
      if (this.stepsSinceSample >= STEPS_PER_GHOST_SAMPLE) { this.stepsSinceSample = 0; this.sampleGhost(); }
      if (e.reset) { this.recording = null; this.say("RUN VOID · RESET USED"); }
    }

    if (e.finished) {
      this.sound.play("finish");
      const runTimeMs = Math.round(s.finishTime * 1000);
      if (this.recording && this.recording.length >= 2) {
        this.sampleGhost();
        const samples = this.recording;
        this.recording = null;
        this.finishedRun = {
          samples,
          score: Math.round(s.style),
          encoded: encodeGhost(samples, {
            physicsVersion: PHYSICS_VERSION, courseVersion: COURSE_VERSION, sampleHz: GHOST_SAMPLE_HZ,
            seed: this.recordSeed, originYCm: Math.round(s.startY * 100),
          }),
        };
      }
      this.phase = "finished";
      this.publish(true);
      this.onEvent({ type: "finished", runTimeMs, style: Math.round(s.style), courseId: this.sim.course.id });
      // Free skiing continues after the line: the shell decides what to show; we keep simulating.
      this.phase = "riding";
    }
  }

  private sampleGhost(): void {
    if (!this.recording || this.recording.length >= MAX_KEYFRAMES) return;
    // The codec needs strictly increasing ticks; a finish on a sample tick would double up.
    const last = this.recording[this.recording.length - 1];
    if (last && last.tick >= this.stepCount) return;
    const s = this.sim.state;
    let flags = 0;
    if (!s.onGround) flags |= POSE_AIRBORNE;
    if (s.crouch > 0.5) flags |= POSE_TUCKED;
    if (s.braking) flags |= POSE_BRAKING;
    if (s.crash > 0) flags |= POSE_CRASHED;
    this.recording.push({
      tick: this.stepCount,
      xCm: Math.round(s.x * 100), zCm: Math.round(s.z * 100),
      groundOffsetCm: Math.round((s.y - s.groundY) * 100),
      yaw: dequantizeYaw(quantizeYaw(s.yaw)),
      speedCms: Math.round(Math.hypot(s.vx, s.vz) * 100),
      poseFlags: flags,
    });
  }

  private advanceGhost(dt: number): void {
    const ghost = this.ghost!;
    this.ghostClock += dt;
    const samples = ghost.ghost.samples;
    const tick = this.ghostClock * SIM_HZ;
    // Binary search the keyframe pair around `tick`.
    let lo = 0, hi = samples.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (samples[mid].tick <= tick) lo = mid; else hi = mid - 1; }
    const a = samples[lo], b = samples[Math.min(samples.length - 1, lo + 1)];
    const span = Math.max(1, b.tick - a.tick);
    const t = Math.min(1, Math.max(0, (tick - a.tick) / span));
    const x = (a.xCm + (b.xCm - a.xCm) * t) / 100, z = (a.zCm + (b.zCm - a.zCm) * t) / 100;
    const offset = (a.groundOffsetCm + (b.groundOffsetCm - a.groundOffsetCm) * t) / 100;
    const y = this.world.terrain.height(x, z) + offset;
    const visible = tick <= samples[samples.length - 1].tick + SIM_HZ * 2;
    this.renderer.setGhostPose({
      x, y, z, yaw: a.yaw, airborne: (a.poseFlags & POSE_AIRBORNE) !== 0, tucked: (a.poseFlags & POSE_TUCKED) !== 0,
      crashed: (a.poseFlags & POSE_CRASHED) !== 0, visible,
    });
  }

  private updateSound(dt: number): void {
    const s = this.sim.state;
    const weather = this.world.profile.weather[this.weatherIdx];
    const riding = this.phase === "riding" && !this._paused;
    this.sound.update({
      speed: riding ? s.speed : 0, onGround: s.onGround, edge: s.edge, surface: s.surface, braking: s.braking && riding,
      tucked: s.tucking, crashed: s.crash > 0, wind: weather?.wind ?? 2, corridor: s.corridor, liftRiding: s.liftIndex >= 0,
    }, dt);
  }

  private hotkey(key: HotKey): void {
    switch (key) {
      case "camera": this.cycleCamera(); break;
      case "weather": this.cycleWeather(); break;
      case "trailHint": this.toggleTrailHint(); break;
      case "restart": if (this.phase !== "menu") this.restart(); break;
      default: break; // help / pause / fullscreen / mute / trailMap / menu are the shell's.
    }
  }

  private say(text: string): void {
    this.toast = text;
    this.toastUntil = performance.now() + 1800;
    this.hud.setState({ toast: text });
  }

  private publish(force: boolean): void {
    void force;
    this.hud.setState(this.snapshot(false));
  }

  private snapshot(initial: boolean): HudSnapshot {
    const s = this.sim.state;
    const course = this.sim.course;
    const now = typeof performance !== "undefined" ? performance.now() : 0;
    if (this.toast && now > this.toastUntil) this.toast = null;
    const junction = initial ? null : nearestJunction(this.world.junctions, s.x, s.z, 70);
    const lift = initial ? null : this.sim.boardableLift();
    const fps = this.fpsWindow.length ? this.fpsWindow.length / this.fpsWindow.reduce((a, b) => a + b, 0) : 0;
    const ridingLift = s.liftIndex >= 0 ? this.world.lifts[s.liftIndex] : null;
    return {
      phase: this.phase,
      speedKmh: Math.round(Math.hypot(s.vx, s.vz) * 3.6),
      style: Math.round(s.style),
      combo: s.combo,
      runTime: s.runTime,
      progress: s.progress,
      verticalFt: Math.round(s.verticalM * 3.28084),
      altitudeFt: Math.round(s.y * 3.28084),
      courseName: course.name,
      courseDifficulty: course.difficulty,
      trailName: s.nearRunName,
      onTrail: s.onTrail,
      surface: s.surface,
      tucked: s.tucking && s.onGround,
      braking: s.braking && s.onGround,
      airborne: !s.onGround && s.liftIndex < 0,
      crashed: s.crash > 0,
      junction: junction ? junction.choices.map((c) => ({ name: c.name, difficulty: c.difficulty })) : null,
      liftPrompt: lift ? lift.name : null,
      liftRiding: ridingLift ? { name: ridingLift.name, progress: s.progress } : null,
      x: s.x, z: s.z, travelYaw: s.travelYaw,
      camera: this.cameraPreset,
      weatherName: this.world.profile.weather[this.weatherIdx]?.name ?? "",
      trailHint: this.trailHint,
      countdown: this.countdown,
      mode: s.mode,
      toast: this.toast,
      trick: now < this.trickUntil ? (this.hud?.getState().trick ?? null) : null,
      bestTrick: s.bestTrick,
      crashes: s.crashCount,
      fps: Math.round(fps),
      gpu: this.renderer?.gpuLabel ?? "WebGL2",
      // Pause is surfaced through phase + a separate flag the shell reads from the runtime.
    };
  }
}
