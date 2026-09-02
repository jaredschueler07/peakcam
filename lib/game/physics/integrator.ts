/**
 * Physics model v1 — the launch integrator.
 *
 * Everything structural lives in `integrator-core.ts`; this file is just v1's
 * three answers to {@link CarveModel}: no per-tick bookkeeping, a flat 3.4
 * rad/s of air steering, a fixed `lerp(4.6, 12, edge)` grip curve scaled by the
 * surface's `gripMultiplier`, and a landing that is simply {@link onLand}.
 */
import { clamp01, damp, lerp } from "../core/math";
import type { SimulationConfig } from "../core/config";
import { clearSimulationEvents } from "../core/events";
import type { InputFrame, SimulationState, SimulationWorld } from "../core/types";
import { onLand } from "./collision";
import { integrateWith, type CarveModel, type CarveContext, type CarveOutcome } from "./integrator-core";

const V1_MODEL: CarveModel = {
  preStep(): void {},

  airTurnRate(): number {
    return 3.4;
  },

  carve(s: SimulationState, config: SimulationConfig, ctx: CarveContext): CarveOutcome {
    const { steer, tuck, brake, dt, forwardVelocity, rightVelocity } = ctx;
    const edge = clamp01(Math.abs(steer));
    const grip = lerp(4.6, 12, edge) * (1 + brake * 1.4) * config.gripMultiplier;
    const newRightVelocity = rightVelocity * Math.exp(-grip * dt);
    s.carve = damp(s.carve, clamp01(Math.abs(rightVelocity) / 13) * (0.35 + edge * 0.65), 9, dt);

    const drag = 0.10 + brake * 0.90 - tuck * 0.05;
    const airDrag = (tuck ? 0.0030 : 0.0055) * forwardVelocity * Math.abs(forwardVelocity);
    const newForwardVelocity = forwardVelocity - drag * forwardVelocity * dt - airDrag * dt;
    return { forwardVelocity: newForwardVelocity, rightVelocity: newRightVelocity };
  },

  land(s: SimulationState, world: SimulationWorld, impact: number): void {
    onLand(s, impact, world.config.landingImpactThresholdMultiplier);
  },

  obstaclesActive(): boolean {
    return true;
  },
};

export function integrateSkier(
  state: SimulationState, input: InputFrame, dt: number, world: SimulationWorld,
): void {
  integrateWith(V1_MODEL, state, input, dt, world);
}

export function preparePhysicsStep(state: SimulationState): void {
  clearSimulationEvents(state.events);
}
