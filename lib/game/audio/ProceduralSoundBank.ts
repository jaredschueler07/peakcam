import { clamp, clamp01 } from "../core/math";
import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioEventName,
  AudioEventOptions,
  AudioNodeLike,
  BiquadFilterNodeLike,
  GainNodeLike,
  ListenerState,
  OscillatorNodeLike,
  SurfaceKind,
} from "./types";

/**
 * The zero-download audio layer: the v1 `Sound` graph from
 * public/drop-in/engine.html §8, ported verbatim in its tuning and extended
 * with surface-dependent edge shaping and an ambient wind term.
 *
 * Every constant that has a v1 counterpart is annotated with it. Sample layers
 * (SampleLayers.ts) sit *on top* of this — this bank alone is a complete mix.
 */

/** v1: `sp = clamp01(speed / 55)`. */
const SPEED_REFERENCE_MPS = 55;

/** Two seconds of brown-ish noise, shared by every noise voice. v1 identical. */
const NOISE_SECONDS = 2;

interface EdgeProfile {
  filter: BiquadFilterType;
  /** Filter cutoff at zero carve, Hz. */
  baseHz: number;
  /** Added at full carve, Hz. */
  carveHz: number;
  q: number;
  /** Scale on the edge layer's gain. */
  gain: number;
}

/**
 * Powder is a soft lowpassed hiss; hardpack keeps v1's bandpass; firm and ice
 * climb in frequency, resonance and level into a scrape (DESIGN §3.5).
 */
const EDGE_PROFILES: Readonly<Record<SurfaceKind, EdgeProfile>> = {
  powder: { filter: "lowpass", baseHz: 900, carveHz: 1400, q: 0.7, gain: 0.85 },
  packed: { filter: "bandpass", baseHz: 1500, carveHz: 2600, q: 1.1, gain: 1.0 }, // v1 defaults
  firm: { filter: "bandpass", baseHz: 2300, carveHz: 3000, q: 1.9, gain: 1.15 },
  ice: { filter: "bandpass", baseHz: 3000, carveHz: 3200, q: 2.8, gain: 1.3 },
};

interface BurstSpec {
  kind: "burst";
  vol: number;
  freq: number;
  dur: number;
  filter: BiquadFilterType;
}

interface BlipSpec {
  kind: "blip";
  freq: number;
  vol: number;
  dur: number;
}

type VoiceSpec = BurstSpec | BlipSpec;

const burst = (vol: number, freq: number, dur: number, filter: BiquadFilterType): BurstSpec =>
  ({ kind: "burst", vol, freq, dur, filter });
const blip = (freq: number, vol: number, dur: number): BlipSpec => ({ kind: "blip", freq, vol, dur });

/**
 * One-shot recipes. `default` is used when no variant is given or the variant
 * is unknown. All values with a v1 call site are copied from it exactly.
 */
export const EVENT_RECIPES: Readonly<
  Record<AudioEventName, Readonly<Record<string, readonly VoiceSpec[]>>>
> = {
  // engine.html:2088
  jump: { default: [burst(0.16, 900, 0.18, "lowpass")] },
  // engine.html:2163 (trick landing) and :2173 (small impact)
  land: {
    default: [burst(0.22, 320, 0.3, "lowpass"), burst(0.09, 260, 0.16, "lowpass")],
    soft: [burst(0.09, 260, 0.16, "lowpass")],
    hard: [burst(0.22, 320, 0.3, "lowpass"), burst(0.09, 260, 0.16, "lowpass")],
  },
  // engine.html:2185-2186
  crash: { default: [burst(0.36, 180, 0.55, "lowpass"), burst(0.22, 1400, 0.3, "bandpass")] },
  // engine.html:2230 (clean) and :2236 (missed)
  gate: { default: [blip(760, 0.14, 0.13)], hit: [blip(760, 0.14, 0.13)], miss: [blip(180, 0.12, 0.18)] },
  // engine.html:1965 — lift boarding chime
  lift: { default: [burst(0.18, 520, 0.16, "bandpass")] },
  // No v1 counterpart: a bright stinger in the gate blip's family, an octave up.
  trick: { default: [blip(1180, 0.12, 0.16)] },
  // No v1 counterpart: deliberately quiet, below the gameplay layer.
  ui: { default: [blip(520, 0.06, 0.08)], confirm: [blip(520, 0.06, 0.08)], back: [blip(300, 0.06, 0.09)] },
};

/** A live one-shot voice, tracked so dispose() can tear it down mid-flight. */
interface Voice {
  nodes: AudioNodeLike[];
  source: AudioBufferSourceNodeLike | OscillatorNodeLike;
  endsAt: number;
}

export class ProceduralSoundBank {
  private readonly ctx: AudioContextLike;
  private readonly destination: AudioNodeLike;
  private readonly noiseBuffer: AudioBufferLike;

  private readonly windSource: AudioBufferSourceNodeLike;
  private readonly windFilter: BiquadFilterNodeLike;
  private readonly windGain: GainNodeLike;

  private readonly edgeSource: AudioBufferSourceNodeLike;
  private readonly edgeFilter: BiquadFilterNodeLike;
  private readonly edgeGain: GainNodeLike;

  private readonly liftOscillators: OscillatorNodeLike[];
  private readonly liftFilter: BiquadFilterNodeLike;
  private readonly liftGain: GainNodeLike;
  private readonly liftLfoGain: GainNodeLike;

  private readonly voices = new Set<Voice>();
  private surface: SurfaceKind = "packed";
  private disposed = false;

  constructor(ctx: AudioContextLike, destination: AudioNodeLike) {
    this.ctx = ctx;
    this.destination = destination;
    this.noiseBuffer = createNoiseBuffer(ctx);

    // Wind bed — speed and weather driven.
    this.windSource = ctx.createBufferSource();
    this.windSource.buffer = this.noiseBuffer;
    this.windSource.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "lowpass";
    this.windFilter.frequency.value = 520;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windSource.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(destination);
    this.windSource.start();

    // Edge/carve layer — surface dependent.
    const edge = EDGE_PROFILES[this.surface];
    this.edgeSource = ctx.createBufferSource();
    this.edgeSource.buffer = this.noiseBuffer;
    this.edgeSource.loop = true;
    this.edgeFilter = ctx.createBiquadFilter();
    this.edgeFilter.type = edge.filter;
    this.edgeFilter.frequency.value = edge.baseHz;
    this.edgeFilter.Q.value = edge.q;
    this.edgeGain = ctx.createGain();
    this.edgeGain.gain.value = 0;
    this.edgeSource.connect(this.edgeFilter);
    this.edgeFilter.connect(this.edgeGain);
    this.edgeGain.connect(destination);
    this.edgeSource.start();

    // Lift machinery hum — a detuned saw/sine pair under a slow wobble.
    const saw = ctx.createOscillator();
    saw.type = "sawtooth";
    saw.frequency.value = 47;
    const sine = ctx.createOscillator();
    sine.type = "sine";
    sine.frequency.value = 94.5;
    this.liftFilter = ctx.createBiquadFilter();
    this.liftFilter.type = "lowpass";
    this.liftFilter.frequency.value = 300;
    this.liftGain = ctx.createGain();
    this.liftGain.gain.value = 0;
    saw.connect(this.liftFilter);
    sine.connect(this.liftFilter);
    this.liftFilter.connect(this.liftGain);
    this.liftGain.connect(destination);
    saw.start();
    sine.start();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.6;
    this.liftLfoGain = ctx.createGain();
    this.liftLfoGain.gain.value = 6;
    lfo.connect(this.liftLfoGain);
    this.liftLfoGain.connect(saw.frequency);
    lfo.start();
    this.liftOscillators = [saw, sine, lfo];
  }

  /**
   * Push the continuous layers toward the listener state. Uses
   * `setTargetAtTime` throughout so a 15 Hz update rate still sounds smooth.
   */
  setListenerState(state: ListenerState): void {
    if (this.disposed) return;
    const t = this.ctx.currentTime;
    const sp = clamp01(state.speed / SPEED_REFERENCE_MPS);
    const wind = clamp01(state.windLevel);
    const carve = clamp01(state.carve);

    // v1: 0.02 + sp * 0.30 / 320 + sp * 950, plus the ambient weather term.
    this.windGain.gain.setTargetAtTime(0.02 + sp * 0.3 + wind * (0.03 + sp * 0.12), t, 0.12);
    this.windFilter.frequency.setTargetAtTime(320 + sp * 950 + wind * 220, t, 0.15);

    const edge = EDGE_PROFILES[state.surface] ?? EDGE_PROFILES.packed;
    if (state.surface !== this.surface) {
      this.surface = state.surface;
      this.edgeFilter.type = edge.filter;
      this.edgeFilter.Q.value = edge.q;
    }
    // v1: air ? 0 : carve * 0.24 * (0.35 + sp), scaled by the surface.
    this.edgeGain.gain.setTargetAtTime(
      state.airborne ? 0 : carve * 0.24 * (0.35 + sp) * edge.gain, t, 0.06,
    );
    this.edgeFilter.frequency.setTargetAtTime(edge.baseHz + carve * edge.carveHz + sp * 800, t, 0.08);

    // v1: liftNear * 0.075
    this.liftGain.gain.setTargetAtTime(clamp01(state.liftProximity) * 0.075, t, 0.3);
  }

  playEvent(name: AudioEventName, options: AudioEventOptions = {}): void {
    if (this.disposed) return;
    const recipes = EVENT_RECIPES[name];
    if (!recipes) return;
    const variant = (options.variant && recipes[options.variant]) || recipes.default;
    const scale = clamp(options.gain ?? 1, 0, 2);
    if (scale <= 0) return;
    for (const voice of variant) {
      if (voice.kind === "burst") this.burst(voice.vol * scale, voice.freq, voice.dur, voice.filter);
      else this.blip(voice.freq, voice.vol * scale, voice.dur);
    }
  }

  /** v1 `Sound.burst`: filtered noise with an exponential percussive envelope. */
  burst(vol: number, freq: number, dur: number, filterType: BiquadFilterType = "bandpass"): void {
    if (this.disposed) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.destination);
    src.start(t);
    src.stop(t + dur + 0.05);
    this.trackVoice({ nodes: [src, filter, gain], source: src, endsAt: t + dur + 0.05 });
  }

  /** v1 `Sound.blip`: a triangle rising ~an octave over the note's length. */
  blip(freq: number, vol: number, dur: number): void {
    if (this.disposed) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.9, t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(this.destination);
    osc.start(t);
    osc.stop(t + dur + 0.03);
    this.trackVoice({ nodes: [osc, gain], source: osc, endsAt: t + dur + 0.03 });
  }

  /** Number of one-shot voices still scheduled. Test/telemetry hook. */
  get activeVoiceCount(): number {
    return this.voices.size;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const voice of this.voices) {
      safeStop(voice.source);
      for (const node of voice.nodes) safeDisconnect(node);
    }
    this.voices.clear();
    safeStop(this.windSource);
    safeStop(this.edgeSource);
    for (const osc of this.liftOscillators) safeStop(osc);
    const nodes: AudioNodeLike[] = [
      this.windSource, this.windFilter, this.windGain,
      this.edgeSource, this.edgeFilter, this.edgeGain,
      this.liftFilter, this.liftGain, this.liftLfoGain,
      ...this.liftOscillators,
    ];
    for (const node of nodes) safeDisconnect(node);
  }

  /**
   * Voices are self-stopping; we only keep them so dispose() can cut them off.
   * Sweeping on insert keeps the set from growing over a long run without
   * needing an `onended` handler on every node.
   */
  private trackVoice(voice: Voice): void {
    const now = this.ctx.currentTime;
    for (const existing of this.voices) {
      if (existing.endsAt <= now) {
        for (const node of existing.nodes) safeDisconnect(node);
        this.voices.delete(existing);
      }
    }
    this.voices.add(voice);
  }
}

/**
 * v1's noise buffer: white noise through a one-pole leak, which gives the
 * brown-ish spectrum the wind and edge beds are tuned against.
 */
function createNoiseBuffer(ctx: AudioContextLike): AudioBufferLike {
  const length = Math.max(1, Math.floor(ctx.sampleRate * NOISE_SECONDS));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.2;
  }
  return buffer;
}

function safeStop(node: { stop(when?: number): unknown }): void {
  try {
    node.stop();
  } catch {
    // Already stopped, or never started — nothing to do.
  }
}

function safeDisconnect(node: AudioNodeLike): void {
  try {
    node.disconnect();
  } catch {
    // Already detached.
  }
}
