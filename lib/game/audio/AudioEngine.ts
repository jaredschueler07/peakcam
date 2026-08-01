import { clamp01 } from "../core/math";
import { ProceduralSoundBank } from "./ProceduralSoundBank";
import { SampleLayers, type FetchImpl, type LoadReport, type SampleManifest } from "./SampleLayers";
import {
  createListenerState,
  type AudioBusName,
  type AudioContextLike,
  type AudioEventName,
  type AudioEventOptions,
  type GainNodeLike,
  type ListenerState,
} from "./types";

/**
 * Runtime-facing audio facade for Drop In v2.
 *
 * Nothing touches Web Audio until `init()` is called, and `init()` must run
 * inside a user gesture (browsers refuse to start an AudioContext otherwise) —
 * importing this module constructs no context and reads no globals.
 *
 * Bus graph (docs/drop-in-v2/AUDIO.md):
 *
 *   destination
 *   └─ master
 *      ├─ music                       ← sample layers with bus "music"
 *      └─ sfx
 *         ├─ procedural               ← ProceduralSoundBank: beds + one-shots
 *         └─ sampleSfx                ← sample layers with bus "sfx"
 *
 * The engine holds no storage: volumes and the mute/enable flags are set by the
 * caller, which owns persistence.
 */

/** Continuous layers are refreshed at the HUD's rate; see UiBridge.publish. */
export const LISTENER_UPDATE_HZ = 15;
const LISTENER_UPDATE_MS = 1000 / LISTENER_UPDATE_HZ;

const DEFAULT_VOLUMES: Readonly<Record<AudioBusName, number>> = {
  master: 0.85, // v1 master gain
  music: 0.6,
  sfx: 1,
};

export interface AudioEngineOptions {
  /** Initial bus volumes, 0..1. Whatever the caller restored from storage. */
  volumes?: Partial<Record<AudioBusName, number>>;
  /** Initial mute flags. */
  muted?: Partial<Record<AudioBusName, boolean>>;
  /**
   * Global kill switch. When false the engine still initializes but the master
   * bus stays silent and one-shots are dropped, so toggling costs nothing.
   */
  enabled?: boolean;
  /** Monotonic clock in ms, for the listener-state throttle. Injectable for tests. */
  now?: () => number;
  /** Factory used when `init()` is called without a context. */
  createContext?: () => AudioContextLike | null;
}

type BusNodes = Record<AudioBusName, GainNodeLike>;

interface Graph {
  ctx: AudioContextLike;
  buses: BusNodes;
  procedural: GainNodeLike;
  sampleSfx: GainNodeLike;
  bank: ProceduralSoundBank;
  samples: SampleLayers;
  /** True when this engine created the context and therefore may close it. */
  ownsContext: boolean;
}

export class AudioEngine {
  private graph: Graph | null = null;
  private readonly volumes: Record<AudioBusName, number>;
  private readonly muted: Record<AudioBusName, boolean>;
  private enabled: boolean;
  private readonly now: () => number;
  private readonly createContext: () => AudioContextLike | null;
  private readonly listener: ListenerState = createListenerState();
  private lastListenerUpdateMs = -Infinity;
  private disposed = false;

  constructor(options: AudioEngineOptions = {}) {
    this.volumes = { ...DEFAULT_VOLUMES, ...options.volumes };
    this.muted = { master: false, music: false, sfx: false, ...options.muted };
    this.enabled = options.enabled ?? true;
    this.now = options.now ?? defaultNow;
    this.createContext = options.createContext ?? defaultCreateContext;
  }

  /** True once a context exists and the graph is wired. */
  get ready(): boolean {
    return this.graph !== null;
  }

  get context(): AudioContextLike | null {
    return this.graph?.ctx ?? null;
  }

  get sampleLayers(): SampleLayers | null {
    return this.graph?.samples ?? null;
  }

  /**
   * Build the graph. Idempotent: repeated calls (every Start press, say) are
   * no-ops that report the existing state. Must be called from a user gesture.
   * Returns false when Web Audio is unavailable — the game runs silent, never
   * broken.
   */
  init(ctx?: AudioContextLike): boolean {
    if (this.disposed) return false;
    if (this.graph) return true;
    const ownsContext = ctx === undefined;
    let context: AudioContextLike | null;
    try {
      context = ctx ?? this.createContext();
    } catch {
      context = null;
    }
    if (!context) return false;

    try {
      const master = context.createGain();
      const music = context.createGain();
      const sfx = context.createGain();
      const procedural = context.createGain();
      const sampleSfx = context.createGain();
      master.connect(context.destination);
      music.connect(master);
      sfx.connect(master);
      procedural.connect(sfx);
      sampleSfx.connect(sfx);
      procedural.gain.value = 1;
      sampleSfx.gain.value = 0;

      const buses: BusNodes = { master, music, sfx };
      const bank = new ProceduralSoundBank(context, procedural);
      const samples = new SampleLayers({
        ctx: context,
        proceduralGain: procedural,
        sampleGain: sampleSfx,
        buses: { sfx: sampleSfx, music },
      });
      this.graph = { ctx: context, buses, procedural, sampleSfx, bank, samples, ownsContext };
      this.applyBusGains();
      return true;
    } catch {
      this.graph = null;
      return false;
    }
  }

  async resume(): Promise<void> {
    const ctx = this.graph?.ctx;
    if (!ctx || ctx.state !== "suspended") return;
    try {
      await ctx.resume();
    } catch {
      // A resume rejected outside a gesture is not an error we can act on.
    }
  }

  async suspend(): Promise<void> {
    const ctx = this.graph?.ctx;
    if (!ctx || ctx.state !== "running") return;
    try {
      await ctx.suspend();
    } catch {
      // Same.
    }
  }

  /**
   * Push simulation state into the continuous layers, throttled to
   * LISTENER_UPDATE_HZ. Returns whether this call reached the graph, mirroring
   * UiBridge.publish. `nowMs` is injectable so callers can share one clock.
   */
  setListenerState(state: Partial<ListenerState>, nowMs: number = this.now()): boolean {
    Object.assign(this.listener, state);
    this.listener.speed = Math.max(0, this.listener.speed);
    this.listener.carve = clamp01(this.listener.carve);
    this.listener.windLevel = clamp01(this.listener.windLevel);
    this.listener.liftProximity = clamp01(this.listener.liftProximity);
    if (!this.graph || !this.enabled) return false;
    if (nowMs - this.lastListenerUpdateMs < LISTENER_UPDATE_MS) return false;
    this.lastListenerUpdateMs = nowMs;
    this.graph.bank.setListenerState(this.listener);
    return true;
  }

  /** Last state pushed to the layers, clamped. Read-only view for tests/HUD. */
  get listenerState(): Readonly<ListenerState> {
    return this.listener;
  }

  playEvent(name: AudioEventName, options?: AudioEventOptions): void {
    if (!this.graph || !this.enabled) return;
    this.graph.bank.playEvent(name, options);
  }

  setVolume(bus: AudioBusName, volume: number): void {
    this.volumes[bus] = clamp01(volume);
    this.applyBusGains();
  }

  getVolume(bus: AudioBusName): number {
    return this.volumes[bus];
  }

  setMuted(bus: AudioBusName, muted: boolean): void {
    this.muted[bus] = muted;
    this.applyBusGains();
  }

  isMuted(bus: AudioBusName): boolean {
    return this.muted[bus];
  }

  /**
   * Global enable flag. Audio is orthogonal to `prefers-reduced-motion` — the
   * runtime must not derive this from the motion preference; it is its own
   * user-facing setting.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.applyBusGains();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Load streamed sample layers over the procedural bed and crossfade in the
   * ones that arrived. Safe to call before `init()` (reports nothing loaded)
   * and safe to fail — the procedural bank keeps playing either way.
   */
  async loadSampleLayers(
    manifest: SampleManifest,
    fetchImpl?: FetchImpl,
    signal?: AbortSignal,
  ): Promise<LoadReport> {
    if (!this.graph) return { anyLoaded: false, results: [] };
    const report = await this.graph.samples.loadLayers(manifest, fetchImpl, signal);
    if (report.anyLoaded) this.graph.samples.setMix(1);
    return report;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const graph = this.graph;
    this.graph = null;
    if (!graph) return;
    graph.samples.dispose();
    graph.bank.dispose();
    for (const node of [graph.procedural, graph.sampleSfx, graph.buses.music, graph.buses.sfx, graph.buses.master]) {
      try {
        node.disconnect();
      } catch {
        // Already detached.
      }
    }
    if (graph.ownsContext) void graph.ctx.close().catch(() => undefined);
  }

  private applyBusGains(): void {
    const graph = this.graph;
    if (!graph) return;
    const t = graph.ctx.currentTime;
    for (const bus of ["master", "music", "sfx"] as const) {
      const silent = this.muted[bus] || (bus === "master" && !this.enabled);
      graph.buses[bus].gain.setTargetAtTime(silent ? 0 : this.volumes[bus], t, 0.02);
    }
  }
}

function defaultNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function defaultCreateContext(): AudioContextLike | null {
  const scope = globalThis as typeof globalThis & {
    AudioContext?: new () => AudioContextLike;
    webkitAudioContext?: new () => AudioContextLike;
  };
  const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
  return Ctor ? new Ctor() : null;
}
