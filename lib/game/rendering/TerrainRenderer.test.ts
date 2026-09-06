import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import { createProceduralWorld } from "../terrain/obstacles";
import { staticNodeFactories } from "./nodeFactories.fixture";
import { createSnowNodeUniforms } from "./SnowNodeMaterial";
import type { SurfaceTextures } from "./surfaceTextures";
import { GRID_SIZE, TILE_RESOLUTION, TILE_SIZE, TerrainRenderer } from "./TerrainRenderer";

import { disposeObjectTree } from "./resources";

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

function terrainMeshes(scene: THREE.Scene) {
  const meshes = scene.children.filter((child): child is THREE.Mesh<THREE.BufferGeometry, THREE.Material> => child instanceof THREE.Mesh);
  return { high: meshes.filter(mesh => mesh.name !== "terrain-low"), low: meshes.find(mesh => mesh.name === "terrain-low")! };
}

test("low terrain is one bounded stride-two draw with exact source attributes and shared edges", () => {
  const world = createProceduralWorld(profile, profile.seed);
  const scene = new THREE.Scene();
  const terrain = new TerrainRenderer(scene, world, undefined, null, 0, 1);
  terrain.update(275, -315);
  const { high, low } = terrainMeshes(scene), n = TILE_RESOLUTION + 1, perTile = n * n;
  assert.equal(high.length, GRID_SIZE * GRID_SIZE);
  assert.equal(scene.children.filter(child => child.visible).length, 1);
  assert.equal(low.receiveShadow, true);
  assert.equal(low.geometry.index!.count / 3, 31_250);
  const positions = low.geometry.getAttribute("position");
  assert.equal(positions.count, perTile * high.length);
  for (const value of low.geometry.index!.array) {
    assert.ok(value >= 0 && value < positions.count);
    const local = value % perTile;
    assert.equal(local % n % 2, 0);
    assert.equal(Math.floor(local / n) % 2, 0);
  }
  for (let t = 0; t < high.length; t++) {
    for (const name of ["normal", "color", "groomed"]) {
      const source = high[t].geometry.getAttribute(name), merged = low.geometry.getAttribute(name);
      assert.deepEqual(merged.array.slice(t * perTile * source.itemSize, (t + 1) * perTile * source.itemSize), source.array);
    }
    for (let i = 0; i < perTile; i += 26) {
      const source = high[t].geometry.getAttribute("position"), at = t * perTile + i;
      assert.equal(positions.getY(at), source.getY(i));
      assert.equal(positions.getX(at), source.getX(i) + high[t].position.x);
      assert.equal(positions.getZ(at), source.getZ(i) + high[t].position.z);
    }
  }
  // Every duplicated tile-border sample is identical; stride two uses the same
  // ordered samples on both sides, without mixed-resolution T junctions.
  const edges = new Map<string, number>();
  for (const value of low.geometry.index!.array) {
    const local = value % perTile, row = Math.floor(local / n), col = local % n;
    if (row !== 0 && row !== TILE_RESOLUTION && col !== 0 && col !== TILE_RESOLUTION) continue;
    const key = `${positions.getX(value)},${positions.getZ(value)}`, height = positions.getY(value);
    if (edges.has(key)) assert.equal(height, edges.get(key)); else edges.set(key, height);
  }
  const bounds = low.geometry.boundingBox!;
  assert.equal(bounds.min.x, -TILE_SIZE); assert.equal(bounds.max.x, 4 * TILE_SIZE);
  assert.equal(bounds.min.z, -3 * TILE_SIZE); assert.equal(bounds.max.z, 2 * TILE_SIZE);
  terrain.dispose();
});

test("4→1→4 restores original meshes and materials on both backends without rebuilding unchanged geometry", () => {
  for (const nodeBackend of [false, true]) {
    const scene = new THREE.Scene(), world = createProceduralWorld(profile, profile.seed);
    const terrain = new TerrainRenderer(scene, world, nodeBackend ? createSnowNodeUniforms() : undefined, nodeBackend ? staticNodeFactories() : null, 0, 4);
    terrain.update(0, 0);
    if (nodeBackend) terrain.attachSurfaceTextures(surfaces());
    const { high, low } = terrainMeshes(scene), original = high.map(mesh => mesh.geometry), material = high[0].material;
    assert.ok(high.every(mesh => mesh.visible)); assert.equal(low.visible, false);
    terrain.setQuality(1);
    assert.ok(high.every(mesh => !mesh.visible)); assert.equal(low.visible, true);
    assert.equal(low.material, high[0].material);
    if (nodeBackend) assert.notEqual(low.material, material);
    const lowGeometry = low.geometry;
    terrain.update(15, 20); terrain.setQuality(0); terrain.setQuality(1);
    assert.equal(low.geometry, lowGeometry, "stationary frames and low-tier changes retain buffers");
    terrain.setQuality(4);
    assert.equal(low.visible, false); assert.ok(high.every(mesh => mesh.visible && mesh.material === material));
    assert.deepEqual(high.map(mesh => mesh.geometry), original);
    terrain.setQuality(1); assert.equal(low.geometry, lowGeometry);
    terrain.dispose();
  }
});

test("low window movement refreshes bounds and disposes replaced geometry exactly once", () => {
  for (const sceneOwned of [false, true]) {
    const scene = new THREE.Scene(), world = createProceduralWorld(profile, profile.seed);
    const terrain = new TerrainRenderer(scene, world, undefined, null, 0, 1);
    terrain.update(0, 0);
    const { low } = terrainMeshes(scene), first = low.geometry;
    let released = 0; first.addEventListener("dispose", () => released++);
    terrain.update(201, 201);
    assert.equal(released, 1); assert.notEqual(low.geometry, first);
    assert.equal(low.geometry.boundingBox!.min.x, -200); assert.equal(low.geometry.boundingBox!.min.z, 0);
    const second = low.geometry; let secondReleased = 0; second.addEventListener("dispose", () => secondReleased++);
    terrain.setQuality(4); terrain.update(401, 201);
    assert.equal(low.geometry, second, "high-tier movement only invalidates the low cache");
    terrain.setQuality(1);
    assert.equal(secondReleased, 1); assert.equal(low.geometry.boundingBox!.min.x, 0);
    const geometries = terrainMeshes(scene).high.map(mesh => mesh.geometry).concat(low.geometry);
    const counts = geometries.map(geometry => { const c = { value: 0 }; geometry.addEventListener("dispose", () => c.value++); return c; });
    if (sceneOwned) { terrain.disposeInactiveMaterials(); disposeObjectTree(scene); terrain.dispose(); }
    else { terrain.dispose(); terrain.dispose(); }
    assert.ok(counts.every(c => c.value === 1)); assert.equal(scene.children.length, 0);
  }
});

 test("low-tier backing stores are reserved at construction and reused across later downshifts and windows", () => {
  const world = createProceduralWorld(profile, profile.seed), scene = new THREE.Scene();
  const terrain = new TerrainRenderer(scene, world, undefined, null, 0, 3);
  const buffers = (terrain as unknown as { lowBuffers: Record<string, Float32Array | Uint32Array> }).lowBuffers;
  const saved = { ...buffers };
  assert.equal(Object.values(buffers).reduce((bytes, buffer) => bytes + buffer.byteLength, 0), 2_976_000);
  assert.ok(Object.values(buffers).every(buffer => buffer.every(value => value === 0)), "only storage is reserved, no terrain work at construction");
  const { low } = terrainMeshes(scene);
  assert.equal(low.geometry.index, null); assert.equal(low.visible, false);
  terrain.update(0, 0);
  assert.equal(low.geometry.index, null, "high-tier warmup does not build the low mesh");
  terrain.setQuality(1);
  for (const name of ["position", "normal", "color", "groomed"]) assert.equal(low.geometry.getAttribute(name).array, saved[name]);
  assert.equal(low.geometry.index!.array, saved.indices);
  terrain.setQuality(4); terrain.update(401, 201); terrain.setQuality(1);
  for (const name of ["position", "normal", "color", "groomed"]) assert.equal(low.geometry.getAttribute(name).array, saved[name]);
  assert.equal(low.geometry.index!.array, saved.indices);
  assert.equal(low.geometry.boundingBox!.min.x, 0);
  terrain.dispose();
});

test("rendered height matches actual index triangles at high and low quality, including negative tile coordinates", () => {
  const world = createProceduralWorld(profile, profile.seed), scene = new THREE.Scene();
  const terrain = new TerrainRenderer(scene, world, undefined, null, 0, 4);
  terrain.update(-75, -315);
  for (const rung of [4, 1] as const) {
    terrain.setQuality(rung);
    const { high, low } = terrainMeshes(scene), meshes = rung === 4 ? high : [low];
    const point = new THREE.Vector2();
    for (const mesh of meshes) {
      const p = mesh.geometry.getAttribute("position"), indices = mesh.geometry.index!;
      // Centroids test both alternating triangle orientations across the window.
      for (let i = 0; i < indices.count; i += 591) {
        const a = indices.getX(i), b = indices.getX(i + 1), c = indices.getX(i + 2);
        point.set((p.getX(a) + p.getX(b) + p.getX(c)) / 3 + mesh.position.x,
          (p.getZ(a) + p.getZ(b) + p.getZ(c)) / 3 + mesh.position.z);
        const expected = (p.getY(a) + p.getY(b) + p.getY(c)) / 3;
        assert.ok(Math.abs(terrain.sampleRenderedHeight(point.x, point.y) - expected) < 1e-8);
      }
    }
  }
  assert.equal(terrain.sampleRenderedHeight(10000, 10000), world.terrain.height(10000, 10000));
  terrain.dispose();
});
