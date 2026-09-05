import assert from "node:assert/strict";
import { test } from "node:test";

import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import { FIXED_DT } from "../core/clock";
import { simulationConfig, type SurfaceKind } from "../core/config";
import { mulberry32 } from "../core/rng";
import { createSimulation, stepSimulation } from "../core/simulation";
import type { InputFrame, SimulationState, SimulationWorld } from "../core/types";
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

function setupPlanarLanding(): { state: SimulationState; world: SimulationWorld } {
  const fixture = setup();
  const terrain = {
    ...fixture.world.terrain,
    height: (_x: number, z: number) => -0.5 * z,
    normal: (_x: number, _z: number, out: { x: number; y: number; z: number }) => {
      out.x = 0; out.y = 2 / Math.sqrt(5); out.z = 1 / Math.sqrt(5);
      return out;
    },
  };
  fixture.world = { ...fixture.world, terrain };
  fixture.state.pos.x = 0; fixture.state.pos.y = 0; fixture.state.pos.z = 0;
  fixture.state.onGround = false;
  fixture.state.airTime = 1;
  fixture.state.invuln = 0;
  return fixture;
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

test("fall-line-aligned landing absorbs an impact that crashes a 90-degree-off landing", () => {
  const aligned = setupPlanarLanding();
  const acrossSlope = setupPlanarLanding();
  aligned.state.vel.x = 0; aligned.state.vel.y = 0; aligned.state.vel.z = 24;
  aligned.state.yaw = Math.PI / 2;
  acrossSlope.state.vel.x = 24; acrossSlope.state.vel.y = 0; acrossSlope.state.vel.z = 0;
  acrossSlope.state.yaw = 0;

  integrateSkierV2(aligned.state, input(), 0, aligned.world);
  integrateSkierV2(acrossSlope.state, input(), 0, acrossSlope.world);

  assert.equal(aligned.state.crash, 0);
  assert.equal(aligned.state.landingTimer, aligned.world.config.carve.landingWindow);
  assert.equal(acrossSlope.state.events.crashReason, "LANDING");
});

test("airborne yaw authority after two seconds is lower than during the first half-second", () => {
  const early = setup();
  const late = setup();
  for (const fixture of [early, late]) {
    fixture.state.onGround = false;
    fixture.state.pos.y += 200;
    fixture.state.vel.x = 0; fixture.state.vel.y = 0; fixture.state.vel.z = 0;
  }
  late.state.airTime = 2;

  for (let i = 0; i < 30; i += 1) {
    integrateSkierV2(early.state, input({ steer: 1 }), 1 / 60, early.world);
  }
  for (let i = 0; i < 60; i += 1) {
    integrateSkierV2(late.state, input({ steer: 1 }), 1 / 60, late.world);
  }

  assert.ok(late.state.yaw < early.state.yaw);
});

test("landing absorption timer counts down while suppressing obstacle collisions", () => {
  const { state, world } = setupPlanarLanding();
  state.onGround = true;
  state.airTime = 0;
  state.landingTimer = 0.1;
  world.chunks.set("0:0", [{
    x: 0, y: 0, z: 0, s: 1, rot: 0, type: "tree", r: 10,
  }]);

  integrateSkierV2(state, input(), 0.04, world);

  assert.ok(Math.abs(state.landingTimer - 0.06) < 1e-12);
  assert.equal(state.crash, 0);
});

test("v2 strategy with the full v1 config preserves legacy fields", () => {
  const v1World = createProceduralWorld(profile, profile.seed, simulationConfig("packed", "v1"));
  const v2World = createProceduralWorld(profile, profile.seed, {
    ...simulationConfig("packed", "v1"),
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

 test("v2 partial tuck gives intermediate acceleration, not full tuck thrust", () => {
  const speeds = [0, 0.1, 0.5, 1].map(tuck => {
    const { state, world } = setup();
    integrateSkierV2(state, input({ tuck }), FIXED_DT, world);
    return Math.hypot(state.vel.x, state.vel.z);
  });
  for (let i = 1; i < speeds.length; i++) assert.ok(speeds[i] > speeds[i - 1]);
});
