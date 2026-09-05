import assert from "node:assert/strict";
import test from "node:test";
import { installE2eDebug, type DropInDebugApi } from "./e2e-debug";
import { GameRuntime } from "./GameRuntime";
import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import { createSimulation } from "../core/simulation";
import { createProceduralWorld } from "../terrain/obstacles";

test("debug global is strictly opt-in and cleanup cannot delete a newer runtime", () => {
  const host: { __dropInDebug?: DropInDebugApi } = {};
  let called = 0;
  const create = () => { called++; return {} as DropInDebugApi; };
  for (const query of ["", "?e2edebug", "?e2edebug=0", "?e2edebug=true"]) assert.equal(installE2eDebug(host, query, create), undefined);
  assert.equal(called, 0); assert.deepEqual(host, {});
  const first = installE2eDebug(host, "?e2edebug=1", create)!;
  const second = installE2eDebug(host, "?e2edebug=1", create)!;
  first(); assert.ok(host.__dropInDebug); second(); assert.deepEqual(host, {});
});

function setup(ranked: boolean) {
  const profile = DROP_IN_GAME_PROFILES.breckenridge;
  const state = createSimulation(profile, profile.seed), world = createProceduralWorld(profile, profile.seed);
  const fake = {
    disposed: false, ranked, state, world, paused: false, accumulator: 0, debugMutated: false,
    input: { clearHeld() {} }, renderer: { debugSetQuality() {}, render() {},
      performanceSummary: () => ({ rung: 4, p50FrameMs: 16, p95FrameMs: 18 }), debugRendererInfo: () => ({}), backendKind: "webgpu" },
    pause() { this.paused = true; }, resume() { this.paused = false; },
  };
  return { fake, api: GameRuntime.prototype.createDebugApi.call(fake as unknown as GameRuntime) };
}
test("competitive hook allows snapshots and quality but rejects every state mutation", () => {
  const { fake, api } = setup(true), before = JSON.stringify(fake.state);
  assert.ok(api.snapshot()); api.setQuality(1); api.setQuality(4); api.setQuality(null);
  assert.throws(() => api.setQuality(6));
  assert.throws(() => api.selectRun(0), /Free Ride/);
  assert.throws(() => api.spawnAtLift(0), /Free Ride/);
  assert.throws(() => api.stepTicks(1), /Free Ride/);
  assert.throws(() => api.resume(), /Free Ride/);
  assert.equal(JSON.stringify(fake.state), before);
});
test("accelerated fixed ticks are bounded, pause real time, and forbid later ranked recording", () => {
  const { fake, api } = setup(false);
  api.stepTicks(120, { steer: 0.3, tuck: 0.8 });
  assert.ok(Math.abs(fake.state.time - 1) < 1e-12);
  assert.equal(fake.paused, true); assert.equal(fake.debugMutated, true);
  assert.throws(() => api.stepTicks(12001)); assert.throws(() => api.stepTicks(NaN));
  assert.throws(() => GameRuntime.prototype.beginCompetitiveRecording.call(fake as unknown as GameRuntime), /cannot record ranked/);
  const snapshot = api.snapshot() as { pos: { x: number } }; snapshot.pos.x = 999;
  assert.notEqual(fake.state.pos.x, 999);
  api.resume(); assert.equal(fake.paused, false);
});

import { rankedTerrain } from "../server/ranked-terrain";
import { createWorld } from "../terrain/obstacles";
import { simulationConfig } from "../core/config";
import { prepareLiftPath, RIDER_DROP_M } from "../core/lifts";
test("Free Ride lift positioning uses the genuine base and lets normal core boarding occur", () => {
  const { fake, api } = setup(false), terrain = rankedTerrain("breckenridge");
  fake.world = createWorld(terrain.profile, terrain.profile.seed, terrain, { ...simulationConfig("packed", "v2"), allowLifts: true });
  const index = terrain.realLifts!.findIndex(l => l.complete !== false && l.stations?.length === 2);
  const base = prepareLiftPath(terrain.realLifts![index], terrain.height).points[0];
  api.spawnAtLift(index);
  assert.deepEqual(fake.state.pos, { x: base.x, y: base.y - RIDER_DROP_M, z: base.z });
  assert.equal(fake.state.liftIndex, -1, "debug positioning does not force a ride");
  api.stepTicks(1); assert.equal(fake.state.liftIndex, index);
  api.selectRun(1); assert.equal(fake.state.selectedTrail, 1); assert.equal(fake.state.courseProgress, 0);
});
