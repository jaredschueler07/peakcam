import assert from "node:assert/strict";
import { test } from "node:test";
import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import { FIXED_DT, FIXED_HZ } from "../core/clock";
import { simulationConfig, DEEP_POWDER, SPRING_SLUSH, HARDPACK_ICE, type SurfaceKind } from "../core/config";
import { createSimulation, stepSimulation } from "../core/simulation";
import type { InputFrame, SimulationWorld, TerrainSampler } from "../core/types";
import { createProceduralWorld } from "../terrain/obstacles";
import { V2_SNOWBOARD_MODEL, snowboardTurnRadius } from "./snowboard-model";
import { normal } from "./integrator-core";
import { snowResistanceVelocity } from "./integrator-v2";
const profile = DROP_IN_GAME_PROFILES.heavenly;
const input: InputFrame = { steer: 0, tuck: 0, brake: 0, jumpHeld: false, jumpPressed: false, restartPressed: false, trailPressed: false };
function setup(board = true, slope = 0.1) {
  const base = createProceduralWorld(profile, 42, simulationConfig("packed", "v2", undefined, board ? "snowboarder" : "skier"));
  const terrain: TerrainSampler = { ...base.terrain, height: (_x, z) => -slope * z,
    normal: (_x, _z, out) => { out.x = 0; out.y = 1 / Math.hypot(1, slope); out.z = slope / Math.hypot(1, slope); return out; } };
  const world: SimulationWorld = { ...base, terrain };
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) world.chunks.set(`${x}:${z}`, []);
  const state = createSimulation(profile, 42, terrain);
  state.pos.x = 0; state.pos.z = 0; state.pos.y = 0; state.prevX = 0; state.prevZ = 0;
  state.vel.x = 0; state.vel.z = 15; state.vel.y = -15 * slope; state.invuln = 0;
  return { state, world };
}
test("timebase is exactly 120Hz and heel sidecut is broader than toe sidecut", () => {
  assert.equal(FIXED_HZ, 120); assert.equal(FIXED_DT, 1 / 120);
  assert.ok(snowboardTurnRadius(-0.6, 15) > snowboardTurnRadius(0.6, 15));
});
test("full tail preload gives exactly 25% more launch impulse", () => {
  const ski = setup(false), board = setup();
  for (const f of [ski, board]) {
    f.state.jumpCharge = 0.4;
    const before = f.state.vel.y;
    stepSimulation(f.state, input, 0, f.world);
    assert.equal(f.state.onGround, false);
    f.state.vel.y -= before;
  }
  assert.ok(Math.abs(board.state.vel.y / ski.state.vel.y - 1.25) < 1e-12);
});
test("downhill opposing edges produce 400ms stumbles or 1.4s high-energy wipeouts", () => {
  for (const [slip, expected] of [[5, 0.4], [10, 1.4]]) {
    const { state, world } = setup();
    normal.x = 0.3; normal.y = Math.sqrt(0.91); normal.z = 0;
    state.boardRoll = -0.8; state.vel.x = slip; state.vel.z = 15;
    V2_SNOWBOARD_MODEL.carve(state, world.config, { ...input, dt: FIXED_DT, flatSpeed: 16, forwardVelocity: 15, rightVelocity: slip });
    assert.equal(state.crash, expected); assert.equal(state.stumble, slip === 5);
    for (let i = 0; i < Math.ceil(expected * FIXED_HZ) + 1; i++) stepSimulation(state, input, FIXED_DT, world);
    assert.ok(state.crash <= 0); assert.ok(state.invuln > 0); assert.equal(state.stumble, false);
  }
});
test("aligned edge, uphill skid and invulnerability do not catch", () => {
  for (const variant of ["aligned", "uphill", "invulnerable"]) {
    const { state, world } = setup();
    normal.x = variant === "uphill" ? -0.3 : 0.3; normal.y = Math.sqrt(0.91); normal.z = 0;
    state.boardRoll = variant === "aligned" ? 0.8 : -0.8;
    state.invuln = variant === "invulnerable" ? 1 : 0;
    V2_SNOWBOARD_MODEL.carve(state, world.config, { ...input, dt: FIXED_DT, flatSpeed: 20, forwardVelocity: 15, rightVelocity: 8 });
    assert.equal(state.crash, 0);
  }
});
test("pumping adds thrust only on descending rollers below two degrees", () => {
  for (const slope of [0, 0.02, -0.02, 0.1]) {
    const free = setup(true, slope), pumping = setup(true, slope);
    stepSimulation(free.state, { ...input, tuck: 0.5 }, FIXED_DT, free.world);
    stepSimulation(pumping.state, { ...input, tuck: 0.51 }, FIXED_DT, pumping.world);
    // Isolate pumping from the common aerodynamic tuck coefficient.
    normal.x = 0; normal.y = 1 / Math.hypot(1, slope); normal.z = slope / Math.hypot(1, slope);
    const ctx = { ...input, dt: FIXED_DT, flatSpeed: 15, forwardVelocity: 15, rightVelocity: 0, tuck: 0.6 };
    const base = V2_SNOWBOARD_MODEL.carve(free.state, { ...free.world.config, snowResistance: undefined }, ctx).forwardVelocity;
    normal.y = 1; normal.z = 0;
    const flat = V2_SNOWBOARD_MODEL.carve(pumping.state, { ...pumping.world.config, snowResistance: undefined }, ctx).forwardVelocity;
    if (slope === 0.02) assert.ok(base > flat);
    else assert.ok(Math.abs(base - flat) < 0.00002); // normal-load friction differs slightly
  }
});
test("airborne hold banks a grab only on a successful landing", () => {
  const { state, world } = setup();
  state.onGround = false; state.pos.y = 100;
  for (let i = 0; i < 30; i++) stepSimulation(state, { ...input, jumpHeld: true, steer: 1 }, FIXED_DT, world);
  assert.ok(state.grabTime > 0.24); assert.ok(state.spin > 0); assert.equal(state.grabbing, true);
  stepSimulation(state, input, FIXED_DT, world);
  assert.equal(state.grabbing, false); assert.ok(state.grabTime > 0.24);
  state.airTime = 0.6; state.yaw = 0; state.vel.x = 0; state.vel.z = 10;
  V2_SNOWBOARD_MODEL.land(state, world, 10);
  assert.ok(state.score > Math.round(0.6 * 130)); assert.equal(state.grabTime, 0);
});
test("surface coefficients, quadratic force and drag sign are physical", () => {
  assert.equal(DEEP_POWDER.plowCoefficient, 65); assert.equal(SPRING_SLUSH.plowCoefficient, 22);
  assert.equal(HARDPACK_ICE.kineticFriction, 0.02); assert.equal(SPRING_SLUSH.kineticFriction, 0.11);
  const cfg = simulationConfig("powder", "v2");
  const low = (10 - snowResistanceVelocity(10, cfg, 1e-7, 0)) / 1e-7;
  const high = (20 - snowResistanceVelocity(20, cfg, 1e-7, 0)) / 1e-7;
  assert.ok(Math.abs(high / low - 4) < 1e-5);
  for (const surface of ["powder", "packed", "ice", "slush"] as SurfaceKind[]) {
    const c = simulationConfig(surface, "v2");
    assert.ok(snowResistanceVelocity(20, c, FIXED_DT, 1) < 20);
    assert.ok(snowResistanceVelocity(0.01, c, 1, 1) >= 0);
    assert.equal(snowResistanceVelocity(-20, c, FIXED_DT, 1), -snowResistanceVelocity(20, c, FIXED_DT, 1));
  }
});
