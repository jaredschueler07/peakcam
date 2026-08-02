import { AudioEngine, type AudioEngineOptions } from "../audio/AudioEngine";
import { loadSampleManifest, SAMPLE_MANIFEST_URL, toSampleManifest } from "../audio/manifest";
import type { AudioEventOptions } from "../audio/types";
import type { SurfaceKind } from "../core/config";
import type { SimulationEvents } from "../core/events";

type ListenerSource = Readonly<{
  speed: number;
  carve: number;
  onGround: boolean;
  liftRide: number;
}>;

export class RuntimeAudio {
  private engine: AudioEngine | null = null;
  private surface: SurfaceKind = "packed";
  /** Reused Partial<ListenerState> for setListenerState — no per-HUD-tick object. */
  private readonly listenerPartial = {
    speed: 0,
    carve: 0,
    airborne: false,
    surface: "packed" as SurfaceKind,
    windLevel: 0,
    liftProximity: 0,
  };

  constructor(private readonly createEngine: () => AudioEngine = () => new AudioEngine()) {}

  start(enabled = true, surface: SurfaceKind = "packed"): boolean {
    this.surface = surface;
    if (!this.engine) this.engine = this.createEngine();
    this.engine.setEnabled(enabled);
    const initialized = this.engine.init();
    if (initialized) void this.engine.resume();
    return initialized;
  }

  get audioEngine(): AudioEngine | null { return this.engine; }

  setEnabled(enabled: boolean): void { this.engine?.setEnabled(enabled); }

  async loadSamples(signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<void> {
    const engine = this.engine;
    if (!engine?.ready) return;
    const file = await loadSampleManifest(SAMPLE_MANIFEST_URL, fetchImpl, signal);
    if (!file) return;
    const report = await engine.loadSampleLayers(toSampleManifest(file), fetchImpl, signal);
    if (!report.anyLoaded || signal.aborted) return;
    engine.sampleLayers?.play("wind-bed");
    engine.sampleLayers?.play(this.surface === "powder" ? "carve-powder" : "carve-packed");
  }

  updateListener(
    state: ListenerSource,
    surface: SurfaceKind,
    windLevel: number,
    nowMs: number,
  ): void {
    const partial = this.listenerPartial;
    partial.speed = state.speed;
    partial.carve = state.carve;
    partial.airborne = !state.onGround;
    partial.surface = surface;
    partial.windLevel = windLevel;
    partial.liftProximity = state.liftRide > 0 ? 1 : 0;
    this.engine?.setListenerState(partial, nowMs);
  }

  playSimulationEvents(events: SimulationEvents): void {
    if (events.jumped) this.play("jump");
    if (events.landed) this.play("land", { variant: events.landingKind ?? "hard" });
    if (events.crashed) this.play("crash");
    if (events.gatePassed) this.play("gate", { variant: "hit" });
    if (events.gateMissed) this.play("gate", { variant: "miss" });
    if (events.trickLanded) this.play("trick");
    if (events.liftFinished) this.engine?.sampleLayers?.stop("lift-hum");
  }

  playLift(): void { this.play("lift"); this.engine?.sampleLayers?.play("lift-hum"); }
  playUi(variant: "confirm" | "back"): void { this.play("ui", { variant }); }

  dispose(): void {
    this.engine?.dispose();
    this.engine = null;
  }

  private play(name: Parameters<AudioEngine["playEvent"]>[0], options?: AudioEventOptions): void {
    if (!this.engine?.isEnabled) return;
    this.engine.playEvent(name, options);
    const sample = name === "jump" ? "jump-whoosh"
      : name === "land" && options?.variant === "soft" ? "land-soft"
      : name === "crash" ? "crash-impact"
      : name === "trick" ? "trick-chime"
      : name === "ui" ? "ui-tick"
      : null;
    if (sample) this.engine?.sampleLayers?.play(sample);
  }
}

export function createRuntimeAudio(options?: AudioEngineOptions): RuntimeAudio {
  return new RuntimeAudio(() => new AudioEngine(options));
}
