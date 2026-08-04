/**
 * Structural Web Audio types.
 *
 * The audio modules are typed against these instead of the DOM `AudioContext`
 * so the tests can drive them with a hand-rolled stub. A real `AudioContext`
 * satisfies `AudioContextLike` structurally — no casts needed at the call site.
 */

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): unknown;
  setTargetAtTime(target: number, startTime: number, timeConstant: number): unknown;
  linearRampToValueAtTime(value: number, endTime: number): unknown;
  exponentialRampToValueAtTime(value: number, endTime: number): unknown;
  cancelScheduledValues(startTime: number): unknown;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike | AudioParamLike): unknown;
  disconnect(): unknown;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

export interface BiquadFilterNodeLike extends AudioNodeLike {
  type: BiquadFilterType;
  readonly frequency: AudioParamLike;
  readonly Q: AudioParamLike;
}

export interface OscillatorNodeLike extends AudioNodeLike {
  type: OscillatorType;
  readonly frequency: AudioParamLike;
  start(when?: number): unknown;
  stop(when?: number): unknown;
}

export interface AudioBufferLike {
  readonly length: number;
  readonly sampleRate: number;
  readonly duration: number;
  readonly numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  start(when?: number): unknown;
  stop(when?: number): unknown;
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly destination: AudioNodeLike;
  readonly state: AudioContextState;
  createGain(): GainNodeLike;
  createBufferSource(): AudioBufferSourceNodeLike;
  createBiquadFilter(): BiquadFilterNodeLike;
  createOscillator(): OscillatorNodeLike;
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBufferLike;
  decodeAudioData(audioData: ArrayBuffer): Promise<AudioBufferLike>;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Snow surface quantization from DESIGN §3.6. Lives here until the physics
 * core grows its own copy in Phase 5/6; audio only reads it.
 */
export type SurfaceKind = "powder" | "packed" | "firm" | "ice";

/** Mixer buses. `master` is the parent of the other two. */
export type AudioBusName = "master" | "music" | "sfx";

/** One-shot vocabulary. See docs/drop-in-v2/AUDIO.md. */
export type AudioEventName = "jump" | "land" | "crash" | "gate" | "trick" | "lift" | "ui";

export interface AudioEventOptions {
  /** Linear scale on the whole recipe, clamped to 0..2. Default 1. */
  gain?: number;
  /**
   * Recipe variant. `gate`: "hit" (default) | "miss". `land`: "soft" | "hard"
   * (default). `ui`: "confirm" (default) | "back". Unknown values fall back to
   * the default variant.
   */
  variant?: string;
}

/**
 * Everything the continuous layers need from the simulation. Pushed at ~15 Hz
 * by the runtime; the engine never reads simulation state itself.
 */
export interface ListenerState {
  /** Ground speed in m/s. */
  speed: number;
  /** Carve intensity, 0..1. */
  carve: number;
  /** True while the rider is off the snow — mutes the edge layer. */
  airborne: boolean;
  /** Snow surface under the rider. */
  surface: SurfaceKind;
  /** Ambient wind from the weather preset, 0..1. */
  windLevel: number;
  /** 0 far from a lift, 1 underneath one — drives the machinery hum. */
  liftProximity: number;
}

export function createListenerState(): ListenerState {
  return { speed: 0, carve: 0, airborne: false, surface: "packed", windLevel: 0, liftProximity: 0 };
}
