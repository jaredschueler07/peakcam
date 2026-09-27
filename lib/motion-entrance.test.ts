import { test } from "node:test";
import assert from "node:assert";
import { entranceMotionProps } from "./motion-entrance";

// The hook that feeds `reducedMotion` reports null on the server, false on the
// first client render, and true only after hydration for reduce-motion users.
const REDUCED_MOTION_STATES: (boolean | null)[] = [null, false, true];

test("a hidden initial state always has a matching visible whileInView target", () => {
  for (const reducedMotion of REDUCED_MOTION_STATES) {
    const props = entranceMotionProps(true, reducedMotion);
    assert.ok(props.initial !== false, `reducedMotion=${reducedMotion}: initial should hide`);
    assert.strictEqual(props.initial.opacity, 0);
    assert.ok(props.whileInView, `reducedMotion=${reducedMotion}: whileInView must exist`);
    assert.strictEqual(props.whileInView.opacity, 1);
    assert.strictEqual(props.whileInView.y, 0);
    assert.deepStrictEqual(props.viewport, { once: true });
  }
});

test("reduced motion makes the reveal instant instead of removing it", () => {
  assert.strictEqual(entranceMotionProps(true, true).transition.duration, 0);
  assert.strictEqual(entranceMotionProps(true, false).transition.duration, 0.15);
  assert.strictEqual(entranceMotionProps(true, null, 0.4).transition.duration, 0.4);
});

test("the reveal target does not change when the reduced-motion hook flips after hydration", () => {
  const first = entranceMotionProps(true, false);
  const afterHydration = entranceMotionProps(true, true);
  assert.deepStrictEqual(first.initial, afterHydration.initial);
  assert.deepStrictEqual(first.whileInView, afterHydration.whileInView);
});

test("animate=false renders visible with no entrance state at all", () => {
  for (const reducedMotion of REDUCED_MOTION_STATES) {
    const props = entranceMotionProps(false, reducedMotion);
    assert.strictEqual(props.initial, false);
    assert.strictEqual(props.whileInView, undefined);
  }
});
