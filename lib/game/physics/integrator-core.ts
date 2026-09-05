/**
 * The single skier integrator both physics models run.
 *
 * `integrator.ts` (v1) and `integrator-v2.ts` (v2) were ~90% identical: the
 * lift ride, the crash slide, gravity projected onto the slope, the forward
 * speed solve, jump charge/launch, the airborne branch, ground snapping, the
 * speed clamp, gates and obstacles were duplicated line for line. Only three
 * things actually differ, and they are exactly the three seams on
 * {@link CarveModel}: how fast the skier yaws in the air, how the edge grips
 * (v1's fixed `lerp(4.6, 12, edge)` versus v2's surface carve tables with
 * turn-in lag, speed fade and skid drag), and what happens on touchdown (v2
 * scores a clean landing inside a 25° window and opens an absorption window).
 *
 * Behaviour is locked bit-for-bit by `integrator-golden.test.ts`; the two
 * models are two small strategy objects over this one function.
 */
import {
  addScaledVector, clamp, clamp01, damp, dot, length, lerp, multiplyScalar, setVec3,
} from "../core/math";
import type { SimulationConfig } from "../core/config";
import { resetSimulation } from "../core/run-lifecycle";
import type { InputFrame, SimulationState, SimulationWorld, Vec3 } from "../core/types";
import { trailCenter } from "../terrain/trails";
import { pointAtArcLength } from "../terrain/real-course";
import { checkGates, checkObstacleCollision } from "./collision";
import { GRAVITY, LIFT_DURATION, LIFT_OFFSET, MAX_SPEED } from "./constants";

const forward: Vec3 = { x: 0, y: 0, z: 0 };
const right: Vec3 = { x: 0, y: 0, z: 0 };
/** Shared scratch: the terrain normal at the skier, and a projected-gravity pair. */
export const normal: Vec3 = { x: 0, y: 1, z: 0 };
export const temp: Vec3 = { x: 0, y: 0, z: 0 };
export const temp2: Vec3 = { x: 0, y: 0, z: 0 };
const liftArcScratch = { x: 0, y: 0, z: 0, heading: 0 };

/** Grounded-solve inputs, in the skier's own forward/right frame. */
export interface CarveContext {
  steer: number;
  tuck: number;
  brake: number;
  dt: number;
  flatSpeed: number;
  forwardVelocity: number;
  rightVelocity: number;
}

/** Velocities after the edge solve, still in the forward/right frame. */
export interface CarveOutcome {
  forwardVelocity: number;
  rightVelocity: number;
}

const carveContext: CarveContext = { steer: 0, tuck: 0, brake: 0, dt: 0, flatSpeed: 0, forwardVelocity: 0, rightVelocity: 0 };

/** The three places the two physics models genuinely disagree. */
export interface CarveModel {
  /** Per-tick bookkeeping after the lift ride, before input is read. */
  preStep(state: SimulationState, dt: number): void;
  /** Yaw rate, rad/s, while airborne. */
  airTurnRate(state: SimulationState, config: SimulationConfig): number;
  /**
   * Grounded edge solve: lateral grip and the base forward speed. May mutate
   * `state.carve` and `state.edgeAngle`; must not touch `state.vel`.
   */
  carve(state: SimulationState, config: SimulationConfig, ctx: CarveContext): CarveOutcome;
  /** Touchdown after a fall (`launched` frames are excluded by the caller). */
  land(state: SimulationState, world: SimulationWorld, impact: number): void;
  /** Whether obstacle collision is live this tick. */
  obstaclesActive(state: SimulationState): boolean;
}

function liftX(world: SimulationWorld, z: number): number {
  return trailCenter(world.profile.trails[0], z) + LIFT_OFFSET;
}

function cableY(world: SimulationWorld, z: number): number {
  return world.terrain.height(liftX(world, z), z) + 15.5;
}

/** Advance the ride and report whether it consumed the tick. */
function stepLiftRide(s: SimulationState, dt: number, world: SimulationWorld): boolean {
  if (s.liftRide <= 0) return false;
  s.liftRide = Math.max(0, s.liftRide - dt);
  const progress = 1 - s.liftRide / LIFT_DURATION;
  const eased = progress * progress * (3 - 2 * progress);
  const realLift = world.terrain.kind === "real" ? world.terrain.mainLift : null;
  if (realLift) {
    const point = pointAtArcLength(realLift.points, realLift.lengthM * eased, liftArcScratch);
    s.pos.x = point.x; s.pos.y = point.y + 12.8; s.pos.z = point.z;
    s.yaw = point.heading + Math.PI;
  } else {
    const z = lerp(s.liftFromZ, s.liftToZ, eased);
    const x = liftX(world, z);
    s.pos.x = x; s.pos.y = cableY(world, z) - 2.7; s.pos.z = z;
    s.yaw = Math.PI;
  }
  s.vel.x = 0; s.vel.y = 0; s.vel.z = 0;
  s.onGround = false;
  if (s.liftRide <= 0) {
    const best = Math.max(s.best, s.score);
    resetSimulation(s, world, realLift ? 0 : s.liftToZ);
    s.best = best; s.events.liftFinished = true;
  }
  return true;
}

/** Advance the crash slide and report whether it consumed the tick. */
function stepCrash(s: SimulationState, dt: number, world: SimulationWorld): boolean {
  if (s.crash <= 0) return false;
  s.crash -= dt;
  multiplyScalar(s.vel, 1 - 2.4 * dt);
  s.vel.y -= GRAVITY * dt;
  addScaledVector(s.pos, s.vel, dt);
  const groundHeight = world.terrain.height(s.pos.x, s.pos.z);
  if (s.pos.y < groundHeight) { s.pos.y = groundHeight; s.vel.y = 0; }
  if (s.crash <= 0) {
    world.terrain.normal(s.pos.x, s.pos.z, normal);
    s.yaw = Math.atan2(normal.x, normal.z);
    s.vel.x = Math.sin(s.yaw) * 7; s.vel.y = 0; s.vel.z = Math.cos(s.yaw) * 7;
    s.onGround = true; s.invuln = 1.4;
  }
  return true;
}

/** Project gravity onto the slope plane, leaving the fall-line vector in {@link temp}. */
export function projectGravityOntoSlope(): void {
  setVec3(temp, 0, -GRAVITY, 0);
  temp2.x = normal.x; temp2.y = normal.y; temp2.z = normal.z;
  multiplyScalar(temp2, dot(temp, normal));
  temp.x -= temp2.x; temp.y -= temp2.y; temp.z -= temp2.z;
}

/** Arcade powder support: at most15cm of effective float above the DEM, fading into groomers. */
function supportedHeight(world: SimulationWorld, x: number, z: number): number {
  const height = world.terrain.height(x, z);
  const env = world.config.physicsModel === "v2" ? world.config.environment : undefined;
  return env ? height + env.powderDepthCm * 0.0015 * (1 - clamp01(world.terrain.trailField(x, z))) : height;
}

export function integrateWith(
  model: CarveModel,
  state: SimulationState, input: InputFrame, dt: number, world: SimulationWorld,
): void {
  const s = state;
  const cfg = world.config;
  if (stepLiftRide(s, dt, world)) return;

  model.preStep(s, dt);

  const steer = clamp(input.steer, -1, 1);
  const tuck = clamp01(input.tuck);
  const brake = clamp01(input.brake);

  if (stepCrash(s, dt, world)) return;

  const flatSpeed = Math.hypot(s.vel.x, s.vel.z);
  const groundHeight = supportedHeight(world, s.pos.x, s.pos.z);
  world.terrain.normal(s.pos.x, s.pos.z, normal);
  if (s.onGround && s.pos.y < groundHeight) s.pos.y = groundHeight;

  const turnRate = s.onGround
    ? lerp(3.6, 1.35, clamp01(flatSpeed / 46)) * (1 + brake * 0.5)
    : model.airTurnRate(s, cfg);
  s.yaw += steer * turnRate * dt;
  if (!s.onGround) s.spin += Math.abs(steer * turnRate * dt);
  setVec3(forward, Math.sin(s.yaw), 0, Math.cos(s.yaw));
  setVec3(right, forward.z, 0, -forward.x);

  let launched = false;
  if (s.onGround) {
    projectGravityOntoSlope();
    addScaledVector(s.vel, temp, dt);

    const fallLineMagnitude = Math.hypot(temp.x, temp.z);
    const fallLine = fallLineMagnitude > 1e-4
      ? (forward.x * temp.x + forward.z * temp.z) / fallLineMagnitude : 1;
    const assist = clamp01(fallLine * 1.5 + 0.25);
    carveContext.steer = steer; carveContext.tuck = tuck; carveContext.brake = brake;
    carveContext.dt = dt; carveContext.flatSpeed = flatSpeed;
    carveContext.forwardVelocity = dot(s.vel, forward); carveContext.rightVelocity = dot(s.vel, right);
    const carved = model.carve(s, cfg, carveContext);
    let newRightVelocity = carved.rightVelocity;
    let newForwardVelocity = carved.forwardVelocity;

    if (tuck) newForwardVelocity += 6.2 * dt * (cfg.physicsModel === "v2" ? tuck : 1);
    if (!brake && newForwardVelocity < 14) {
      newForwardVelocity += (14 - newForwardVelocity) * 2.2 * assist * dt;
    }
    if (brake) newForwardVelocity -= 6 * dt * Math.sign(newForwardVelocity);
    if (newForwardVelocity < 0) newForwardVelocity *= 0.5;
    if (!brake && newForwardVelocity < 5) newForwardVelocity += 4.5 * assist * dt;

    if (cfg.physicsModel === "v2" && cfg.environment) {
      const env = cfg.environment;
      const corridor = clamp01(world.terrain.trailField(s.pos.x, s.pos.z));
      const offPiste = 1 - corridor;
      if (env.morningIce && normal.z * env.northSign > 0.08) {
        // Recover lateral slip removed by the edge solve on shaded groomers.
        newRightVelocity += (carveContext.rightVelocity - newRightVelocity) * corridor * 0.65;
      }
      // Depth adds progressive drag and buoyant support away from groomed corridors.
      newForwardVelocity *= Math.exp(-(0.12 * offPiste + env.powderDepthCm * 0.004 * offPiste) * dt);
      const exposure = clamp01((1 - normal.y) * 3);
      newForwardVelocity *= Math.exp(-env.windSpeedMps * exposure * 0.006 * dt);
    }

    s.vel.x = forward.x * newForwardVelocity + right.x * newRightVelocity;
    s.vel.z = forward.z * newForwardVelocity + right.z * newRightVelocity;
    s.vel.y = -(s.vel.x * normal.x + s.vel.z * normal.z) / Math.max(normal.y, 0.2);

    if (input.jumpHeld) {
      s.jumpCharge = Math.min(s.jumpCharge + dt, 0.4);
    } else if (s.jumpCharge > 0) {
      addScaledVector(s.vel, normal, 6.8 + s.jumpCharge * 13);
      s.pos.y += 0.2; s.jumpCharge = 0; s.onGround = false; launched = true;
      s.events.jumped = true;
      s.airTime = 0; s.spin = 0;
    }
    if (!launched) { s.airTime = 0; s.spin = 0; }
  } else {
    s.vel.y -= GRAVITY * dt;
    s.vel.x *= 1 - 0.13 * dt;
    s.vel.z *= 1 - 0.13 * dt;
    s.airTime += dt;
    s.carve = damp(s.carve, 0, 6, dt);
    s.jumpCharge = 0;
  }

  addScaledVector(s.pos, s.vel, dt);
  const groundHeight2 = supportedHeight(world, s.pos.x, s.pos.z);
  if (s.onGround) {
    if (s.pos.y <= groundHeight2 + 0.34) s.pos.y = groundHeight2;
    else s.onGround = false;
  } else if (s.pos.y <= groundHeight2) {
    const impact = length(s.vel);
    s.pos.y = groundHeight2; s.onGround = true;
    if (s.vel.y < 0) s.vel.y = 0;
    if (!launched) model.land(s, world, impact);
  }

  const velocity = length(s.vel);
  const maxSpeed = MAX_SPEED * cfg.topSpeedMultiplier;
  if (velocity > maxSpeed) multiplyScalar(s.vel, maxSpeed / velocity);
  s.distance += flatSpeed * dt;
  if (s.invuln > 0) s.invuln -= dt;
  if (model.obstaclesActive(s)) checkObstacleCollision(s, world);
  checkGates(s, world);
}
