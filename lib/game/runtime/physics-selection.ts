import { simulationConfig, type PhysicsModel, type SimulationEnvironment, type SurfaceKind } from "../core/config";

function currentSearch(): string {
  return typeof location === "undefined" ? "" : location.search;
}

/** `?phys=v2` is an explicit playtest override at the world-config seam. */
export function resolveRuntimePhysicsModel(
  configured: PhysicsModel,
  search = currentSearch(),
): PhysicsModel {
  const override = new URLSearchParams(search).get("phys");
  return override === "v1" || override === "v2" ? override : configured;
}

/** Session tickets always describe the rollout world, never the URL override. */
export function physicsModelForSessionRequest(conditions: { physicsModel: PhysicsModel }): PhysicsModel {
  return conditions.physicsModel;
}

export function simulationConfigForConditions(
  conditions: { surface: SurfaceKind; physicsModel: PhysicsModel; environment?: SimulationEnvironment },
  physicsModel: PhysicsModel = conditions.physicsModel,
) {
  return simulationConfig(
    conditions.surface,
    physicsModel,
    conditions.environment,
  );
}
