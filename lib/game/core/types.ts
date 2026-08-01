import type { ResortGameProfile, ResortTrail } from "../config/schema";

export interface Vec3 { x: number; y: number; z: number }

export interface InputFrame {
  steer: number;
  tuck: number;
  brake: number;
  jumpHeld: boolean;
  jumpPressed: boolean;
  restartPressed: boolean;
  trailPressed: boolean;
}

export interface NearestTrail {
  i: number;
  t: ResortTrail;
  d: number;
  dx: number;
  on: boolean;
}

export interface TerrainSampler {
  readonly profile: ResortGameProfile;
  readonly seed: number;
  readonly noiseOffset: Readonly<{ x: number; z: number }>;
  height(x: number, z: number): number;
  normal(x: number, z: number, out: Vec3): Vec3;
  trailField(x: number, z: number): number;
  nearestTrail(x: number, z: number, out: NearestTrail): NearestTrail;
}

export interface Obstacle {
  x: number;
  y: number;
  z: number;
  s: number;
  rot: number;
  type: "tree" | "rock";
  r: number;
}

export interface SimulationWorld {
  readonly profile: ResortGameProfile;
  readonly seed: number;
  readonly terrain: TerrainSampler;
  readonly chunks: Map<string, Obstacle[]>;
}

export interface SimulationState {
  readonly pos: Vec3;
  readonly vel: Vec3;
  yaw: number;
  onGround: boolean;
  airTime: number;
  spin: number;
  crash: number;
  score: number;
  best: number;
  combo: number;
  comboTimer: number;
  time: number;
  startY: number;
  carve: number;
  lean: number;
  crouch: number;
  jumpCharge: number;
  selectedTrail: number;
  liftRide: number;
  liftFromZ: number;
  liftToZ: number;
  invuln: number;
  lastGateZ: number;
  distance: number;
  prevZ: number;
  prevX: number;
  readonly passedGates: Set<number>;
  readonly events: import("./events").SimulationEvents;
}
