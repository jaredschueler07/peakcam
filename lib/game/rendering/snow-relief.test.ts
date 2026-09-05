import test from "node:test";
import assert from "node:assert/strict";
import { buildTrackNormal } from "./EffectsRenderer";
import { buildTileGeometry } from "./TerrainRenderer";
import { createProceduralWorld } from "../terrain/obstacles";
import { DROP_IN_GAME_PROFILES } from "../config/profiles";
test("ski grooves have opposing relief normals and a neutral center", () => {
  const texture = buildTrackNormal(), data = texture.image.data as Uint8Array;
  assert.ok(data[15 * 4] < 100); assert.ok(data[26 * 4] > 155);
  assert.ok(Math.abs(data[64 * 4] - 128) <= 1);
  for (let i = 2; i < data.length; i += 4) assert.ok(data[i] > 190);
  texture.dispose();
});
test("corduroy mask follows terrain corridor instead of painting off-piste", () => {
  const world = createProceduralWorld(DROP_IN_GAME_PROFILES.breckenridge, 12);
  const geometry = buildTileGeometry(world.terrain, 0, 0);
  const mask = geometry.getAttribute("groomed");
  assert.equal(mask.count, geometry.getAttribute("position").count);
  assert.ok(Array.from(mask.array).some(value => value > 0));
  assert.ok(Array.from(mask.array).some(value => value === 0));
  geometry.dispose();
});
