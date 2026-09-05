import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { disposeObjectTree } from "./resources";
import { buildTrackAlpha, EffectsRenderer, buildTrackNormal } from "./EffectsRenderer";
import { buildTileGeometry } from "./TerrainRenderer";
import { createProceduralWorld } from "../terrain/obstacles";
import { DROP_IN_GAME_PROFILES } from "../config/profiles";
test("ski grooves have opposing relief normals and a neutral center", () => {
  const texture = buildTrackNormal(), data = texture.image.data as Uint8Array;
  for (const center of [0.27, 0.73]) {
    assert.ok(data[Math.round((center - 0.04) * 127) * 4] < 115);
    assert.ok(data[Math.round((center + 0.04) * 127) * 4] > 140);
  }
  assert.ok(Math.abs(data[64 * 4] - 128) <= 1);
  for (let i = 2; i < data.length; i += 4) assert.ok(data[i] > 250);
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

test("track alpha leaves the center and outer snow transparent with only two ski-width strips", () => {
  const texture = buildTrackAlpha(), data = texture.image.data as Uint8Array;
  for (const u of [0, 0.15, 0.5, 0.85, 1]) assert.equal(data[Math.round(u * 127) * 4 + 1], 0);
  for (const u of [0.27, 0.73]) assert.equal(data[Math.round(u * 127) * 4 + 1], 255);
  const covered = Array.from({ length: 128 }, (_, i) => data[i * 4 + 1]).filter(v => v > 0).length;
  assert.ok(covered < 40, "most of the 0.84m ribbon must be fully transparent");
  texture.dispose();
});

test("scene disposal releases both track maps exactly once", () => {
  const scene = new THREE.Scene();
  const world = createProceduralWorld(DROP_IN_GAME_PROFILES.breckenridge, 12);
  new EffectsRenderer(scene, 12, world.terrain, false);
  const tracks = scene.children.find(object => object instanceof THREE.Mesh && object.material instanceof THREE.MeshStandardMaterial) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  assert.ok(tracks.material.alphaMap); assert.ok(tracks.material.normalMap);
  assert.equal(tracks.material.opacity, 0.45);
  let alphaDisposed = 0, normalDisposed = 0;
  tracks.material.alphaMap.addEventListener("dispose", () => alphaDisposed++);
  tracks.material.normalMap.addEventListener("dispose", () => normalDisposed++);
  disposeObjectTree(scene);
  assert.equal(alphaDisposed, 1); assert.equal(normalDisposed, 1);
});
