import assert from "node:assert/strict";
import { test } from "node:test";

import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import { FIXED_DT } from "../core/clock";
import { simulationConfig, type SurfaceKind } from "../core/config";
import { mulberry32 } from "../core/rng";
import { createSimulation, stepSimulation } from "../core/simulation";
import type { InputFrame, SimulationState } from "../core/types";
import { createProceduralWorld } from "../terrain/obstacles";
import { integrateSkierV2 } from "./integrator-v2";

const profile = DROP_IN_GAME_PROFILES["ski-portillo"];

function input(values: Partial<InputFrame> = {}): InputFrame {
  return {
    steer: 0, tuck: 0, brake: 0, jumpHeld: false, jumpPressed: false,
    restartPressed: false, trailPressed: false, ...values,
  };
}

function setup(surface: SurfaceKind = "packed") {
  const world = createProceduralWorld(profile, profile.seed, simulationConfig(surface, "v2"));
  const state = createSimulation(profile, profile.seed, world.terrain);
  state.invuln = 100;
  return { state, world };
}

function rightVelocity(state: SimulationState): number {
  return state.vel.x * Math.cos(state.yaw) - state.vel.z * Math.sin(state.yaw);
}

test("edge angle follows the analytic turn-in lag response", () => {
  const { state, world } = setup();
  const steps = 60;
  for (let i = 0; i < steps; i += 1) integrateSkierV2(state, input({ steer: 1 }), FIXED_DT, world);

  const expected = 1 - Math.exp(-(steps * FIXED_DT) / 0.08);
  assert.ok(Math.abs(state.edgeAngle - expected) < 1e-6);
});

test("a fully edged ski sheds lateral velocity more than twice as fast as a shallow edge", () => {
  const shallow = setup();
  const full = setup();
  for (const [fixture, edge] of [[shallow, 0.2], [full, 1]] as const) {
    fixture.state.vel.x = 10;
    fixture.state.vel.z = 20;
    fixture.state.edgeAngle = edge;
  }

  for (let i = 0; i < 60; i += 1) {
    const sign = i % 2 === 0 ? 1 : -1;
    integrateSkierV2(shallow.state, input({ steer: sign * 0.2 }), FIXED_DT, shallow.world);
    integrateSkierV2(full.state, input({ steer: sign }), FIXED_DT, full.world);
  }

  assert.ok(Math.abs(rightVelocity(shallow.state)) / Math.abs(rightVelocity(full.state)) > 2);
});

test("ice retains more lateral velocity than packed snow after one second", () => {
  const packed = setup("packed");
  const ice = setup("ice");
  for (const fixture of [packed, ice]) {
    fixture.state.vel.x = 10;
    fixture.state.vel.z = 20;
  }

  for (let i = 0; i < 120; i += 1) {
    const steer = i % 2 === 0 ? 1 : -1;
    integrateSkierV2(packed.state, input({ steer }), FIXED_DT, packed.world);
    integrateSkierV2(ice.state, input({ steer }), FIXED_DT, ice.world);
  }

  assert.ok(Math.abs(rightVelocity(ice.state)) > Math.abs(rightVelocity(packed.state)));
});

test("v2 simulation is deterministic over 600 seeded fixed steps", () => {
  const a = setup("firm");
  const b = setup("firm");
  const random = mulberry32(0x12cafe);
  const frames = Array.from({ length: 600 }, () => input({
    steer: random() * 2 - 1,
    tuck: random(),
    brake: random() > 0.84 ? random() : 0,
    jumpHeld: random() > 0.97,
  }));

  for (const frame of frames) {
    stepSimulation(a.state, frame, FIXED_DT, a.world);
    stepSimulation(b.state, frame, FIXED_DT, b.world);
  }

  assert.deepEqual(a.state, b.state);
});
