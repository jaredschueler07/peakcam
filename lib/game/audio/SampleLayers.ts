import { clamp, clamp01 } from "../core/math";
import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioNodeLike,
  GainNodeLike,
} from "./types";

/**
 * Streamed-sample layer manager (Phase 7.1: structure only — no audio files
 * ship yet, see docs/drop-in-v2/AUDIO.md).
 *
 * Contract with the rest of the engine: sample layers are an *enhancement*.
 * A failed fetch, a decode error, an abort or a missing manifest must leave
 * the procedural bank playing untouched. Nothing here ever throws at the
 * caller; failures are reported in the returned per-layer results.
 */

export type SampleBus = "music" | "sfx";

export interface SampleLayerSpec {
  /** Stable id used by play()/stop(). */
  name: string;
  /** Absolute or app-relative URL, e.g. /game/audio/wind-alpine.ogg. */
  url: string;
  /** Playback gain, 0..2. Default 1. */
  gain?: number;
  /** Loop the layer (ambience beds) or fire it once. Default true. */
  loop?: boolean;
  /** Which bus it feeds. Default "sfx". */
  bus?: SampleBus;
}

export interface SampleManifest {
  /** Bumped when the asset set changes; lets a cache be invalidated wholesale. */
  version: number;
  layers: readonly SampleLayerSpec[];
}

export type FetchImpl = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export type LayerStatus = "loaded" | "failed" | "aborted";

export interface LayerResult {
  name: string;
  status: LayerStatus;
  reason?: string;
}

export interface LoadReport {
  /** True when at least one layer decoded — the engine may crossfade in. */
  anyLoaded: boolean;
  results: LayerResult[];
}

/** Fraction of the procedural bed ducked away at full sample mix. */
const PROCEDURAL_DUCK = 0.65;
const DEFAULT_CROSSFADE_SECONDS = 1.5;

interface LoadedLayer {
  spec: SampleLayerSpec;
  buffer: AudioBufferLike;
  gain: GainNodeLike;
  source: AudioBufferSourceNodeLike | null;
}

export class SampleLayers {
  private readonly ctx: AudioContextLike;
  private readonly proceduralGain: GainNodeLike;
  private readonly sampleGain: GainNodeLike;
  private readonly buses: Readonly<Record<SampleBus, AudioNodeLike>>;
  private readonly layers = new Map<string, LoadedLayer>();
  private controller: AbortController | null = null;
  private mix = 0;
  private disposed = false;

  constructor(options: {
    ctx: AudioContextLike;
    /** Gain the procedural bank feeds; ducked as samples fade in. */
    proceduralGain: GainNodeLike;
    /** Gain every sample layer feeds; the sample side of the crossfade. */
    sampleGain: GainNodeLike;
    /** Per-bus destinations a layer routes to before the shared sample gain. */
    buses: Readonly<Record<SampleBus, AudioNodeLike>>;
  }) {
    this.ctx = options.ctx;
    this.proceduralGain = options.proceduralGain;
    this.sampleGain = options.sampleGain;
    this.buses = options.buses;
    this.sampleGain.gain.value = 0;
  }

  /** 0 = procedural only, 1 = fully sample-enriched. */
  get currentMix(): number {
    return this.mix;
  }

  get loadedLayerNames(): string[] {
    return [...this.layers.keys()];
  }

  /**
   * Fetch and decode every layer in the manifest. Layers load concurrently and
   * independently: one failure never cancels the others, and the returned
   * report says which made it.
   */
  async loadLayers(
    manifest: SampleManifest,
    fetchImpl?: FetchImpl,
    externalSignal?: AbortSignal,
  ): Promise<LoadReport> {
    if (this.disposed) return { anyLoaded: false, results: [] };
    const fetcher = fetchImpl ?? (globalThis.fetch as FetchImpl | undefined);
    if (!fetcher) {
      return {
        anyLoaded: false,
        results: manifest.layers.map((l) => ({ name: l.name, status: "failed" as const, reason: "no fetch implementation" })),
      };
    }

    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    const results = await Promise.all(
      manifest.layers.map((spec) => this.loadOne(spec, fetcher, controller.signal)),
    );
    if (this.controller === controller) this.controller = null;
    return { anyLoaded: results.some((r) => r.status === "loaded"), results };
  }

  /** Cancel any in-flight loads. Already-decoded layers stay usable. */
  abort(): void {
    this.controller?.abort();
    this.controller = null;
  }

  /**
   * Ramp the procedural/sample balance. `mix` 0 keeps the procedural bed at
   * full and silences samples; 1 ducks the bed by PROCEDURAL_DUCK and brings
   * samples fully in. The bed is never silenced — it is the reactive glue.
   */
  setMix(mix: number, rampSeconds: number = DEFAULT_CROSSFADE_SECONDS): void {
    if (this.disposed) return;
    this.mix = clamp01(mix);
    const t = this.ctx.currentTime;
    const ramp = Math.max(0, rampSeconds);
    this.proceduralGain.gain.cancelScheduledValues(t);
    this.proceduralGain.gain.setValueAtTime(this.proceduralGain.gain.value, t);
    this.proceduralGain.gain.linearRampToValueAtTime(1 - PROCEDURAL_DUCK * this.mix, t + ramp);
    this.sampleGain.gain.cancelScheduledValues(t);
    this.sampleGain.gain.setValueAtTime(this.sampleGain.gain.value, t);
    this.sampleGain.gain.linearRampToValueAtTime(this.mix, t + ramp);
  }

  /** Start a decoded layer. No-op for names that failed to load. */
  play(name: string, when = 0): boolean {
    if (this.disposed) return false;
    const layer = this.layers.get(name);
    if (!layer) return false;
    this.stop(name);
    const source = this.ctx.createBufferSource();
    source.buffer = layer.buffer;
    source.loop = layer.spec.loop ?? true;
    source.connect(layer.gain);
    source.start(when || this.ctx.currentTime);
    layer.source = source;
    return true;
  }

  /** Modulate an existing loop without allocating or restarting its source. */
  setLayerLevel(name: string, level: number, immediate = false): void {
    const layer = this.layers.get(name);
    if (!layer || this.disposed) return;
    const gain = clamp(level, 0, 1) * clamp(layer.spec.gain ?? 1, 0, 2);
    if (immediate) layer.gain.gain.setValueAtTime(gain, this.ctx.currentTime);
    else layer.gain.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.08);
  }

  stop(name: string): void {
    const layer = this.layers.get(name);
    if (!layer?.source) return;
    try {
      layer.source.stop();
    } catch {
      // Never started.
    }
    try {
      layer.source.disconnect();
    } catch {
      // Already detached.
    }
    layer.source = null;
  }

  stopAll(): void {
    for (const name of this.layers.keys()) this.stop(name);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort();
    this.stopAll();
    for (const layer of this.layers.values()) {
      try {
        layer.gain.disconnect();
      } catch {
        // Already detached.
      }
    }
    this.layers.clear();
  }

  private async loadOne(spec: SampleLayerSpec, fetcher: FetchImpl, signal: AbortSignal): Promise<LayerResult> {
    try {
      const response = await fetcher(spec.url, { signal });
      if (!response.ok) return { name: spec.name, status: "failed", reason: `HTTP ${response.status}` };
      const bytes = await response.arrayBuffer();
      if (signal.aborted) return { name: spec.name, status: "aborted" };
      const buffer = await this.ctx.decodeAudioData(bytes);
      if (signal.aborted || this.disposed) return { name: spec.name, status: "aborted" };
      const gain = this.ctx.createGain();
      gain.gain.value = clamp(spec.gain ?? 1, 0, 2);
      gain.connect(this.buses[spec.bus ?? "sfx"]);
      this.layers.set(spec.name, { spec, buffer, gain, source: null });
      return { name: spec.name, status: "loaded" };
    } catch (error) {
      if (signal.aborted) return { name: spec.name, status: "aborted" };
      return { name: spec.name, status: "failed", reason: describeError(error) };
    }
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
