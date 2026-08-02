import type { PhysicsModel } from "../core/config";

/**
 * Feel-gate rollout switch. Jared's sign-off changes this to true; until then
 * every unflagged Drop In session stays on the byte-compatible v1 model.
 */
export const PHYSICS_V2_ROLLOUT_ENABLED = false;

export function physicsModelForRollout(enabled = PHYSICS_V2_ROLLOUT_ENABLED): PhysicsModel {
  return enabled ? "v2" : "v1";
}
