import type { PhysicsModel } from "../core/config";

/**
 * V3 defaults to the deterministic v2 model. Offline phys=v1 remains available.
 */
export const PHYSICS_V2_ROLLOUT_ENABLED = true;

export function physicsModelForRollout(enabled = PHYSICS_V2_ROLLOUT_ENABLED): PhysicsModel {
  return enabled ? "v2" : "v1";
}
