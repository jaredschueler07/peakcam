import { test } from "node:test";
import assert from "node:assert/strict";
import { maxPrecipProbability } from "./nws";

test("maxPrecipProbability takes the max over the first two periods", () => {
  const periods = [
    { precipProbability: 20 },
    { precipProbability: 70 },
    { precipProbability: 95 }, // day 3 — outside the 48h window
  ];
  assert.equal(maxPrecipProbability(periods), 70);
});

test("maxPrecipProbability ignores null values and returns null when none", () => {
  assert.equal(maxPrecipProbability([{ precipProbability: null }, { precipProbability: 40 }]), 40);
  assert.equal(maxPrecipProbability([{ precipProbability: null }]), null);
  assert.equal(maxPrecipProbability([]), null);
});
