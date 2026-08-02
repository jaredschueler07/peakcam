import assert from "node:assert/strict";
import test from "node:test";

import {
  physicsModelForSessionRequest,
  resolveRuntimePhysicsModel,
  simulationConfigForConditions,
} from "./physics-selection";

test("runtime physics uses the configured model when no override is present", () => {
  assert.equal(resolveRuntimePhysicsModel("v1", ""), "v1");
  assert.equal(resolveRuntimePhysicsModel("v2", "?other=1"), "v2");
});

test("phys=v2 selects physicsV2 at the runtime seam", () => {
  assert.equal(resolveRuntimePhysicsModel("v1", "?engine=v2&phys=v2"), "v2");
});

test("unknown phys values fail closed to the configured model", () => {
  assert.equal(resolveRuntimePhysicsModel("v1", "?phys=banana"), "v1");
});

test("runtime config combines the live surface with the selected model", () => {
  const selected = resolveRuntimePhysicsModel("v1", "?phys=v2");
  const config = simulationConfigForConditions({ surface: "ice", physicsModel: "v1" }, selected);
  assert.equal(config.surface, "ice");
  assert.equal(config.physicsModel, "v2");
  assert.equal(config.gripMultiplier, 0.7);
});

test("session tickets use the rollout model even when the runtime override resolves v2", () => {
  const conditions = { surface: "packed" as const, physicsModel: "v1" as const };
  assert.equal(resolveRuntimePhysicsModel(conditions.physicsModel, "?phys=v2"), "v2");
  assert.equal(physicsModelForSessionRequest(conditions), "v1");
});
