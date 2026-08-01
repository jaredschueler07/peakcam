import assert from "node:assert/strict";
import { test } from "node:test";

import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import { createProceduralWorld } from "../terrain/obstacles";
import { FIXED_DT } from "./clock";
import { createSimulation, stepSimulation } from "./simulation";
import { addScore, bumpCombo } from "./scoring";
import type { InputFrame } from "./types";

const neutral: InputFrame = {
  steer: 0, tuck: 0, brake: 0, jumpHeld: false, jumpPressed: false,
  restartPressed: false, trailPressed: false,
};

test("score uses the current combo and combo caps at twelve", () => {
  const profile = DROP_IN_GAME_PROFILES.heavenly;
  const state = createSimulation(profile, profile.seed);
  for (let i = 0; i < 20; i += 1) bumpCombo(state);
  assert.strictEqual(state.combo, 12);
  assert.strictEqual(addScore(state, 10), 120);
  assert.strictEqual(state.score, 120);
});

test("combo expires after seven simulation seconds", () => {
  const profile = DROP_IN_GAME_PROFILES.heavenly;
  const state = createSimulation(profile, profile.seed);
  const world = createProceduralWorld(profile, profile.seed);
  bumpCombo(state);
  for (let i = 0; i < 841; i += 1) stepSimulation(state, neutral, FIXED_DT, world);
  assert.strictEqual(state.combo, 1);
  assert.ok(state.comboTimer <= 0);
});

test("restart resets score and preserves the personal best", () => {
  const profile = DROP_IN_GAME_PROFILES["ski-portillo"];
  const state = createSimulation(profile, profile.seed);
  const world = createProceduralWorld(profile, profile.seed);
  state.score = 4321;
  stepSimulation(state, { ...neutral, restartPressed: true }, FIXED_DT, world);
  assert.strictEqual(state.score, 0);
  assert.strictEqual(state.best, 4321);
  assert.strictEqual(state.time, 0);
  assert.strictEqual(state.events.reset, true);
});

test("trail action cycles the selected trail and resets onto its centerline", () => {
  const profile = DROP_IN_GAME_PROFILES.breckenridge;
  const state = createSimulation(profile, profile.seed);
  const world = createProceduralWorld(profile, profile.seed);
  stepSimulation(state, { ...neutral, trailPressed: true }, FIXED_DT, world);
  assert.strictEqual(state.selectedTrail, 1);
  assert.strictEqual(state.pos.x, world.terrain.profile.trails[1].off +
    Math.sin(world.terrain.profile.trails[1].phase) * world.terrain.profile.trails[1].amp +
    Math.sin(world.terrain.profile.trails[1].phase * 1.9) * world.terrain.profile.trails[1].amp * 0.26);
  assert.strictEqual(state.events.trailChanged, true);
});
