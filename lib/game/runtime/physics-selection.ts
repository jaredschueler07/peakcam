import { simulationConfig, type PhysicsModel, type SurfaceKind } from "../core/config";

function currentSearch(): string {
  return typeof location === "undefined" ? "" : location.search;
}

/** `?phys=v2` is an explicit playtest override at the world-config seam. */
export function resolveRuntimePhysicsModel(
  configured: PhysicsModel,
  search = currentSearch(),
): PhysicsModel {
  return new URLSearchParams(search).get("phys") === "v2" ? "v2" : configured;
}

export function simulationConfigForConditions(
  conditions: { surface: SurfaceKind; physicsModel: PhysicsModel },
  search?: string,
) {
  return simulationConfig(
    conditions.surface,
    resolveRuntimePhysicsModel(conditions.physicsModel, search),
  );
}
