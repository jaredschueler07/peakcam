/**
 * lib/descent/sim/tuning.ts
 * ─────────────────────────
 * Every number that decides how the rider feels, in one place.
 *
 * Units are SI unless the name says otherwise. Gravity is a little stronger
 * than Earth's so a run reaches speed in game-time rather than in real-time,
 * and drag is tuned so terminal velocity on a blue run is ~100 km/h upright
 * and ~135 km/h in a full tuck — arcade numbers, but inside the leaderboard
 * validator's envelope (`MAX_RUN_SPEED_CMS`, `MAX_ACCEL_CMS2`).
 */

import type { SurfaceKind } from "../types";

export const GRAVITY = 11.8;
/** Hard ceiling on ground speed, m/s (validator rejects > 60.9). */
export const MAX_GROUND_SPEED = 46;
export const MAX_AIR_SPEED = 50;

/** Aerodynamic drag coefficients (a = c·v²). */
export const DRAG_UPRIGHT = 0.0072;
export const DRAG_TUCK = 0.0040;
export const DRAG_BRAKE = 0.0110;
export const DRAG_AIR = 0.0018;

/** Seconds to fully sink into a tuck / stand back up. */
export const TUCK_LAG = 0.18;
/** Seconds of Space-hold for a full-power pop. */
export const CHARGE_TIME = 0.42;
export const POP_MIN = 2.6;
export const POP_MAX = 6.4;
/** A ground lip only throws the rider when the surface drops away faster than this gap. */
export const LIP_GAP_BASE = 0.06;
export const LIP_GAP_PER_MPS = 0.0035;
export const LIP_MIN_SPEED = 5;

/** Edge-angle smoothing, seconds. */
export const EDGE_LAG = 0.09;
/** Skis realign with the direction of travel at this rate (1/s) when not steering. */
export const ALIGN_RATE = 3.2;
/** …and this much while carving (skis are already pointed where they go). */
export const ALIGN_RATE_STEERING = 2.2;

/** Turn rate (rad/s) at a standstill and at MAX_GROUND_SPEED; interpolated by speed. */
export const TURN_RATE_SLOW = 2.7;
export const TURN_RATE_FAST = 0.8;
/** Extra pivot while braking — the "power smear". */
export const SMEAR_YAW = 1.6;

/** Skating push on flats, m/s², and the speed above which the rider stops pushing. */
export const SKATE_PUSH = 4.6;
export const SKATE_MAX_SPEED = 8.5;
/** Skating helps whenever gravity along the skis is below this (m/s²): flats, rises, shallow starts. */
export const SKATE_MAX_ALONG_G = 1.6;

/** In-air rotation. */
export const SPIN_RATE = 5.2;
export const SPIN_LAG = 0.12;
export const FLIP_RATE = 4.6;
export const FLIP_LAG = 0.14;
/** Seconds airborne before steer/tuck/brake start rotating the body. */
export const AIR_ROTATION_DELAY = 0.28;
/** Landing tolerance: how far from clean the body may be, radians. */
export const LAND_SPIN_TOLERANCE = 1.05;
export const LAND_FLIP_TOLERANCE = 0.75;
/** Vertical impact above this crashes; a full crouch absorbs a little more. */
export const LAND_IMPACT_LIMIT = 9.5;
export const LAND_IMPACT_CROUCH_BONUS = 2.5;
/** Fraction of the normal-velocity impact fed back into forward speed on a clean landing. */
export const LAND_KEEP = 0.35;

export const CRASH_TIME = 1.55;
export const CRASH_SPEED_KEEP = 0.55;
export const CRASH_FRICTION = 4.5;
export const TREE_RADIUS_PAD = 0.32;
/** Grace period after a reset / recovery during which trees don't crash the rider. */
export const INVULN_TIME = 0.8;

export const COMBO_WINDOW = 3.2;
export const COMBO_MAX = 5;

export const LIFT_BOARD_RADIUS = 14;

export interface SnowTuning {
  /** Lateral grip at zero edge (1/s). Higher = skis bite sooner. */
  gripBase: number;
  /** Additional grip per unit edge (1/s). */
  gripEdge: number;
  /** Fraction of killed lateral speed converted into forward speed. */
  carveKeep: number;
  /** Rolling / kinetic friction (fraction of g·ny). */
  friction: number;
  /** Extra deceleration while braking, m/s². */
  brakeDecel: number;
  /** Steering authority multiplier. */
  turn: number;
  /** Spray intensity multiplier for the renderer. */
  spray: number;
  /** Human-readable label for the HUD. */
  label: string;
}

export const SNOW: Readonly<Record<SurfaceKind, SnowTuning>> = {
  packed: { gripBase: 5.2, gripEdge: 9.5, carveKeep: 0.62, friction: 0.028, brakeDecel: 6.0, turn: 1.0, spray: 1.0, label: "Groomed" },
  powder: { gripBase: 4.0, gripEdge: 6.8, carveKeep: 0.50, friction: 0.075, brakeDecel: 7.5, turn: 0.82, spray: 1.9, label: "Powder" },
  firm: { gripBase: 4.4, gripEdge: 9.8, carveKeep: 0.60, friction: 0.020, brakeDecel: 4.2, turn: 0.98, spray: 0.7, label: "Firm" },
  ice: { gripBase: 1.6, gripEdge: 3.6, carveKeep: 0.45, friction: 0.010, brakeDecel: 2.4, turn: 0.95, spray: 0.25, label: "Ice" },
  slush: { gripBase: 4.5, gripEdge: 7.5, carveKeep: 0.52, friction: 0.095, brakeDecel: 6.8, turn: 0.88, spray: 1.3, label: "Slush" },
};

/** Style points. */
export const STYLE = {
  airPerSecond: 60,
  spinPer180: 150,
  flipPer360: 320,
  grab: { mute: 250, eagle: 300, daffy: 350, twister: 450 } as const,
  cleanLanding: 1.2,
  carvePerMetre: 0.0,
  gate: 25,
} as const;
