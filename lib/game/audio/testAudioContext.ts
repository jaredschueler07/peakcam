import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  GainNodeLike,
  OscillatorNodeLike,
} from "./types";

/**
 * Hand-rolled Web Audio stub for the audio tests. Test-only — nothing in the
 * runtime imports it. It records every scheduling call so a test can assert on
 * the node recipe an event produced without needing a real AudioContext.
 */

export interface ParamCall {
  method: "setValueAtTime" | "setTargetAtTime" | "linearRampToValueAtTime" | "exponentialRampToValueAtTime" | "cancelScheduledValues";
  value: number;
  time: number;
}

export class FakeAudioParam implements AudioParamLike {
  readonly calls: ParamCall[] = [];

  constructor(public value = 0) {}

  setValueAtTime(value: number, startTime: number): void {
    this.calls.push({ method: "setValueAtTime", value, time: startTime });
    this.value = value;
  }

  setTargetAtTime(target: number, startTime: number): void {
    this.calls.push({ method: "setTargetAtTime", value: target, time: startTime });
    this.value = target;
  }

  linearRampToValueAtTime(value: number, endTime: number): void {
    this.calls.push({ method: "linearRampToValueAtTime", value, time: endTime });
  }

  exponentialRampToValueAtTime(value: number, endTime: number): void {
    this.calls.push({ method: "exponentialRampToValueAtTime", value, time: endTime });
  }

  cancelScheduledValues(startTime: number): void {
    this.calls.push({ method: "cancelScheduledValues", value: this.value, time: startTime });
  }

  /** Value of the last scheduling call, ignoring cancellations. */
  get scheduled(): number {
    for (let i = this.calls.length - 1; i >= 0; i--) {
      const call = this.calls[i];
      if (call.method !== "cancelScheduledValues") return call.value;
    }
    return this.value;
  }

  /** Peak value across every ramp/set — the audible level of a one-shot. */
  get peak(): number {
    return this.calls.reduce((max, c) => (c.method === "cancelScheduledValues" ? max : Math.max(max, c.value)), 0);
  }
}

export class FakeAudioNode implements AudioNodeLike {
  readonly connections: (AudioNodeLike | AudioParamLike)[] = [];
  disconnectCount = 0;

  constructor(readonly kind: string) {}

  connect(destination: AudioNodeLike | AudioParamLike): AudioNodeLike {
    this.connections.push(destination);
    return this;
  }

  disconnect(): void {
    this.disconnectCount++;
  }
}

export class FakeGainNode extends FakeAudioNode implements GainNodeLike {
  readonly gain = new FakeAudioParam(1);

  constructor() {
    super("gain");
  }
}

export class FakeBiquadFilterNode extends FakeAudioNode implements BiquadFilterNodeLike {
  type: BiquadFilterType = "lowpass";
  readonly frequency = new FakeAudioParam(350);
  readonly Q = new FakeAudioParam(1);

  constructor() {
    super("biquad");
  }
}

class Schedulable extends FakeAudioNode {
  startCount = 0;
  stopCount = 0;

  start(): void {
    this.startCount++;
  }

  stop(): void {
    this.stopCount++;
  }
}

export class FakeOscillatorNode extends Schedulable implements OscillatorNodeLike {
  type: OscillatorType = "sine";
  readonly frequency = new FakeAudioParam(440);

  constructor() {
    super("oscillator");
  }
}

export class FakeAudioBuffer implements AudioBufferLike {
  private readonly channels: Float32Array[];

  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel];
  }
}

export class FakeAudioBufferSourceNode extends Schedulable implements AudioBufferSourceNodeLike {
  buffer: AudioBufferLike | null = null;
  loop = false;

  constructor() {
    super("bufferSource");
  }
}

export class FakeAudioContext implements AudioContextLike {
  currentTime = 0;
  state: AudioContextState = "suspended";
  readonly destination = new FakeAudioNode("destination");
  /** Every node handed out, in creation order. */
  readonly created: FakeAudioNode[] = [];
  resumeCount = 0;
  suspendCount = 0;
  closeCount = 0;
  /** Overridable so a test can make decoding fail. */
  decodeAudioData: (data: ArrayBuffer) => Promise<AudioBufferLike>;

  constructor(readonly sampleRate = 8000) {
    this.decodeAudioData = async () => new FakeAudioBuffer(1, 128, this.sampleRate);
  }

  createGain(): FakeGainNode {
    return this.track(new FakeGainNode());
  }

  createBufferSource(): FakeAudioBufferSourceNode {
    return this.track(new FakeAudioBufferSourceNode());
  }

  createBiquadFilter(): FakeBiquadFilterNode {
    return this.track(new FakeBiquadFilterNode());
  }

  createOscillator(): FakeOscillatorNode {
    return this.track(new FakeOscillatorNode());
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBufferLike {
    return new FakeAudioBuffer(numberOfChannels, length, sampleRate);
  }

  async resume(): Promise<void> {
    this.resumeCount++;
    this.state = "running";
  }

  async suspend(): Promise<void> {
    this.suspendCount++;
    this.state = "suspended";
  }

  async close(): Promise<void> {
    this.closeCount++;
    this.state = "closed";
  }

  /** Nodes of one kind, newest last. */
  nodesOfKind(kind: string): FakeAudioNode[] {
    return this.created.filter((node) => node.kind === kind);
  }

  private track<T extends FakeAudioNode>(node: T): T {
    this.created.push(node);
    return node;
  }
}
