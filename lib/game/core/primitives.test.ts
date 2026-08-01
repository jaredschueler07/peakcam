import assert from "node:assert/strict";
import { test } from "node:test";

import { FIXED_DT, FixedStepClock } from "./clock";
import { hashInt, mulberry32 } from "./rng";

test("mulberry32 preserves the v1 golden sequence", () => {
  const random = mulberry32(32836);
  assert.deepStrictEqual(
    Array.from({ length: 5 }, () => random()),
    [
      0.6277443736325949,
      0.011607427382841706,
      0.20765979518182576,
      0.9551328397355974,
      0.494513951940462,
    ],
  );
});

test("hashInt preserves signed integer coercion and unsigned output", () => {
  assert.deepStrictEqual(
    [[0, 0], [1, 2], [-1, 4], [7919, 104729]].map(([x, y]) => hashInt(x, y)),
    [0, 2135657881, 1979627548, 3302334521],
  );
});

test("FixedStepClock caps long frames and drops a spiral backlog", () => {
  const clock = new FixedStepClock();
  let steps = 0;
  assert.strictEqual(clock.advance(1, () => { steps += 1; }), 12);
  assert.strictEqual(steps, 12);
  assert.strictEqual(clock.accumulator, 0);
});

test("FixedStepClock preserves a substep accumulator", () => {
  const clock = new FixedStepClock();
  let steps = 0;
  clock.advance(FIXED_DT * 0.5, () => { steps += 1; });
  clock.advance(FIXED_DT * 0.5, () => { steps += 1; });
  assert.strictEqual(steps, 1);
  assert.strictEqual(clock.accumulator, 0);
});
