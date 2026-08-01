import { createStore, type StoreApi } from "zustand/vanilla";
import type { ResortGameProfile } from "../config/schema";
import type { SimulationState } from "../core/types";

export type GameStatus = "loading" | "ready" | "running" | "paused" | "results" | "error";
export type RuntimeEvent =
  | { type: "crashed"; reason: "TREE" | "ROCK" | "LANDING" }
  | { type: "landed" }
  | { type: "gate-passed" }
  | { type: "trail-changed"; trailIndex: number }
  | { type: "pointer-lock"; status: "acquired" | "denied" | "unsupported" | "lost"; errorName?: string }
  | { type: "finished"; reason: "finish" | "quit" | "timeout" };

export interface HudState {
  status: GameStatus;
  speedKmh: number;
  elapsedSeconds: number;
  verticalFeet: number;
  altitudeFeet: number;
  score: number;
  best: number;
  combo: number;
  trailIndex: number;
  trailName: string;
  crashReason: "TREE" | "ROCK" | "LANDING" | null;
  position: Readonly<{ x: number; z: number }>;
  error: string | null;
}

type Listener = (event: RuntimeEvent) => void;

export class UiBridge {
  readonly store: StoreApi<HudState>;
  private readonly listeners = new Set<Listener>();
  private lastPublishMs = -Infinity;

  constructor(private readonly profile: ResortGameProfile) {
    this.store = createStore(() => ({
      status: "loading", speedKmh: 0, elapsedSeconds: 0, verticalFeet: 0,
      altitudeFeet: profile.summitFt, score: 0, best: 0, combo: 1,
      trailIndex: 0, trailName: profile.trails[0].name, crashReason: null,
      position: { x: 0, z: 0 }, error: null,
    }));
  }

  publish(state: SimulationState, nowMs: number): boolean {
    if (nowMs - this.lastPublishMs < 1000 / 15) return false;
    this.lastPublishMs = nowMs;
    const verticalMetres = Math.max(0, state.startY - state.pos.y);
    this.store.setState({
      speedKmh: Math.round(Math.hypot(state.vel.x, state.vel.z) * 3.6),
      elapsedSeconds: state.time,
      verticalFeet: verticalMetres * 3.28084,
      altitudeFeet: this.profile.summitFt - verticalMetres * 3.28084,
      score: state.score,
      best: state.best,
      combo: state.combo,
      trailIndex: state.selectedTrail,
      trailName: this.profile.trails[state.selectedTrail]?.name ?? "Free Ride",
      position: { x: state.pos.x, z: state.pos.z },
    });
    return true;
  }

  setStatus(status: GameStatus): void { this.store.setState({ status }); }
  setPaused(paused: boolean): void { this.setStatus(paused ? "paused" : "running"); }
  setError(error: string): void { this.store.setState({ status: "error", error }); }
  emit(event: RuntimeEvent): void {
    if (event.type === "crashed") this.store.setState({ crashReason: event.reason });
    if (event.type === "trail-changed") this.store.setState({
      trailIndex: event.trailIndex,
      trailName: this.profile.trails[event.trailIndex]?.name ?? "Free Ride",
    });
    if (event.type === "finished") this.setStatus("results");
    for (const listener of this.listeners) listener(event);
  }
  subscribeEvents(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  dispose(): void { this.listeners.clear(); }
}

