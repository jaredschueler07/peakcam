import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import { createProceduralWorld } from "../terrain/obstacles";
import { staticNodeFactories } from "./nodeFactories.fixture";
import { createSnowNodeUniforms } from "./SnowNodeMaterial";
import type { SurfaceTextures } from "./surfaceTextures";
import { TerrainRenderer } from "./TerrainRenderer";

const profile = DROP_IN_GAME_PROFILES.breckenridge;

function surfaces(): SurfaceTextures {
  return { snowNormal: new THREE.Texture(), snowRoughness: new THREE.Texture() };
}

function firstTileMaterial(scene: THREE.Scene): THREE.Material {
  const mesh = scene.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);
  assert.ok(mesh, "the terrain renderer must have populated the scene with tiles");
  return mesh.material as THREE.Material;
}

test("attachSurfaceTextures swaps every tile onto the real KTX2 pair at rung 3+, once", () => {
  const world = createProceduralWorld(profile, profile.seed);
  const scene = new THREE.Scene();
  const terrain = new TerrainRenderer(scene, world, createSnowNodeUniforms(), staticNodeFactories(), 0, 3);
  const before = firstTileMaterial(scene);
  let materialDisposed = false;
  before.addEventListener("dispose", () => { materialDisposed = true; });
  const procedural = before.userData.snowDetail as THREE.Texture;
  let proceduralTextureDisposed = false;
  procedural.addEventListener("dispose", () => { proceduralTextureDisposed = true; });

  const real = surfaces();
  terrain.attachSurfaceTextures(real);

  const after = firstTileMaterial(scene);
  assert.notEqual(after, before, "a new compiled material carries the real surface");
  assert.equal(after.userData.snowDetail, real.snowNormal);
  assert.equal(after.userData.snowRoughness, real.snowRoughness);
  assert.equal(materialDisposed, false, "the procedural material remains cached for downshift");
  assert.equal(proceduralTextureDisposed, false, "the procedural normal remains available at rung2");
  for (const child of scene.children) {
    if (child instanceof THREE.Mesh) assert.equal(child.material, after, "every tile shares the one swapped material");
  }
  terrain.dispose();
});

test("attachSurfaceTextures is a no-op below rung 3, so the compiled material never churns", () => {
  const world = createProceduralWorld(profile, profile.seed);
  const scene = new THREE.Scene();
  const terrain = new TerrainRenderer(scene, world, createSnowNodeUniforms(), staticNodeFactories(), 0, 2);
  const before = firstTileMaterial(scene);
  terrain.attachSurfaceTextures(surfaces());
  assert.equal(firstTileMaterial(scene), before, "rung 2 keeps the procedural detail normal, uncompiled twice");
  terrain.dispose();
});

test("attachSurfaceTextures is a no-op on the WebGL path", () => {
  const world = createProceduralWorld(profile, profile.seed);
  const scene = new THREE.Scene();
  const terrain = new TerrainRenderer(scene, world, undefined, null, 0, 3);
  const before = firstTileMaterial(scene);
  terrain.attachSurfaceTextures(surfaces());
  assert.equal(firstTileMaterial(scene), before, "KTX2 textures never reach the GLSL material path");
  terrain.dispose();
});
