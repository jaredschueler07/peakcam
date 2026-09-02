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
import { clamp, clamp01, damp } from "../core/math";
import type { SimulationConfig } from "../core/config";
import type { InputFrame, SimulationState, SimulationWorld } from "../core/types";
import { onLand } from "./collision";
import { MAX_SPEED } from "./constants";
import {
  integrateWith, normal, projectGravityOntoSlope, temp,
  type CarveContext, type CarveModel, type CarveOutcome,
} from "./integrator-core";

/** Cosine of the fall-line half-angle that still counts as a clean landing. */
const CLEAN_LANDING_COS = Math.cos(25 * Math.PI / 180);

const V2_MODEL: CarveModel = {
  preStep(s: SimulationState, dt: number): void {
    if (s.landingTimer > 0) s.landingTimer = Math.max(0, s.landingTimer - dt);
  },

  airTurnRate(s: SimulationState, config: SimulationConfig): number {
    return 3.4 * config.carve.airAuthority * (1 / (1 + s.airTime * 0.8));
  },

  carve(s: SimulationState, cfg: SimulationConfig, ctx: CarveContext): CarveOutcome {
    const { steer, tuck, brake, dt, flatSpeed, forwardVelocity, rightVelocity } = ctx;
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
    const newForwardVelocity = forwardVelocity - (drag + skid * cfg.carve.skidDrag) * forwardVelocity * dt - airDrag * dt;
    s.carve = damp(s.carve, clamp01(Math.abs(rightVelocity) / 13) * (0.35 + s.edgeAngle * 0.65), 9, dt);
    return { forwardVelocity: newForwardVelocity, rightVelocity: newRightVelocity };
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
    onLand(s, cleanLanding ? impact * 0.72 : impact,
      world.config.landingImpactThresholdMultiplier);
  },

  obstaclesActive(s: SimulationState): boolean {
    return s.landingTimer <= 0;
  },
};

export function integrateSkierV2(
  state: SimulationState, input: InputFrame, dt: number, world: SimulationWorld,
): void {
  integrateWith(V2_MODEL, state, input, dt, world);
}
