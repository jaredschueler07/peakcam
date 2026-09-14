/**
 * lib/descent/audio/Sound.ts
 * ──────────────────────────
 * Procedural sound for Descent. No samples required: every layer is noise or
 * an oscillator shaped by filters, so the mountain has a voice the instant the
 * user gestures. Typed against the structural `AudioContextLike` so tests can
 * drive it with a stub and SSR / a missing `AudioContext` is a silent no-op.
 *
 * Continuous layers (updated ~60 Hz, all changes smoothed with setTargetAtTime):
 *   wind  — lowpassed noise; gain ∝ speed² with a floor from the weather wind,
 *           the lowpass opening as speed climbs.
 *   edge  — bandpassed noise; centre frequency by surface (ice glassy, powder
 *           soft, packed in between) plus 20 Hz per m/s; gain ∝ |edge| × speed.
 *   skid  — wider, lower band that opens while braking.
 *   hush  — soft powder wake while on powder and on the ground.
 * One-shots: pop, land, landHard, crash, trick, gate, ui, liftBoard, finish,
 * countdown, go.
 */

import type { AudioContextLike, AudioNodeLike, BiquadFilterNodeLike, GainNodeLike } from "@/lib/game/audio/types";
import type { SurfaceKind } from "../types";

export interface SoundState {
  speed: number;
  onGround: boolean;
  edge: number;
  surface: SurfaceKind;
  braking: boolean;
  tucked: boolean;
  crashed: boolean;
  /** Weather wind, 0..15. */
  wind: number;
  corridor: number;
  liftRiding: boolean;
}

export type SoundEvent = "pop" | "land" | "landHard" | "crash" | "trick" | "gate" | "ui" | "liftBoard" | "finish" | "countdown" | "go";

type ContextFactory = () => AudioContextLike | null;

const EDGE_CENTRE: Readonly<Record<SurfaceKind, number>> = { ice: 2600, powder: 700, packed: 1300, firm: 1700, slush: 950 };
const SMOOTH = 0.06;

function defaultFactory(): AudioContextLike | null {
  if (typeof window === "undefined") return null;
  const Ctor = (window as unknown as { AudioContext?: new () => AudioContext; webkitAudioContext?: new () => AudioContext }).AudioContext
    ?? (window as unknown as { webkitAudioContext?: new () => AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try { return new Ctor() as unknown as AudioContextLike; } catch { return null; }
}

interface NoiseLayer { filter: BiquadFilterNodeLike; gain: GainNodeLike }

export class Sound {
  private ctx: AudioContextLike | null = null;
  private master: GainNodeLike | null = null;
  private noise: AudioNodeLike | null = null;
  private wind: NoiseLayer | null = null;
  private edge: NoiseLayer | null = null;
  private skid: NoiseLayer | null = null;
  private hush: NoiseLayer | null = null;
  private _enabled = true;
  private unlocked = false;
  private readonly factory: ContextFactory;

  constructor(factory: ContextFactory = defaultFactory) {
    this.factory = factory;
  }

  get enabled(): boolean { return this._enabled; }

  /** Must be called from a user gesture. Idempotent. */
  unlock(): void {
    if (this.unlocked) { void this.ctx?.resume().catch(() => {}); return; }
    const ctx = this.factory();
    if (!ctx) return;
    this.ctx = ctx;
    this.unlocked = true;
    try {
      const master = ctx.createGain();
      master.gain.value = this._enabled ? 1 : 0;
      master.connect(ctx.destination);
      this.master = master;

      // One looping noise buffer feeds every continuous layer.
      const seconds = 2;
      const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let seed = 0x9e3779b9;
      for (let i = 0; i < data.length; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        data[i] = (seed / 0xffffffff) * 2 - 1;
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.start();
      this.noise = source;

      this.wind = this.layer("lowpass", 300, 0.6);
      this.edge = this.layer("bandpass", 1300, 1.1);
      this.skid = this.layer("bandpass", 600, 0.5);
      this.hush = this.layer("lowpass", 500, 0.7);
      void ctx.resume().catch(() => {});
    } catch {
      this.ctx = null; this.master = null; this.unlocked = false;
    }
  }

  private layer(type: BiquadFilterType, frequency: number, q: number): NoiseLayer {
    const ctx = this.ctx!;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    this.noise!.connect(filter);
    filter.connect(gain);
    gain.connect(this.master!);
    return { filter, gain };
  }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    const ctx = this.ctx, master = this.master;
    if (!ctx || !master) return;
    try { master.gain.setTargetAtTime(enabled ? 1 : 0, ctx.currentTime, 0.03); } catch { /* closed context */ }
  }

  update(state: SoundState, _dt: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.wind || !this.edge || !this.skid || !this.hush) return;
    const t = ctx.currentTime;
    const speed = Math.max(0, state.speed);
    const speedT = Math.min(1, speed / 45);
    try {
      // Wind bed.
      const windFloor = Math.min(1, state.wind / 15) * 0.12;
      const windGain = state.liftRiding ? windFloor + 0.03 : Math.min(0.55, windFloor + speedT * speedT * 0.5 * (state.tucked ? 1.15 : 1));
      this.wind.gain.gain.setTargetAtTime(windGain, t, SMOOTH);
      this.wind.filter.frequency.setTargetAtTime(250 + speedT * 2800, t, SMOOTH);

      const grounded = state.onGround && !state.crashed && !state.liftRiding;
      // Edge / carve layer.
      const edgeAmount = grounded ? Math.min(1, Math.abs(state.edge)) * Math.min(1, speed / 18) : 0;
      const centre = EDGE_CENTRE[state.surface] + speed * 20;
      this.edge.filter.frequency.setTargetAtTime(centre, t, SMOOTH);
      this.edge.filter.Q.setTargetAtTime(state.surface === "ice" ? 2.2 : 1.1, t, SMOOTH);
      const edgeGain = edgeAmount * (state.surface === "powder" ? 0.14 : 0.28) * (state.braking ? 0.7 : 1);
      this.edge.gain.gain.setTargetAtTime(edgeGain, t, SMOOTH);

      // Skid band while braking.
      const skidGain = grounded && state.braking ? Math.min(1, speed / 15) * 0.32 : 0;
      this.skid.gain.gain.setTargetAtTime(skidGain, t, SMOOTH);
      this.skid.filter.frequency.setTargetAtTime(500 + speed * 12, t, SMOOTH);

      // Powder hush.
      const hushGain = grounded && state.surface === "powder" ? Math.min(1, speed / 20) * 0.22 : 0;
      this.hush.gain.gain.setTargetAtTime(hushGain, t, SMOOTH);
      this.hush.filter.frequency.setTargetAtTime(400 + speed * 8, t, SMOOTH);
    } catch { /* context closed mid-frame */ }
  }

  play(event: SoundEvent): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    try {
      switch (event) {
        case "pop": this.whoosh(0.22, 400, 2400, 0.35); break;
        case "land": this.thump(90, 50, 0.09, 0.45); break;
        case "landHard": this.thump(110, 45, 0.14, 0.8); this.burst(0.12, 900, 0.3); break;
        case "crash": this.burst(0.35, 700, 0.6); this.thump(120, 40, 0.18, 0.9); break;
        case "trick": this.tone(880, 0.08, 0.18, "sine"); this.tone(1320, 0.1, 0.22, "sine", 0.09); break;
        case "gate": this.tone(1900, 0.03, 0.12, "square"); break;
        case "ui": this.tone(1500, 0.04, 0.1, "sine"); break;
        case "liftBoard": this.hum(0.5); break;
        case "finish": this.tone(660, 0.12, 0.25, "triangle"); this.tone(880, 0.12, 0.25, "triangle", 0.14); this.tone(1320, 0.3, 0.28, "triangle", 0.28); break;
        case "countdown": this.tone(440, 0.12, 0.3, "sine"); break;
        case "go": this.tone(880, 0.25, 0.35, "sine"); break;
      }
    } catch { /* closed context */ }
  }

  private whoosh(duration: number, from: number, to: number, level: number): void {
    const ctx = this.ctx!, t = ctx.currentTime;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass"; filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(level, t + duration * 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    this.noise!.connect(filter); filter.connect(gain); gain.connect(this.master!);
    this.expire(gain, filter, duration + 0.05);
  }

  private burst(duration: number, cutoff: number, level: number): void {
    const ctx = this.ctx!, t = ctx.currentTime;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass"; filter.frequency.value = cutoff;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    this.noise!.connect(filter); filter.connect(gain); gain.connect(this.master!);
    this.expire(gain, filter, duration + 0.05);
  }

  private thump(from: number, to: number, duration: number, level: number): void {
    const ctx = this.ctx!, t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain); gain.connect(this.master!);
    osc.start(t); osc.stop(t + duration + 0.02);
  }

  private tone(frequency: number, duration: number, level: number, type: OscillatorType, delay = 0): void {
    const ctx = this.ctx!, t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, t);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(level, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain); gain.connect(this.master!);
    osc.start(t); osc.stop(t + duration + 0.02);
  }

  private hum(duration: number): void {
    const ctx = this.ctx!, t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(70, t);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass"; filter.frequency.value = 220;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(filter); filter.connect(gain); gain.connect(this.master!);
    osc.start(t); osc.stop(t + duration + 0.02);
  }

  private expire(gain: AudioNodeLike, filter: AudioNodeLike, seconds: number): void {
    if (typeof setTimeout !== "function") return;
    setTimeout(() => { try { gain.disconnect(); filter.disconnect(); } catch { /* already gone */ } }, seconds * 1000);
  }

  dispose(): void {
    const ctx = this.ctx;
    this.ctx = null; this.master = null; this.noise = null;
    this.wind = this.edge = this.skid = this.hush = null;
    this.unlocked = false;
    if (ctx) void ctx.close().catch(() => {});
  }
}
