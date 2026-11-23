import { test } from "node:test";
import assert from "node:assert/strict";
import { newSnowWindows } from "./snow-quality";

test("48 h new snow is the sum of the two daily gains, so it is never below 24 h", () => {
  // Tamarack 338:ID:SNTL, 2026-11-20..22: the pack settled 2 in, then took 4 in.
  assert.deepEqual(newSnowWindows([10, 8, 12]), { newSnow24h: 4, newSnow48h: 4 });
  // Whitefish 469:MT:SNTL: 5, 4, 5 used to read 1 in / 0 in.
  assert.deepEqual(newSnowWindows([5, 4, 5]), { newSnow24h: 1, newSnow48h: 1 });
});

test("snow on both days adds up; settling today leaves yesterday's gain in the 48 h figure", () => {
  assert.deepEqual(newSnowWindows([10, 13, 18]), { newSnow24h: 5, newSnow48h: 8 });
  assert.deepEqual(newSnowWindows([10, 16, 14]), { newSnow24h: 0, newSnow48h: 6 });
  assert.deepEqual(newSnowWindows([12, 11, 10]), { newSnow24h: 0, newSnow48h: 0 });
});

test("the sum is rounded once, and only the last three days count", () => {
  assert.deepEqual(newSnowWindows([10, 10.4, 10.8]), { newSnow24h: 0, newSnow48h: 1 });
  assert.deepEqual(newSnowWindows([0, 40, 10, 13, 18]), { newSnow24h: 5, newSnow48h: 8 });
});

test("missing days: no guess for 24 h, net change for 48 h, and short windows", () => {
  assert.deepEqual(newSnowWindows([10, null, 14]), { newSnow24h: 0, newSnow48h: 4 });
  assert.deepEqual(newSnowWindows([null, 9, 12]), { newSnow24h: 3, newSnow48h: 3 });
  assert.deepEqual(newSnowWindows([9, 12]), { newSnow24h: 3, newSnow48h: 3 });
  assert.deepEqual(newSnowWindows([10, 12, null]), { newSnow24h: 0, newSnow48h: 0 });
  assert.deepEqual(newSnowWindows([12]), { newSnow24h: 0, newSnow48h: 0 });
  assert.deepEqual(newSnowWindows([]), { newSnow24h: 0, newSnow48h: 0 });
});
