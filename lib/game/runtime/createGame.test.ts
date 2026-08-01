import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { brotliDecompressSync } from "node:zlib";
import * as THREE from "three";
import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import { createSimulation } from "../core/simulation";
import type { TerrainMeta, TrailsFile } from "../terrain/formats";
import { createWorld } from "../terrain/obstacles";
import { WorldRenderer } from "../rendering/WorldRenderer";
import { UiBridge } from "./UiBridge";
import { loadTerrainForRuntime } from "./createGame";

function portilloAssets() {
  const directory = path.join(process.cwd(), "public/game/terrain");
  const packed = brotliDecompressSync(readFileSync(path.join(directory, "ski-portillo.height.u16.br")));
  return {
    heightfield: packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength) as ArrayBuffer,
    meta: JSON.parse(readFileSync(path.join(directory, "ski-portillo.meta.json"), "utf8")) as TerrainMeta,
    trails: JSON.parse(readFileSync(path.join(directory, "ski-portillo.trails.json"), "utf8")) as TrailsFile,
  };
}

test("runtime terrain loading reports analytics and falls back to the parity sampler", async () => {
  const profile = DROP_IN_GAME_PROFILES.heavenly;
  const bridge = new UiBridge(profile);
  const failures: string[] = [];
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const source = await loadTerrainForRuntime(profile, bridge, {
      controlActivated() {}, pointerLock() {}, terrainFallback: (name) => failures.push(name),
    }, { load: async () => { throw new TypeError("offline"); } });
    assert.equal(source.kind, "procedural");
    assert.deepEqual(failures, ["TypeError"]);
  } finally {
    console.warn = originalWarn;
  }
});

test("the loaded runtime scene drapes and bounds Portillo landmarks against its moving terrain window", async () => {
  const profile = DROP_IN_GAME_PROFILES["ski-portillo"];
  const bridge = new UiBridge(profile);
  const source = await loadTerrainForRuntime(profile, bridge, {
    controlActivated() {}, pointerLock() {}, terrainFallback() {},
  }, { load: async () => portilloAssets() });
  assert.equal(source.kind, "real");

  const world = createWorld(profile, profile.seed, source.sampler);
  const state = createSimulation(profile, profile.seed, source.sampler);
  const scene = new THREE.Scene();
  const renderer = new WorldRenderer(scene, profile, world);
  renderer.update(state, 0);

  const landmarks = scene.getObjectByName("ski-portillo-landmarks");
  assert.ok(landmarks instanceof THREE.Group);
  const hotel = landmarks.children.find((child) => child.name === "portillo-hotel");
  const lake = landmarks.children.find((child) => child.name === "portillo-lake");
  assert.ok(hotel instanceof THREE.Mesh && hotel.geometry instanceof THREE.BoxGeometry);
  assert.ok(lake instanceof THREE.Mesh && lake.geometry instanceof THREE.PlaneGeometry);
  assert.ok(Math.abs(hotel.position.y - source.sampler.height(hotel.position.x, hotel.position.z)) <= 0.5);
  assert.ok(hotel.geometry.parameters.width <= 60, "hotel silhouette must not clip into a viewport wedge");
  assert.equal(hotel.visible, false, "hotel must hide while its supporting terrain tile is absent");
  assert.equal(lake.visible, false, "lake must hide while its supporting terrain tile is absent");

  state.pos.x = -300;
  state.pos.z = -700;
  renderer.update(state, 0);
  assert.equal(hotel.visible, true, "grounded hotel appears once its terrain is in the streaming window");
});
