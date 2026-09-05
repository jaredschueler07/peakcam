import test from "node:test";
import assert from "node:assert/strict";

import { QualityController, recoveryThresholdMs, seedQualityRung } from "./QualityController";

const BUDGET = 1000 / 45;
const OVER = BUDGET + 4;
const UNDER = BUDGET * 0.6;
/** Inside the hysteresis band: under budget, but not far enough under to count as headroom. */
const OK = BUDGET * 0.95;
/** A vsync-locked 60Hz frame — the case the old 0.7x recovery threshold could never clear. */
const VSYNC_60 = 1000 / 60;

/** Feed the governor a steady p75 from `from` to `to` seconds inclusive, one sample per second. */
function feed(quality: QualityController, p75Ms: number, from: number, to: number) {
  let last = { rung: quality.rung, pixelScale: quality.pixelScale, changed: false };
  for (let t = from; t <= to; t += 1) last = quality.observeFrameTimes(p75Ms, BUDGET, t);
  return last;
}

test("sustained over-budget frames step the rung down once after 5s", () => {
  const quality = new QualityController(4);
  assert.equal(feed(quality, OVER, 0, 4).rung, 4, "no step before the 5s dwell elapses");
  const stepped = quality.observeFrameTimes(OVER, BUDGET, 5);
  assert.deepEqual(stepped, { rung: 3, pixelScale: 1, changed: true });
  assert.equal(feed(quality, OVER, 6, 9).rung, 3, "one step per 5s at most");
});

test("a 4s spike does nothing", () => {
  const quality = new QualityController(3);
  feed(quality, OVER, 0, 3);
  const recovered = quality.observeFrameTimes(OK, BUDGET, 4);
  assert.deepEqual(recovered, { rung: 3, pixelScale: 1, changed: false });
  assert.equal(feed(quality, OVER, 5, 8).rung, 3, "the over-budget clock restarted after the spike ended");
});

test("recovery below the headroom threshold for 20s steps the rung back up", () => {
  const quality = new QualityController(2);
  assert.equal(feed(quality, UNDER, 0, 19).rung, 2, "no step up before 20s of headroom");
  assert.deepEqual(quality.observeFrameTimes(UNDER, BUDGET, 20), { rung: 3, pixelScale: 1, changed: true });
  assert.equal(feed(quality, UNDER, 21, 39).rung, 3, "the recovery clock restarts after a step");
  assert.equal(quality.observeFrameTimes(UNDER, BUDGET, 40).rung, 4);
});

test("frame times inside the hysteresis band hold the rung steady", () => {
  const quality = new QualityController(2);
  assert.equal(feed(quality, OK, 0, 60).rung, 2);
});

test("the recovery threshold is the wider of a 10% band and a 2ms margin", () => {
  // Desktop (45fps) and mobile (30fps) budgets are both large enough for the fractional band.
  assert.ok(Math.abs(recoveryThresholdMs(1000 / 45) - 20) < 1e-9);
  assert.ok(Math.abs(recoveryThresholdMs(1000 / 30) - 30) < 1e-9);
  // Below 20ms of budget, 10% is inside ordinary jitter, so the flat margin takes over.
  assert.equal(recoveryThresholdMs(10), 8);
  assert.ok(recoveryThresholdMs(20) === 18, "the two rules meet at a 20ms budget");
  // And it always leaves a real dead band, so a frame right at budget cannot trigger recovery.
  for (const budget of [8, 12, 16.6, 20, 22.2, 33.3]) {
    assert.ok(recoveryThresholdMs(budget) < budget, `${budget}ms budget keeps hysteresis`);
  }
});

test("a vsync-locked 60Hz display can climb back after losing a rung to a spike", () => {
  // The regression this guards: the desktop budget is 22.2ms, so the old 0.7x threshold wanted a
  // p75 under 15.6ms. Behind 60Hz vsync every healthy frame is 16.7ms, so the ladder only went
  // down — a device that gave up a rung to a transient spike stayed there for the whole run.
  const quality = new QualityController(4);
  feed(quality, OVER, 0, 5);
  assert.equal(quality.rung, 3, "a sustained spike costs a rung");
  assert.equal(feed(quality, VSYNC_60, 6, 25).rung, 3, "no step up before 20s of headroom");
  assert.equal(quality.observeFrameTimes(VSYNC_60, BUDGET, 26).rung, 4, "and then it comes back");
});

test("a step down resets the recovery clock", () => {
  const quality = new QualityController(3);
  feed(quality, UNDER, 0, 15);
  assert.equal(quality.observeFrameTimes(OVER, BUDGET, 21).rung, 3, "over-budget sample cancels the pending recovery");
  assert.equal(quality.observeFrameTimes(OVER, BUDGET, 26).rung, 2, "steps down after 5s over budget");
  assert.equal(feed(quality, UNDER, 27, 46).rung, 2, "recovery must re-earn a full 20s after the step down");
  assert.equal(quality.observeFrameTimes(UNDER, BUDGET, 47).rung, 3);
});

test("never oscillates faster than one step per 5s", () => {
  const quality = new QualityController(4);
  feed(quality, OVER, 0, 5);
  assert.equal(quality.rung, 3);
  // 20s of headroom is earned, but the last step was only 4s ago at t=9... build the clock then step.
  const q2 = new QualityController(4);
  feed(q2, OVER, 0, 5);
  assert.equal(q2.observeFrameTimes(OVER, BUDGET, 7).rung, 3, "second step suppressed within 5s of the first");
  assert.equal(q2.observeFrameTimes(OVER, BUDGET, 12).rung, 2, "allowed once 5s have passed");
});

test("at rung 0 sustained over-budget frames drop pixel scale, and recovery restores it first", () => {
  const quality = new QualityController(0);
  const dropped = feed(quality, OVER, 0, 5);
  assert.deepEqual(dropped, { rung: 0, pixelScale: 0.9, changed: true });
  assert.equal(feed(quality, OVER, 6, 11).pixelScale, 0.8);
  feed(quality, UNDER, 12, 32);
  assert.equal(quality.pixelScale, 0.9, "pixel scale recovers before the rung");
  assert.equal(quality.rung, 0);
});

test("the fast-loop observe(fps) API is unaffected by governor state", () => {
  const quality = new QualityController(3);
  feed(quality, OVER, 0, 4);
  assert.deepEqual(quality.observe(44), { rung: 2, pixelScale: 1, changed: true });
});

test("WebGL seeds exactly one rung below the same WebGPU device, clamped at zero", () => {
  for (const hardwareConcurrency of [2, 4, 8, 12]) for (const deviceMemory of [2, 4, 8]) for (const coarsePointer of [false, true]) for (const dpr of [1, 2, 3]) {
    const signals = { hardwareConcurrency, deviceMemory, coarsePointer, dpr };
    assert.equal(seedQualityRung(signals, "webgl"), Math.max(0, seedQualityRung(signals, "webgpu") - 1));
  }
  assert.equal(seedQualityRung({ hardwareConcurrency: 12, deviceMemory: 8, coarsePointer: false, dpr: 1 }, "webgpu"), 4);
  assert.equal(seedQualityRung({ hardwareConcurrency: 12, deviceMemory: 8, coarsePointer: false, dpr: 1 }, "webgl"), 3);
});
