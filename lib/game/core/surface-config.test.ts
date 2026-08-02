import assert from "node:assert/strict";
import test from "node:test";
import { simulationConfig, type CarveParams, type SurfaceKind } from "./config";

const V1_CARVE: CarveParams = {
  gripBase: 4.6, gripEdgeGain: 7.4, gripSpeedFade: 0, skidDrag: 0,
  turnInLag: 0, airAuthority: 1, landingWindow: 0,
};

const SURFACES: readonly SurfaceKind[] = ["powder", "packed", "firm", "ice"];

test("surface modifiers are quantized and packed remains exactly neutral", () => {
  assert.deepEqual(simulationConfig("packed"), {
    surface: "packed", topSpeedMultiplier: 1, gripMultiplier: 1,
    landingImpactThresholdMultiplier: 1, sprayDepthMultiplier: 1,
    physicsModel: "v1", carve: V1_CARVE,
  });
  assert.deepEqual(simulationConfig("powder"), {
    surface: "powder", topSpeedMultiplier: 0.92, gripMultiplier: 1,
    landingImpactThresholdMultiplier: 1.2, sprayDepthMultiplier: 1.4,
    physicsModel: "v1", carve: V1_CARVE,
  });
  assert.equal(simulationConfig("firm").topSpeedMultiplier, 1.05);
  assert.equal(simulationConfig("firm").gripMultiplier, 0.85);
  assert.equal(simulationConfig("ice").gripMultiplier, 0.7);
});

test("v1 is the default model and every v1 row carries the inert v1 carve", () => {
  for (const surface of SURFACES) {
    const implicit = simulationConfig(surface);
    const explicit = simulationConfig(surface, "v1");
    assert.equal(implicit.physicsModel, "v1");
    assert.deepEqual(implicit.carve, V1_CARVE);
    assert.deepEqual(explicit, implicit);
  }
  assert.equal(simulationConfig().physicsModel, "v1");
  assert.equal(simulationConfig().surface, "packed");
});

test("v1 rows keep today's multipliers untouched when only the model differs", () => {
  for (const surface of SURFACES) {
    const v1 = simulationConfig(surface, "v1");
    const v2 = simulationConfig(surface, "v2");
    assert.equal(v2.surface, v1.surface);
    assert.equal(v2.topSpeedMultiplier, v1.topSpeedMultiplier);
    assert.equal(v2.gripMultiplier, v1.gripMultiplier);
    assert.equal(v2.landingImpactThresholdMultiplier, v1.landingImpactThresholdMultiplier);
    assert.equal(v2.sprayDepthMultiplier, v1.sprayDepthMultiplier);
  }
});

test("all four v2 rows exist with their own carve tables", () => {
  assert.equal(simulationConfig("ice", "v2").physicsModel, "v2");
  for (const surface of SURFACES) {
    assert.equal(simulationConfig(surface, "v2").physicsModel, "v2");
    assert.notDeepEqual(simulationConfig(surface, "v2").carve, V1_CARVE);
  }
  assert.deepEqual(simulationConfig("powder", "v2").carve, {
    gripBase: 4.2, gripEdgeGain: 6.5, gripSpeedFade: 0.25, skidDrag: 0.35,
    turnInLag: 0.14, airAuthority: 0.9, landingWindow: 0.22,
  });
  assert.deepEqual(simulationConfig("packed", "v2").carve, {
    gripBase: 5.0, gripEdgeGain: 8.0, gripSpeedFade: 0.3, skidDrag: 0.25,
    turnInLag: 0.08, airAuthority: 1.0, landingWindow: 0.16,
  });
  assert.deepEqual(simulationConfig("firm", "v2").carve, {
    gripBase: 4.4, gripEdgeGain: 8.6, gripSpeedFade: 0.4, skidDrag: 0.2,
    turnInLag: 0.06, airAuthority: 1.0, landingWindow: 0.12,
  });
  assert.deepEqual(simulationConfig("ice", "v2").carve, {
    gripBase: 2.8, gripEdgeGain: 7.2, gripSpeedFade: 0.55, skidDrag: 0.12,
    turnInLag: 0.04, airAuthority: 1.0, landingWindow: 0.08,
  });
});

test("v2 carve tables are distinct per surface", () => {
  const serialized = SURFACES.map((s) => JSON.stringify(simulationConfig(s, "v2").carve));
  assert.equal(new Set(serialized).size, SURFACES.length);
});
