import assert from "node:assert/strict";
import { test } from "node:test";

import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import { FIXED_DT } from "../core/clock";
import { simulationConfig, type SurfaceKind } from "../core/config";
import { mulberry32 } from "../core/rng";
import { createSimulation, stepSimulation } from "../core/simulation";
import type { InputFrame, SimulationState } from "../core/types";
import { createProceduralWorld } from "../terrain/obstacles";
import { GRAVITY, MAX_SPEED } from "./constants";
import { integrateSkierV2 } from "./integrator-v2";
import { integrateSkier } from "./integrator";

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

test("physics-model dispatch selects different v1 and v2 dynamics", () => {
  const v1World = createProceduralWorld(profile, profile.seed, simulationConfig("packed", "v1"));
  const v2World = createProceduralWorld(profile, profile.seed, simulationConfig("packed", "v2"));
  const v1 = createSimulation(profile, profile.seed, v1World.terrain);
  const v2 = createSimulation(profile, profile.seed, v2World.terrain);
  v1.invuln = 100; v2.invuln = 100;
  const frame = input({ steer: 0.7, brake: 0.4 });
  for (let i = 0; i < 8; i += 1) {
    stepSimulation(v1, frame, FIXED_DT, v1World);
    stepSimulation(v2, frame, FIXED_DT, v2World);
  }
  assert.notDeepEqual(v1, v2);
});

test("firm v2 lateral decay uses additive grip without gripMultiplier", () => {
  const { state, world } = setup("firm");
  state.vel.x = 10; state.vel.z = 20;
  const right = { x: Math.cos(state.yaw), z: -Math.sin(state.yaw) };
  const beforeRight = state.vel.x * right.x + state.vel.z * right.z;
  const normal = { x: 0, y: 1, z: 0 };
  world.terrain.normal(state.pos.x, state.pos.z, normal);
  const gravity = { x: 0, y: -GRAVITY, z: 0 };
  const projection = gravity.x * normal.x + gravity.y * normal.y + gravity.z * normal.z;
  const tangent = {
    x: gravity.x - projection * normal.x,
    y: gravity.y - projection * normal.y,
    z: gravity.z - projection * normal.z,
  };
  const rightAfterGravity = beforeRight + (tangent.x * right.x + tangent.z * right.z) * FIXED_DT;
  const flatSpeed = Math.hypot(state.vel.x, state.vel.z);
  const cfg = world.config;
  const speedFade = 1 - cfg.carve.gripSpeedFade * Math.min(1, flatSpeed / (MAX_SPEED * cfg.topSpeedMultiplier));
  const grip = (cfg.carve.gripBase + cfg.carve.gripEdgeGain * 0) * speedFade * (1 + 0 * 1.4);
  const expected = rightAfterGravity * Math.exp(-grip * FIXED_DT);

  integrateSkierV2(state, input(), FIXED_DT, world);
  assert.ok(Math.abs(rightVelocity(state) - expected) < 1e-12);
});

test("skid drag changes forward velocity when lateral slip is unedged", () => {
  const lowEdge = setup("packed");
  const highEdge = setup("packed");
  lowEdge.state.vel.x = 12; lowEdge.state.vel.z = 20;
  highEdge.state.vel.x = 12; highEdge.state.vel.z = 20;
  lowEdge.state.edgeAngle = 0;
  highEdge.state.edgeAngle = 1;
  integrateSkierV2(lowEdge.state, input(), FIXED_DT, lowEdge.world);
  integrateSkierV2(highEdge.state, input(), FIXED_DT, highEdge.world);
  assert.ok(highEdge.state.vel.z > lowEdge.state.vel.z);
});

test("braking applies the carve grip multiplier", () => {
  const free = setup("packed");
  const braking = setup("packed");
  free.state.vel.x = 10; free.state.vel.z = 20;
  braking.state.vel.x = 10; braking.state.vel.z = 20;
  integrateSkierV2(free.state, input(), FIXED_DT, free.world);
  integrateSkierV2(braking.state, input({ brake: 1 }), FIXED_DT, braking.world);
  assert.ok(Math.abs(rightVelocity(braking.state)) < Math.abs(rightVelocity(free.state)));
});

test("v2 with the v1 carve table matches v1 dynamics for legacy fields", () => {
  const v1World = createProceduralWorld(profile, profile.seed, simulationConfig("packed", "v1"));
  const v2World = createProceduralWorld(profile, profile.seed, {
    ...simulationConfig("packed", "v2"), carve: simulationConfig("packed", "v1").carve,
  });
  const v1 = createSimulation(profile, profile.seed, v1World.terrain);
  const v2 = createSimulation(profile, profile.seed, v2World.terrain);
  v1.invuln = 100; v2.invuln = 100;
  const random = mulberry32(0x51a7);
  for (let i = 0; i < 300; i += 1) {
    const frame = input({ steer: 0, tuck: random(), brake: random() * 0.4 });
    integrateSkier(v1, frame, FIXED_DT, v1World);
    integrateSkierV2(v2, frame, FIXED_DT, v2World);
    const v1Legacy = { ...v1, edgeAngle: 0, landingTimer: 0 };
    const v2Legacy = { ...v2, edgeAngle: 0, landingTimer: 0 };
    assert.deepEqual(v2Legacy, v1Legacy);
  }
});
