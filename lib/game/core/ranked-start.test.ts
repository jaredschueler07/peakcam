import assert from "node:assert/strict";
import { test } from "node:test";
import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import { createProceduralWorld } from "../terrain/obstacles";
import { createSimulation } from "./simulation";
import { resetRankedStart } from "./ranked-start";

test("ranked restart clears transient state while retaining run and renderer vector identities", () => {
  const profile = DROP_IN_GAME_PROFILES.breckenridge;
  const world = createProceduralWorld(profile, 42);
  const state = createSimulation(profile, 42, world.terrain);
  const pos = state.pos, vel = state.vel, events = state.events;
  state.selectedTrail = 2; state.jumpCharge = 0.4; state.crouch = 1;
  state.landingTimer = 0.5; state.time = 20; state.score = 100;
  resetRankedStart(state, world);
  assert.equal(state.pos, pos); assert.equal(state.vel, vel); assert.equal(state.events, events);
  assert.equal(state.selectedTrail, 2);
  assert.equal(state.jumpCharge, 0); assert.equal(state.crouch, 0);
  assert.equal(state.landingTimer, 0); assert.equal(state.time, 0); assert.equal(state.score, 0);
});
