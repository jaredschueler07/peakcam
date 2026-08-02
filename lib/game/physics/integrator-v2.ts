import {
  addScaledVector, clamp, clamp01, damp, dot, length, lerp, multiplyScalar, setVec3,
} from "../core/math";
import { resetSimulation } from "../core/run-lifecycle";
import type { InputFrame, SimulationState, SimulationWorld, Vec3 } from "../core/types";
import { trailCenter } from "../terrain/trails";
import { pointAtArcLength } from "../terrain/real-course";
import { checkGates, checkObstacleCollision, onLand } from "./collision";
import { GRAVITY, LIFT_DURATION, LIFT_OFFSET, MAX_SPEED } from "./constants";

const forward: Vec3 = { x: 0, y: 0, z: 0 };
const right: Vec3 = { x: 0, y: 0, z: 0 };
const normal: Vec3 = { x: 0, y: 1, z: 0 };
const temp: Vec3 = { x: 0, y: 0, z: 0 };
const temp2: Vec3 = { x: 0, y: 0, z: 0 };

function liftX(world: SimulationWorld, z: number): number {
  return trailCenter(world.profile.trails[0], z) + LIFT_OFFSET;
}

function cableY(world: SimulationWorld, z: number): number {
  return world.terrain.height(liftX(world, z), z) + 15.5;
}

export function integrateSkierV2(
  state: SimulationState, input: InputFrame, dt: number, world: SimulationWorld,
): void {
  const s = state;
  const cfg = world.config;
  if (s.liftRide > 0) {
    s.liftRide = Math.max(0, s.liftRide - dt);
    const progress = 1 - s.liftRide / LIFT_DURATION;
    const eased = progress * progress * (3 - 2 * progress);
    const realLift = world.terrain.kind === "real" ? world.terrain.mainLift : null;
    if (realLift) {
      const point = pointAtArcLength(realLift.points, realLift.lengthM * eased);
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
    return;
  }

  const steer = clamp(input.steer, -1, 1);
  const tuck = clamp01(input.tuck);
  const brake = clamp01(input.brake);

  if (s.crash > 0) {
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
    return;
  }

  const speed = length(s.vel);
  void speed;
  const flatSpeed = Math.hypot(s.vel.x, s.vel.z);
  const groundHeight = world.terrain.height(s.pos.x, s.pos.z);
  world.terrain.normal(s.pos.x, s.pos.z, normal);
  if (s.onGround && s.pos.y < groundHeight) s.pos.y = groundHeight;

  const turnRate = s.onGround
    ? lerp(3.6, 1.35, clamp01(flatSpeed / 46)) * (1 + brake * 0.5)
    : 3.4;
  s.yaw += steer * turnRate * dt;
  if (!s.onGround) s.spin += Math.abs(steer * turnRate * dt);
  setVec3(forward, Math.sin(s.yaw), 0, Math.cos(s.yaw));
  setVec3(right, forward.z, 0, -forward.x);

  let launched = false;
  if (s.onGround) {
    setVec3(temp, 0, -GRAVITY, 0);
    temp2.x = normal.x; temp2.y = normal.y; temp2.z = normal.z;
    multiplyScalar(temp2, dot(temp, normal));
    temp.x -= temp2.x; temp.y -= temp2.y; temp.z -= temp2.z;
    addScaledVector(s.vel, temp, dt);

    const fallLineMagnitude = Math.hypot(temp.x, temp.z);
    const fallLine = fallLineMagnitude > 1e-4
      ? (forward.x * temp.x + forward.z * temp.z) / fallLineMagnitude : 1;
    const assist = clamp01(fallLine * 1.5 + 0.25);
    const forwardVelocity = dot(s.vel, forward);
    const rightVelocity = dot(s.vel, right);
    const drag = 0.10 + brake * 0.90 - tuck * 0.05;
    const airDrag = (tuck ? 0.0030 : 0.0055) * forwardVelocity * Math.abs(forwardVelocity);
    const edgeTarget = clamp(Math.abs(steer), 0, 1);
    const lagRate = 1 / Math.max(cfg.carve.turnInLag, 1e-3);
    s.edgeAngle += (edgeTarget - s.edgeAngle) * (1 - Math.exp(-lagRate * dt));
    const speedFade = 1 - cfg.carve.gripSpeedFade * clamp01(flatSpeed / (MAX_SPEED * cfg.topSpeedMultiplier));
    // v2 carve tables fully own grip; cfg.gripMultiplier is intentionally not applied here.
    const grip = (cfg.carve.gripBase + cfg.carve.gripEdgeGain * s.edgeAngle) * speedFade * (1 + brake * 1.4);
    const newRightVelocity = rightVelocity * Math.exp(-grip * dt);
    const skid = clamp01(Math.abs(rightVelocity) / 13) * (1 - s.edgeAngle);
    let newForwardVelocity = forwardVelocity - (drag + skid * cfg.carve.skidDrag) * forwardVelocity * dt - airDrag * dt;
    s.carve = damp(s.carve, clamp01(Math.abs(rightVelocity) / 13) * (0.35 + s.edgeAngle * 0.65), 9, dt);

    if (tuck) newForwardVelocity += 6.2 * dt;
    if (!brake && newForwardVelocity < 14) {
      newForwardVelocity += (14 - newForwardVelocity) * 2.2 * assist * dt;
    }
    if (brake) newForwardVelocity -= 6 * dt * Math.sign(newForwardVelocity);
    if (newForwardVelocity < 0) newForwardVelocity *= 0.5;
    if (!brake && newForwardVelocity < 5) newForwardVelocity += 4.5 * assist * dt;

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
  const groundHeight2 = world.terrain.height(s.pos.x, s.pos.z);
  if (s.onGround) {
    if (s.pos.y <= groundHeight2 + 0.34) s.pos.y = groundHeight2;
    else s.onGround = false;
  } else if (s.pos.y <= groundHeight2) {
    const impact = length(s.vel);
    s.pos.y = groundHeight2; s.onGround = true;
    if (s.vel.y < 0) s.vel.y = 0;
    if (!launched) onLand(s, impact, world.config.landingImpactThresholdMultiplier);
  }

  const velocity = length(s.vel);
  const maxSpeed = MAX_SPEED * world.config.topSpeedMultiplier;
  if (velocity > maxSpeed) multiplyScalar(s.vel, maxSpeed / velocity);
  s.distance += flatSpeed * dt;
  if (s.invuln > 0) s.invuln -= dt;
  checkObstacleCollision(s, world);
  checkGates(s, world);
}
