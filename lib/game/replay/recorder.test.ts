import assert from "node:assert/strict";
import test from "node:test";
import { createSkierState } from "../physics/skier";
import {
  MAX_KEYFRAMES,
  POSE_AIRBORNE,
  POSE_CRASHED,
  POSE_TUCKED,
  quantizeGhostSample,
} from "./codec";
import { GhostRecorder } from "./recorder";
import { CompetitiveRecordingArm, GameRuntime } from "../runtime/GameRuntime";

test("records the first fixed-step state and then decimates 120 Hz samples four to one", () => {
  const recorder = new GhostRecorder();
  const state = createSkierState();
  recorder.begin(10);

  for (let step = 0; step < 12; step += 1) {
    state.pos.x = step / 100;
    recorder.sample(state, 10 + step / 120);
  }

  const samples = recorder.finish();
  assert.deepEqual(samples?.map(quantizeGhostSample), [
    { tick: 0, xCm: 0, zCm: 0, groundOffsetCm: 0, yaw: 0, speedCms: 0, poseFlags: 0 },
    { tick: 4, xCm: 4, zCm: 0, groundOffsetCm: 0, yaw: 0, speedCms: 0, poseFlags: 0 },
    { tick: 8, xCm: 8, zCm: 0, groundOffsetCm: 0, yaw: 0, speedCms: 0, poseFlags: 0 },
  ].map(quantizeGhostSample));
  assert.equal(recorder.recording, false);
});

test("caps a recording at the codec keyframe limit", () => {
  const recorder = new GhostRecorder();
  const state = createSkierState();
  recorder.begin(0);

  for (let frame = 0; frame < MAX_KEYFRAMES + 5; frame += 1) {
    state.pos.z = frame;
    recorder.sample(state, frame / 30);
  }

  const samples = recorder.finish();
  assert.equal(samples?.length, MAX_KEYFRAMES);
  assert.equal(samples?.at(-1)?.zCm, (MAX_KEYFRAMES - 1) * 100);
});

test("quantizes position, yaw, speed, and pose flags without mutating simulation state", () => {
  const recorder = new GhostRecorder();
  const state = createSkierState();
  state.pos.x = 1.234;
  state.pos.y = 2.345;
  state.pos.z = -3.456;
  state.vel.x = 3;
  state.vel.z = 4;
  state.yaw = -Math.PI / 3;
  state.onGround = false;
  state.crouch = 0.25;
  state.crash = 0.5;
  const before = {
    pos: { ...state.pos }, vel: { ...state.vel }, yaw: state.yaw,
    onGround: state.onGround, crouch: state.crouch, crash: state.crash,
  };

  recorder.begin(7);
  recorder.sample(state, 7);

  const sample = recorder.finish()?.[0];
  assert.ok(sample);
  assert.deepEqual(quantizeGhostSample(sample), quantizeGhostSample({
    tick: 0,
    xCm: 123,
    zCm: -346,
    groundOffsetCm: 235,
    yaw: -Math.PI / 3,
    speedCms: 500,
    poseFlags: POSE_AIRBORNE | POSE_TUCKED | POSE_CRASHED,
  }));
  assert.deepEqual({
    pos: state.pos, vel: state.vel, yaw: state.yaw,
    onGround: state.onGround, crouch: state.crouch, crash: state.crash,
  }, before);
});

test("beginning again discards samples from the reset run", () => {
  const recorder = new GhostRecorder();
  const state = createSkierState();
  recorder.begin(0);
  state.pos.x = 1;
  recorder.sample(state, 0);

  recorder.begin(20);
  state.pos.x = 9;
  recorder.sample(state, 20);

  assert.deepEqual(recorder.finish()?.map(quantizeGhostSample), [{
    tick: 0, xCm: 900, zCm: 0, groundOffsetCm: 0, yaw: 0, speedCms: 0, poseFlags: 0,
  }].map(quantizeGhostSample));
  assert.equal(recorder.finish(), null);
});

test("arm then reset begins a run at the reset state's tick zero", () => {
  const arm = new CompetitiveRecordingArm();
  const begins: number[] = [];
  let recording = false;
  const recorder = {
    get recording() { return recording; },
    begin(now: number) { begins.push(now); recording = true; },
    finish() { recording = false; return null; },
  };

  arm.arm(12, () => recorder.begin(12));
  assert.deepEqual(begins, []);
  arm.onReset(0, recorder);
  assert.deepEqual(begins, [0]);
  assert.equal(arm.pending, false);
});

test("a crash retry discards run one and immediately records run two", () => {
  const arm = new CompetitiveRecordingArm();
  const state = createSkierState();
  const recorder = new GhostRecorder();

  // The caller arms after a stale pre-restart time; the first reset starts run one.
  arm.arm(12, (now) => recorder.begin(now));
  arm.onReset(0, recorder);
  recorder.sample(state, 0);
  recorder.sample(state, 1 / 30);
  assert.equal(recorder.recording, true);

  // Crash/restart: run one is discarded, and this same reset starts run two.
  arm.onReset(0, recorder);
  assert.equal(recorder.recording, true);
  assert.equal(arm.pending, false);

  state.pos.x = 2;
  recorder.sample(state, 0);
  state.pos.x = 3;
  recorder.sample(state, 1 / 30);
  const runTwo = recorder.finish();
  assert.ok(runTwo);
  const runtime = {
    finishedRun: { samples: runTwo, encoded: new Uint8Array([1]) },
    ui: { setRunRecordingAvailable() {} },
  };
  const taken = GameRuntime.prototype.takeFinishedRun.call(runtime as never);

  assert.equal(taken?.samples.length, 2);
  assert.equal(taken?.samples[0].xCm, 200);
  assert.equal(taken?.samples[1].xCm, 300);
});

test("arming while already at state time zero begins immediately", () => {
  const arm = new CompetitiveRecordingArm();
  const begins: number[] = [];
  arm.arm(0, (now) => begins.push(now));
  assert.deepEqual(begins, [0]);
  assert.equal(arm.pending, false);
});
