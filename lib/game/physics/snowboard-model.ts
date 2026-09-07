import { snowFeel, surfaceCarve } from "../core/config";
import { clamp, clamp01, damp } from "../core/math";
import { addScore } from "../core/scoring";
import { crash } from "./collision";
import { GRAVITY } from "./constants";
import { normal, type CarveModel, type CarveOutcome } from "./integrator-core";
import { V2_MODEL, RIDER_MASS_KG } from "./integrator-v2";

export const DUCK_FRONT_RAD = 15 * Math.PI / 180;
export const DUCK_REAR_RAD = -6 * Math.PI / 180;
export const SNOWBOARD_CAMERA_SWING = 15 * Math.PI / 180;
const FLAT_NORMAL_Y = Math.cos(2 * Math.PI / 180);
const outcome: CarveOutcome = { forwardVelocity: 0, rightVelocity: 0 };

/** Dynamic sidecut radius in metres. Heel turns are broader than toe turns. */
export function snowboardTurnRadius(roll: number, speed: number): number {
  const sidecut = roll < 0 ? 10.5 : 8;
  const angle = Math.abs(roll) * 55 * Math.PI / 180;
  return sidecut * Math.cos(angle) / (1 + speed * speed / (GRAVITY * sidecut) * Math.sin(angle));
}

export const V2_SNOWBOARD_MODEL: CarveModel = {
  preStep(s, dt) {
    V2_MODEL.preStep(s, dt); s.grabbing = false;
    if (s.crash > 0) { s.grabTime = 0; s.jumpCharge = 0; }
  },
  airTurnRate(s, cfg) { return V2_MODEL.airTurnRate(s, cfg); },
  groundTurnRate(s, cfg, steer, speed, dt, surface = cfg.surface) {
    s.boardRoll = damp(s.boardRoll, steer, 1 / Math.max(0.04, surfaceCarve(surface).turnInLag), dt);
    // Bound arcade yaw authority even when the analytic radius tends toward zero.
    return clamp(speed / snowboardTurnRadius(s.boardRoll, speed), 0.25, 2.4) * snowFeel(surface).turnAuthority;
  },
  groundDrive(cfg, ctx, velocity, assist) { return V2_MODEL.groundDrive!(cfg, ctx, velocity, assist); },
  jumpMultiplier(charge) { return 1 + 0.25 * clamp01(charge / 0.4); },
  carve(s, cfg, ctx) {
    const solved = V2_MODEL.carve(s, cfg, ctx);
    outcome.forwardVelocity = solved.forwardVelocity;
    outcome.rightVelocity = solved.rightVelocity;
    const slip = ctx.rightVelocity;
    const downhillAcross = normal.x * Math.cos(s.yaw) - normal.z * Math.sin(s.yaw);
    // A downhill skid onto the opposing raised edge; ordinary aligned carving is safe.
    if (s.invuln <= 0 && s.landingTimer <= 0 && Math.abs(s.boardRoll) > 0.35 &&
        Math.abs(slip) > 4 && slip * s.boardRoll < 0 && slip * downhillAcross > 0.5) {
      const severe = 0.5 * RIDER_MASS_KG * slip * slip >= 3240;
      const vx = s.vel.x, vy = s.vel.y, vz = s.vel.z;
      crash(s, "LANDING");
      if (!severe) { s.vel.x = vx * 0.7; s.vel.y = vy; s.vel.z = vz * 0.7; }
      s.crash = severe ? 1.4 : 0.4;
      s.stumble = !severe;
      s.jumpCharge = 0; s.grabTime = 0;
      return outcome;
    }
    if (ctx.tuck > 0.5 && normal.y > FLAT_NORMAL_Y && ctx.forwardVelocity > 0) {
      // Leg extension on the descending face of a roller. No propulsion on a plane.
      const sinAlpha = Math.max(0, normal.x * Math.sin(s.yaw) + normal.z * Math.cos(s.yaw));
      outcome.forwardVelocity += 900 / RIDER_MASS_KG * sinAlpha * ctx.tuck * ctx.dt;
    }
    return outcome;
  },
  land(s, world, impact) {
    const grabbed = s.grabTime;
    V2_MODEL.land(s, world, impact);
    if (s.crash <= 0 && s.events.trickLanded && grabbed > 0.1) addScore(s, Math.round(grabbed * 180));
    s.grabTime = 0; s.grabbing = false;
  },
  obstaclesActive(s) { return V2_MODEL.obstaclesActive(s); },
};
