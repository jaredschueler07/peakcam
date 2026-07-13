import { test } from "node:test";
import assert from "node:assert";
import { computeCamUpdate, DISABLE_THRESHOLD } from "./cam-health-check.mjs";

const cam = (over = {}) => ({ id: "c1", is_active: true, auto_disabled: false, consecutive_failures: 0, ...over });

test("threshold constant is 3", () => {
  assert.strictEqual(DISABLE_THRESHOLD, 3);
});

test("alive + healthy cam: resets counter, no transition", () => {
  const { body, transition } = computeCamUpdate(cam({ consecutive_failures: 2 }), true);
  assert.strictEqual(body.consecutive_failures, 0);
  assert.strictEqual(transition, null);
  assert.ok(!("is_active" in body));
});

test("dead cam below threshold: increments only", () => {
  const { body, transition } = computeCamUpdate(cam({ consecutive_failures: 1 }), false);
  assert.strictEqual(body.consecutive_failures, 2);
  assert.strictEqual(transition, null);
  assert.ok(!("is_active" in body));
});

test("dead cam reaching threshold: auto-disables", () => {
  const { body, transition } = computeCamUpdate(cam({ consecutive_failures: 2 }), false);
  assert.strictEqual(body.consecutive_failures, 3);
  assert.strictEqual(body.is_active, false);
  assert.strictEqual(body.auto_disabled, true);
  assert.strictEqual(transition, "disabled");
});

test("already auto-disabled + still dead: counts up, no re-transition", () => {
  const { body, transition } = computeCamUpdate(cam({ is_active: false, auto_disabled: true, consecutive_failures: 5 }), false);
  assert.strictEqual(body.consecutive_failures, 6);
  assert.strictEqual(transition, null);
  assert.ok(!("is_active" in body));
});

test("auto-disabled cam comes back: recovers", () => {
  const { body, transition } = computeCamUpdate(cam({ is_active: false, auto_disabled: true, consecutive_failures: 4 }), true);
  assert.strictEqual(body.is_active, true);
  assert.strictEqual(body.auto_disabled, false);
  assert.strictEqual(body.consecutive_failures, 0);
  assert.strictEqual(transition, "recovered");
});

test("MANUALLY disabled cam is never re-enabled, alive or not", () => {
  const alive = computeCamUpdate(cam({ is_active: false, auto_disabled: false }), true);
  assert.ok(!("is_active" in alive.body));
  assert.strictEqual(alive.transition, null);
  const dead = computeCamUpdate(cam({ is_active: false, auto_disabled: false, consecutive_failures: 9 }), false);
  assert.ok(!("is_active" in dead.body));
  assert.strictEqual(dead.transition, null);
});
