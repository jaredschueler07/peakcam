import assert from "node:assert/strict";
import { test } from "node:test";

import type { RunDefinition } from "../config/modes";
import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import {
  createRunLifecycle, resetSimulationOnTerrain, startRun, updateRunLifecycle,
} from "./run-lifecycle";
import { createSimulation } from "./simulation";
import { createProceduralWorld } from "../terrain/obstacles";
import { simulationConfig } from "./config";

const definition: RunDefinition = {
  mode: "time_trial", resortSlug: "heavenly", trailId: "gunbarrel", seed: 38935,
  startZ: 100, finishZ: 500, durationLimitMs: 30_000,
  physicsVersion: 1, courseVersion: 1,
};

test("finite run starts once and finishes at its downhill boundary", () => {
  const lifecycle = createRunLifecycle(definition);
  const state = createSimulation(DROP_IN_GAME_PROFILES.heavenly, definition.seed);
  assert.strictEqual(startRun(lifecycle), true);
  assert.strictEqual(startRun(lifecycle), false);
  state.pos.z = definition.finishZ;
  state.time = 12.5;
  assert.strictEqual(updateRunLifecycle(lifecycle, state), "finish");
  assert.strictEqual(lifecycle.elapsedMs, 12_500);
  assert.strictEqual(lifecycle.status, "finished");
});

test("finite run times out at its duration limit", () => {
  const lifecycle = createRunLifecycle(definition);
  const state = createSimulation(DROP_IN_GAME_PROFILES.heavenly, definition.seed);
  startRun(lifecycle);
  state.time = 30;
  assert.strictEqual(updateRunLifecycle(lifecycle, state), "timeout");
  assert.strictEqual(updateRunLifecycle(lifecycle, state), null);
});

test("reset clears v2 edge angle and landing absorption timer", () => {
  const profile = DROP_IN_GAME_PROFILES.heavenly;
  const world = createProceduralWorld(profile, definition.seed, simulationConfig("packed", "v2"));
  const state = createSimulation(profile, definition.seed, world.terrain);
  state.edgeAngle = 0.75;
  state.landingTimer = 0.19;
  resetSimulationOnTerrain(state, world.terrain);
  assert.equal(state.edgeAngle, 0);
  assert.equal(state.landingTimer, 0);
});
