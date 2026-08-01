import assert from "node:assert/strict";
import { test } from "node:test";

import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import { FIXED_DT } from "../core/clock";
import { beginLiftRide } from "../core/run-lifecycle";
import { checkGates, onLand } from "./collision";
import { createSimulation, stepSimulation } from "../core/simulation";
import type { InputFrame } from "../core/types";
import { createProceduralWorld, getChunk } from "../terrain/obstacles";
import { MAX_SPEED } from "./constants";

const input = (values: Partial<InputFrame> = {}): InputFrame => ({
  steer: 0, tuck: 0, brake: 0, jumpHeld: false, jumpPressed: false,
  restartPressed: false, trailPressed: false, ...values,
});

test("physics clamps analog input and never exceeds the 58 m/s speed cap", () => {
  const profile = DROP_IN_GAME_PROFILES["ski-portillo"];
  const world = createProceduralWorld(profile, profile.seed);
  const state = createSimulation(profile, profile.seed);
  state.vel.x = 100; state.vel.y = 100; state.vel.z = 100;
  stepSimulation(state, input({ steer: 12, tuck: 4, brake: -3 }), FIXED_DT, world);
  assert.ok(Math.hypot(state.vel.x, state.vel.y, state.vel.z) <= MAX_SPEED);
  assert.ok(Number.isFinite(state.yaw));
});

test("holding then releasing jump charges a normal pop and enters air", () => {
  const profile = DROP_IN_GAME_PROFILES["ski-portillo"];
  const world = createProceduralWorld(profile, profile.seed);
  const state = createSimulation(profile, profile.seed);
  for (let i = 0; i < 24; i += 1) stepSimulation(state, input({ jumpHeld: true }), FIXED_DT, world);
  assert.strictEqual(state.jumpCharge, 0.19999999999999998);
  stepSimulation(state, input(), FIXED_DT, world);
  assert.strictEqual(state.onGround, false);
  assert.strictEqual(state.jumpCharge, 0);
  assert.ok(state.vel.y > 0);
});

test("crash recovery restores a seven metre-per-second grounded glide", () => {
  const profile = DROP_IN_GAME_PROFILES.heavenly;
  const world = createProceduralWorld(profile, profile.seed);
  const state = createSimulation(profile, profile.seed);
  state.crash = FIXED_DT / 2;
  stepSimulation(state, input(), FIXED_DT, world);
  assert.strictEqual(state.onGround, true);
  assert.strictEqual(state.invuln, 1.4);
  assert.ok(Math.abs(Math.hypot(state.vel.x, state.vel.z) - 7) < 1e-14);
});

test("lift ride returns the skier 1450m uphill and resets the lap", () => {
  const profile = DROP_IN_GAME_PROFILES.breckenridge;
  const world = createProceduralWorld(profile, profile.seed);
  const state = createSimulation(profile, profile.seed);
  state.pos.z = 1800;
  beginLiftRide(state);
  let steps = 0;
  while (state.liftRide > 0 && steps < 626) {
    stepSimulation(state, input(), FIXED_DT, world);
    steps += 1;
  }
  assert.strictEqual(state.liftRide, 0);
  assert.strictEqual(state.pos.z, 350);
  assert.strictEqual(state.time, 0);
  assert.strictEqual(state.onGround, true);
});

test("obstacle chunks are deterministic and isolated per world", () => {
  const profile = DROP_IN_GAME_PROFILES.heavenly;
  const a = createProceduralWorld(profile, profile.seed);
  const b = createProceduralWorld(profile, profile.seed);
  assert.deepStrictEqual(getChunk(a, 4, 8), getChunk(b, 4, 8));
  assert.notStrictEqual(getChunk(a, 4, 8), getChunk(b, 4, 8));
});

test("gate crossing scores with combo and an on-trail miss clears combo", () => {
  const profile = DROP_IN_GAME_PROFILES["ski-portillo"];
  const world = createProceduralWorld(profile, profile.seed);
  const state = createSimulation(profile, profile.seed);
  const trail = profile.trails[0];
  const gateZ = 96;
  const gateX = trail.off + Math.sin(gateZ * trail.freq + trail.phase) * trail.amp +
    Math.sin(gateZ * trail.freq * 2.71 + trail.phase * 1.9) * trail.amp * 0.26;
  state.prevZ = 95; state.pos.z = 97; state.prevX = gateX; state.pos.x = gateX;
  checkGates(state, world);
  assert.strictEqual(state.score, 240);
  assert.strictEqual(state.combo, 2);
  assert.strictEqual(state.events.gatePassed, true);

  const missed = createSimulation(profile, profile.seed);
  const missX = gateX + trail.half * 0.52 + 2;
  missed.combo = 4; missed.prevZ = 95; missed.pos.z = 97;
  missed.prevX = missX; missed.pos.x = missX;
  checkGates(missed, world);
  assert.strictEqual(missed.combo, 1);
  assert.strictEqual(missed.events.gateMissed, true);
});

test("clean landings bank airtime while misaligned hard landings crash", () => {
  const profile = DROP_IN_GAME_PROFILES.heavenly;
  const clean = createSimulation(profile, profile.seed);
  clean.invuln = 0; clean.airTime = 0.5; clean.vel.z = 20;
  onLand(clean, 20);
  assert.strictEqual(clean.score, 65);
  assert.strictEqual(clean.combo, 2);

  const bad = createSimulation(profile, profile.seed);
  bad.invuln = 0; bad.airTime = 0.5; bad.vel.z = -30;
  onLand(bad, 30);
  assert.strictEqual(bad.crash, 1.7);
  assert.strictEqual(bad.events.crashReason, "LANDING");
});
