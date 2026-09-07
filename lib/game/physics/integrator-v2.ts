/**
 * Physics model v2 — surface-aware carving.
 *
 * Structure lives in `integrator-core.ts`; this file is v2's answers to
 * {@link CarveModel}. Against v1 it adds: a landing-absorption timer that mutes
 * obstacle collision, air steering scaled by the surface's `airAuthority` and
 * decaying with airtime, a carve solve driven by the surface carve table
 * (turn-in lag on `edgeAngle`, grip that fades with speed, skid drag), and a
 * landing scored against a 25° fall-line window.
 */
import { clamp, clamp01, damp, lerp } from "../core/math";
import { DEEP_POWDER, snowFeel, resistanceForSurface, surfaceCarve, type SimulationConfig } from "../core/config";
import type { InputFrame, SimulationState, SimulationWorld } from "../core/types";
import { integrateSkier } from "./integrator";
import { onLand } from "./collision";
import { GRAVITY, MAX_SPEED } from "./constants";
import {
  integrateWith, normal, projectGravityOntoSlope, temp,
  type CarveContext, type CarveModel, type CarveOutcome,
} from "./integrator-core";

/** Rider plus equipment mass used by the SI force model. */
export const RIDER_MASS_KG = 80;
/** Force / mass integrated analytically for quadratic drag; cannot reverse velocity. */
export function snowResistanceVelocity(velocity: number, cfg: SimulationConfig, dt: number, normalY = normal.y, snow = cfg.snowResistance): number {
  if (!snow || dt <= 0) return velocity;
  const speed = Math.abs(velocity);
  // The immersed leading edge grows with signed fresh-snow depth (60cm is full immersion).
  const immersion = snow === DEEP_POWDER && cfg.environment ? clamp01(cfg.environment.powderDepthCm / 60) : 1;
  const quadratic = immersion * 0.5 * snow.plowCoefficient * snow.densityKgM3 * snow.immersedAreaM2 / RIDER_MASS_KG;
  const afterPlow = speed / (1 + quadratic * speed * dt);
  return Math.sign(velocity) * Math.max(0, afterPlow - snow.kineticFriction * GRAVITY * normalY * dt);
}

/** Cosine of the fall-line half-angle that still counts as a clean landing. */
const CLEAN_LANDING_COS = Math.cos(25 * Math.PI / 180);

const outcome: CarveOutcome = { forwardVelocity: 0, rightVelocity: 0 };

export const V2_MODEL: CarveModel = {
  preStep(s: SimulationState, dt: number): void {
    if (s.landingTimer > 0) s.landingTimer = Math.max(0, s.landingTimer - dt);
  },

  airTurnRate(s: SimulationState, config: SimulationConfig): number {
    return 3.4 * config.carve.airAuthority * (1 / (1 + s.airTime * 0.8));
  },

  groundTurnRate(_s, cfg, _steer, speed, _dt, surface = cfg.surface) {
    return lerp(3.6, 1.35, clamp01(speed / 46)) * snowFeel(surface).turnAuthority;
  },

  groundDrive(cfg, ctx, velocity, assist) {
    if (ctx.brake > 0) {
      // Bounded braking cannot reverse a stopped rider or ignore partial trigger input.
      return Math.sign(velocity) * Math.max(0, Math.abs(velocity) - snowFeel(ctx.surface ?? cfg.surface).brakeDeceleration * ctx.brake * ctx.dt);
    }
    // A gentle start assist only. No automatic acceleration toward 14m/s, and tuck
    // reduces aerodynamic drag instead of adding a constant motor force.
    return ctx.flatSpeed < 2.5 && velocity < 2.5
      ? velocity + (2.5 - velocity) * 1.2 * (normal.y > Math.cos(8 * Math.PI / 180) ? 1 : assist) * ctx.dt : velocity;
  },

  carve(s: SimulationState, cfg: SimulationConfig, ctx: CarveContext): CarveOutcome {
    const { steer, tuck, brake, dt, flatSpeed, forwardVelocity, rightVelocity } = ctx;
    const surface = ctx.surface ?? cfg.surface;
    const feel = snowFeel(surface);
    const carve = surface === cfg.surface ? cfg.carve : surfaceCarve(surface);
    const drag = feel.glideDrag * (1 - tuck * .35) + brake * feel.brakeDrag;
    const airDrag = (0.0055 - 0.0025 * tuck) * forwardVelocity * Math.abs(forwardVelocity);
    const edgeTarget = clamp(Math.abs(steer), 0, 1);
    const lagRate = 1 / Math.max(carve.turnInLag, 1e-3);
    s.edgeAngle += (edgeTarget - s.edgeAngle) * (1 - Math.exp(-lagRate * dt));
    const speedFade = 1 - carve.gripSpeedFade * clamp01(flatSpeed / (MAX_SPEED * cfg.topSpeedMultiplier));
    // v2 carve tables fully own grip; cfg.gripMultiplier is intentionally not applied here.
    const grip = (carve.gripBase + carve.gripEdgeGain * s.edgeAngle) * speedFade * (1 + brake * 1.4);
    const requestedGrip = rightVelocity * (1 - Math.exp(-grip * dt));
    const edgeLimit = feel.lateralLimit * Math.max(.2, normal.y) * dt;
    const newRightVelocity = rightVelocity - clamp(requestedGrip, -edgeLimit, edgeLimit);
    const skid = clamp01(Math.abs(rightVelocity) / 13) * (1 - s.edgeAngle);
    const newForwardVelocity = forwardVelocity - (drag + skid * carve.skidDrag) * forwardVelocity * dt - airDrag * dt;
    s.carve = damp(s.carve, clamp01(Math.abs(rightVelocity) / 13) * (0.35 + s.edgeAngle * 0.65), 9, dt);
    // Plowing opposes travel in either direction, including a sideways powder skid.
    const speedAfterEdge = Math.hypot(newForwardVelocity, newRightVelocity);
    const resistance = speedAfterEdge > 0 ? snowResistanceVelocity(speedAfterEdge, cfg, dt, normal.y, ctx.surface ? resistanceForSurface(surface) : cfg.snowResistance) / speedAfterEdge : 0;
    outcome.forwardVelocity = newForwardVelocity * resistance;
    outcome.rightVelocity = newRightVelocity * resistance;
    return outcome;
  },

  land(s: SimulationState, world: SimulationWorld, impact: number): void {
    world.terrain.normal(s.pos.x, s.pos.z, normal);
    projectGravityOntoSlope();
    const fallLineMagnitude = Math.hypot(temp.x, temp.z);
    const flatVelocityMagnitude = Math.hypot(s.vel.x, s.vel.z);
    const fallLine = fallLineMagnitude > 1e-4 && flatVelocityMagnitude > 1e-4
      ? (s.vel.x * temp.x + s.vel.z * temp.z) /
        (flatVelocityMagnitude * fallLineMagnitude) : 1;
    const cleanLanding = fallLine >= CLEAN_LANDING_COS;
    if (cleanLanding) s.landingTimer = world.config.carve.landingWindow;
    const environment = world.config.environment;
    const powderAbsorption = environment
      ? 1 + environment.powderDepthCm * 0.004 * (1 - clamp01(world.terrain.trailField(s.pos.x, s.pos.z))) : 1;
    if (environment && !cleanLanding) { s.vel.x *= 0.82; s.vel.z *= 0.82; }
    onLand(s, cleanLanding ? impact * 0.72 : impact,
      world.config.landingImpactThresholdMultiplier * powderAbsorption);
  },

  obstaclesActive(s: SimulationState): boolean {
    return s.landingTimer <= 0;
  },
};

export function integrateSkierV2(
  state: SimulationState, input: InputFrame, dt: number, world: SimulationWorld,
): void {
  if (world.config.physicsModel === "v1") integrateSkier(state, input, dt, world);
  else integrateWith(V2_MODEL, state, input, dt, world);
}
