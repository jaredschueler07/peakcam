import type { ResortGameProfile, ResortTrail } from "../config/schema";
import type { SimulationConfig } from "./config";

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

export type RealRunPoint = Vec3;

export interface RealGate {
  key: number;
  distanceM: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  halfWidthM: number;
}

export interface RealRamp {
  key: number;
  distanceM: number;
  x: number;
  y: number;
  z: number;
  heading: number;
}

export interface RealRun {
  readonly kind: "real";
  readonly sourceIndex: number;
  readonly name: string;
  readonly difficulty: string | null;
  readonly halfWidthM: number;
  readonly points: readonly RealRunPoint[];
  readonly lengthM: number;
  readonly finishM: number;
  readonly gates: readonly RealGate[];
  readonly ramps: readonly RealRamp[];
}

export interface RealLift {
  readonly kind: "real";
  readonly name: string;
  readonly type: string;
  readonly points: readonly RealRunPoint[];
  readonly lengthM: number;
}

export type TrailGeometry =
  | { readonly kind: "procedural"; readonly trail: ResortTrail }
  | { readonly kind: "real"; readonly run: RealRun };

export interface NearestTrail {
  i: number;
  t: TrailGeometry;
  d: number;
  dx: number;
  on: boolean;
}

export interface TerrainSampler {
  readonly kind: "procedural" | "real";
  readonly profile: ResortGameProfile;
  readonly seed: number;
  readonly noiseOffset: Readonly<{ x: number; z: number }>;
  readonly realRuns?: readonly RealRun[];
  readonly mainLift?: RealLift | null;
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
  readonly config: SimulationConfig;
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
  courseProgress: number;
  prevCourseProgress: number;
  finished: boolean;
  readonly passedGates: Set<number>;
  readonly events: import("./events").SimulationEvents;
}
