/**
 * lib/descent/types.ts
 * ────────────────────
 * Shared contracts for Descent — the Drop In v3 engine.
 *
 * Descent is a from-scratch rewrite of the Drop In arcade descent, modelled on
 * the feel of a single-file browser ski sim: one fixed-step rider simulation,
 * one three.js scene, one HUD store, no cross-module hidden state. It keeps the
 * parts of the v2 engine that are *data*, not *engine*: the baked real-terrain
 * assets and their pure decoders (`lib/game/terrain/*`), the resort profiles,
 * the live conditions snapshot, and the competition (ticket / ghost / board)
 * API clients.
 *
 * ## Coordinates
 *
 * Game frame is the three.js frame the terrain decoders already produce:
 * `x` east, `y` up (absolute elevation, metres), `z` south. A heading `yaw`
 * (radians) points along `(sin yaw, 0, cos yaw)` — the same convention as
 * `pointAtArcLength().heading` in `lib/game/terrain/real-course.ts`.
 *
 * ## Time
 *
 * The rider sim runs at a fixed `SIM_HZ` (120) inside an accumulator. Every
 * public "seconds" value is simulation time, not wall time.
 */

import type { RealJunction, RealLift, RealRun, TerrainSampler } from "@/lib/game/core/types";
import type { RealTerrainSampler } from "@/lib/game/terrain/real-heightfield";
import type { DecodedFarField } from "@/lib/game/terrain/far-field-format";
import type { ResortGameProfile, ResortWeather } from "@/lib/game/config/schema";
import type { ConditionsSnapshot } from "@/lib/game/conditions";
import type { SurfaceKind } from "@/lib/game/core/config";
import type { RiderStyle } from "@/lib/game/config/rider-style";
import type { DecodedGhost } from "@/lib/game/replay/codec";

export type { SurfaceKind, RiderStyle, ConditionsSnapshot, ResortGameProfile, ResortWeather, RealRun, RealLift, RealJunction };

export const SIM_HZ = 120;
export const SIM_DT = 1 / SIM_HZ;

// ─── Input ───────────────────────────────────────────────────

export type GrabKind = "mute" | "eagle" | "daffy" | "twister";

/**
 * The rider's controls for one simulation step. Analog axes are already
 * blended across devices by `input/Input.ts`; the sim never sees a device.
 *
 * `*Pressed` flags are edge-triggered (true for exactly one sim step);
 * everything else is level-triggered.
 */
export interface InputState {
  /** -1 (left) … +1 (right). Carve on snow, spin in the air. */
  steer: number;
  /** Speed tuck (W / ↑). In the air: front flip. Also skates on flats. */
  tuck: boolean;
  /** Brake / power smear (S / ↓). In the air: back flip. */
  brake: boolean;
  /** Space held: crouch to charge a pop. Released: pop. */
  jumpHeld: boolean;
  jumpReleased: boolean;
  /** Freestyle grab held (J / K / L / I). */
  grab: GrabKind | null;
  /** R — back to the last checkpoint. */
  resetPressed: boolean;
  /** E — board / leave a lift when in a station zone. */
  liftPressed: boolean;
}

export function createInputState(): InputState {
  return { steer: 0, tuck: false, brake: false, jumpHeld: false, jumpReleased: false, grab: null, resetPressed: false, liftPressed: false };
}

// ─── World ───────────────────────────────────────────────────

export interface TreeSite {
  x: number;
  y: number;
  z: number;
  /** Collision + visual radius of the trunk footprint, metres. */
  radiusM: number;
  /** Visual height, metres. */
  heightM: number;
  /** 0..1 variation seed for the renderer. */
  variant: number;
}

export interface CourseGate {
  /** Arc length along the course centreline, metres. */
  distanceM: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  halfWidthM: number;
}

/** One playable line: a real run, oriented downhill and trimmed of its flat top. */
export interface Course {
  /** Stable id (`osm:way:…`) — the competition trail id. */
  id: string;
  name: string;
  difficulty: string | null;
  run: RealRun;
  /** Checkpoints along the line, excluding start and finish. */
  gates: readonly CourseGate[];
  lengthM: number;
  topElevationM: number;
  bottomElevationM: number;
  /** Start pose: first point of the trimmed run, facing along the line. */
  start: { x: number; y: number; z: number; yaw: number };
  finish: { x: number; y: number; z: number; yaw: number };
}

export interface LiftStation {
  x: number;
  y: number;
  z: number;
  radiusM: number;
}

export interface WorldLift {
  index: number;
  lift: RealLift;
  name: string;
  /** Whether a rider can board it (complete source line, ≥ 2 points). */
  rideable: boolean;
  /** Bottom terminal in game coordinates. */
  base: LiftStation;
  /** Top terminal in game coordinates. */
  top: LiftStation;
  speedMps: number;
}

/**
 * Everything the sim and the renderer share about a mountain, built once at
 * load by `world/loadWorld.ts`. Immutable after construction.
 */
export interface World {
  profile: ResortGameProfile;
  conditions: ConditionsSnapshot;
  seed: number;
  /** The real-terrain sampler (bicubic DEM + draped runs). */
  terrain: RealTerrainSampler;
  sampler: TerrainSampler;
  /** Half the bake box edge, metres. World x/z live in `[-half, +half]`. */
  halfSizeM: number;
  /** Every playable line, in roster order (the six profile trails first). */
  courses: readonly Course[];
  lifts: readonly WorldLift[];
  junctions: readonly RealJunction[];
  trees: readonly TreeSite[];
  /** Spatial hash for tree collisions: cell key → tree indices. */
  treeCells: ReadonlyMap<number, readonly number[]>;
  treeCellM: number;
  /** Baked 30 km horizon, or null when the asset is missing. */
  farField: DecodedFarField | null;
  /** Lake polygons in game x/z at a fixed elevation (Portillo's Laguna del Inca). */
  lakes: readonly { name: string; elevationM: number; outer: readonly { x: number; z: number }[] }[];
  /** Elevation above which no trees are placed (from the bake config). */
  treeLineM: number;
}

export function treeCellKey(cx: number, cz: number): number {
  // Both indices fit comfortably in 16 bits at the largest box (6144 m / 16 m).
  return ((cx + 32768) << 16) | ((cz + 32768) & 0xffff);
}

// ─── Rider ───────────────────────────────────────────────────

export type CrashReason = "tree" | "landing" | "rotation";

export interface TrickEvent {
  label: string;
  points: number;
}

/** Per-step event flags. Cleared at the start of every `step()`. */
export interface RiderEvents {
  popped: boolean;
  landed: boolean;
  /** Vertical impact speed of the landing (m/s), for spray and audio. */
  landingImpact: number;
  crashed: CrashReason | null;
  gatePassed: boolean;
  finished: boolean;
  trick: TrickEvent | null;
  reset: boolean;
  liftBoarded: boolean;
  liftExited: boolean;
  /** Set when the rider crosses into a different named run. */
  trailChanged: boolean;
}

export interface RiderState {
  // Kinematics
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** Ski heading. */
  yaw: number;
  /** Heading of travel (differs from `yaw` while skidding). */
  travelYaw: number;
  /** Signed edge angle in [-1, 1], smoothed. Positive = right edge. */
  edge: number;
  /** 0..1 crouch: tuck depth or pop charge. */
  crouch: number;
  /** 0..1 pop charge while Space is held. */
  charge: number;
  /** Level input mirrored for the renderer / HUD: brake and tuck held this step. */
  braking: boolean;
  tucking: boolean;
  /** Parked at the gate until the first control input. */
  held: boolean;
  onGround: boolean;
  airTime: number;
  groundTime: number;
  /** Speed along the snow surface, m/s (0 while airborne is not meaningful — use `speed`). */
  speed: number;
  /** Slope grade (rise/run) under the rider, positive = downhill ahead. */
  grade: number;
  /** Terrain normal under the rider. */
  nx: number; ny: number; nz: number;
  /** Ground elevation under the rider. */
  groundY: number;

  // Air
  spin: number;
  spinVel: number;
  flip: number;
  flipVel: number;
  grab: GrabKind | null;
  grabTime: number;

  // Crash
  crash: number;
  crashReason: CrashReason | null;
  crashCount: number;

  // Snow
  surface: SurfaceKind;
  onTrail: boolean;
  /** Index into `terrain.runs` (the full named network), or -1. */
  nearRunIndex: number;
  nearRunName: string | null;
  /** 0 = plain snow, 1 = fully on a groomed corridor. Renderer/audio blend. */
  corridor: number;

  // Course
  courseIndex: number;
  progressM: number;
  /** Fraction of the course completed, 0..1. */
  progress: number;
  lastGate: number;
  finished: boolean;
  finishTime: number;
  checkpoint: { x: number; y: number; z: number; yaw: number; gate: number; progressM: number };

  // Lift
  liftIndex: number;
  liftDistanceM: number;
  liftSeat: { x: number; y: number; z: number; heading: number };

  // Score
  style: number;
  combo: number;
  comboTimer: number;
  bestTrick: TrickEvent | null;

  // Bookkeeping
  time: number;
  runTime: number;
  distance: number;
  carveDistance: number;
  startY: number;
  verticalM: number;
  /** Ski/skate stride phase, for animation. */
  stride: number;

  events: RiderEvents;
}

export function createRiderEvents(): RiderEvents {
  return {
    popped: false, landed: false, landingImpact: 0, crashed: null, gatePassed: false, finished: false,
    trick: null, reset: false, liftBoarded: false, liftExited: false, trailChanged: false,
  };
}

export function clearRiderEvents(events: RiderEvents): void {
  events.popped = false; events.landed = false; events.landingImpact = 0; events.crashed = null;
  events.gatePassed = false; events.finished = false; events.trick = null; events.reset = false;
  events.liftBoarded = false; events.liftExited = false; events.trailChanged = false;
}

// ─── Runtime ↔ UI ────────────────────────────────────────────

export type CameraPreset = "chase" | "far" | "high" | "helmet";
export const CAMERA_PRESETS: readonly CameraPreset[] = ["chase", "far", "high", "helmet"];

export type DescentPhase = "menu" | "countdown" | "riding" | "finished";

/** HUD snapshot, published ~20× per second. Plain data; safe to put in a store. */
export interface HudSnapshot {
  phase: DescentPhase;
  speedKmh: number;
  style: number;
  combo: number;
  runTime: number;
  progress: number;
  verticalFt: number;
  altitudeFt: number;
  courseName: string;
  courseDifficulty: string | null;
  /** The named run under the rider (may differ from the course while free skiing). */
  trailName: string | null;
  onTrail: boolean;
  surface: SurfaceKind;
  tucked: boolean;
  braking: boolean;
  airborne: boolean;
  crashed: boolean;
  /** Names of the runs at the junction ahead, or null. */
  junction: readonly { name: string; difficulty: string | null }[] | null;
  /** Lift the rider can board right now, or null. */
  liftPrompt: string | null;
  /** Lift being ridden, or null. */
  liftRiding: { name: string; progress: number } | null;
  /** Rider x/z for the minimap. */
  x: number;
  z: number;
  travelYaw: number;
  camera: CameraPreset;
  weatherName: string;
  trailHint: boolean;
  /** Seconds left on the start countdown; 0 once riding. */
  countdown: number;
  /** Short-lived status line ("CAMERA FAR", "CHECKPOINT"), or null. */
  toast: string | null;
  /** Latest trick landed, for the HUD toast; cleared after a few seconds. */
  trick: TrickEvent | null;
  /** Best single trick of the run, and how many times the rider went down. */
  bestTrick: TrickEvent | null;
  crashes: number;
  fps: number;
  gpu: string;
}

export interface DescentOptions {
  canvas: HTMLCanvasElement;
  world: World;
  riderStyle: RiderStyle;
  /** Initial course index into `world.courses`. */
  courseIndex: number;
  /** Weather preset index into `profile.weather`. */
  weatherIndex: number;
  /** Competitive runs record a ghost from the start gate. */
  recordGhost: boolean;
  onHud?(snapshot: HudSnapshot): void;
  onEvent?(event: DescentEvent): void;
}

export type DescentEvent =
  | { type: "finished"; runTimeMs: number; style: number; courseId: string }
  | { type: "crashed"; reason: CrashReason }
  | { type: "trick"; label: string; points: number }
  | { type: "lift"; name: string; state: "boarded" | "exited" }
  | { type: "trail"; name: string | null }
  | { type: "reset" };

export interface GhostSource {
  ghost: DecodedGhost;
  label: string;
}

// ─── Runtime API ─────────────────────────────────────────────

import type { StoreApi } from "zustand/vanilla";
import type { FinishedRunRecording } from "@/lib/game/competition/run-client";

export interface StartRunOptions {
  /** Record a PCGH ghost from the gate for leaderboard submission. */
  recordGhost?: boolean;
  /** World seed the ticket was minted for (stamped into the ghost header). */
  seed?: number;
}

/**
 * What the React shell talks to. Created by `createDescent()` in
 * `lib/descent/index.ts` after `loadWorld()` resolves; owns the canvas, the
 * frame loop, input, audio and the HUD store until `dispose()`.
 */
export interface DescentRuntime {
  readonly world: World;
  readonly hud: StoreApi<HudSnapshot>;
  readonly courseIndex: number;
  /** Show the menu: the rider waits at the gate while the camera drifts. */
  toMenu(): void;
  /** Choose a line (index into `world.courses`) and place the rider at its gate. */
  setCourse(index: number): void;
  /** Countdown, then hand the controls to the player. */
  start(options?: StartRunOptions): void;
  /** Back to the gate of the current course. */
  restart(): void;
  pause(): void;
  resume(): void;
  readonly paused: boolean;
  setWeather(index: number): void;
  cycleWeather(): void;
  cycleCamera(): void;
  setCamera(preset: CameraPreset): void;
  toggleTrailHint(): void;
  setAudioEnabled(enabled: boolean): void;
  setGhost(source: GhostSource | null): void;
  /** The recording of the last finished competitive run, once. */
  takeFinishedRun(): FinishedRunRecording | null;
  /** Touch controls feed the same input state the keyboard does. */
  readonly input: import("./input/Input").InputController;
  dispose(): void;
}
