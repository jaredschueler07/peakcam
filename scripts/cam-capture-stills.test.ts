import { test } from "node:test";
import assert from "node:assert/strict";
import { frameStats, isBlankFrame } from "./cam-capture-stills";

const fill = (v: number) => new Uint8Array(32 * 18).fill(v);

test("uniform grey, white and black frames are blank", () => {
  assert.equal(isBlankFrame(frameStats(fill(128))), true);
  assert.equal(isBlankFrame(frameStats(fill(250))), true);
  assert.equal(isBlankFrame(frameStats(fill(3))), true);
});

test("a dark night frame with a few bright pixels is still blank", () => {
  const g = fill(2); g[0] = 200; g[1] = 180;
  assert.equal(isBlankFrame(frameStats(g)), true);
});

test("fog (bright, low contrast) and ordinary scenes pass", () => {
  // Real fog frame from Sunlight Mountain measured mean ~205, spread ~7: bright with faint tree outlines.
  const fog = fill(205); for (let i = 0; i < fog.length; i += 3) fog[i] = 190;
  const stats = frameStats(fog);
  assert.ok(stats.spread >= 3 && stats.mean > 10, `fog spread ${stats.spread}`);
  assert.equal(isBlankFrame(stats), false);
  const scene = new Uint8Array(32 * 18).map((_, i) => (i % 32) * 8);
  assert.equal(isBlankFrame(frameStats(scene)), false);
});
