import assert from "node:assert/strict";
import test from "node:test";
import { simulationConfig } from "./config";

test("surface modifiers are quantized and packed remains exactly neutral", () => {
  assert.deepEqual(simulationConfig("packed"), {
    surface: "packed", topSpeedMultiplier: 1, gripMultiplier: 1,
    landingImpactThresholdMultiplier: 1, sprayDepthMultiplier: 1,
  });
  assert.deepEqual(simulationConfig("powder"), {
    surface: "powder", topSpeedMultiplier: 0.92, gripMultiplier: 1,
    landingImpactThresholdMultiplier: 1.2, sprayDepthMultiplier: 1.4,
  });
  assert.equal(simulationConfig("firm").topSpeedMultiplier, 1.05);
  assert.equal(simulationConfig("firm").gripMultiplier, 0.85);
  assert.equal(simulationConfig("ice").gripMultiplier, 0.7);
});

