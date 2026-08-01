import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import { createSimulation } from "../core/simulation";
import type { TerrainSampler } from "../core/types";
import { InputManager } from "../input/InputManager";
import { createProceduralWorld } from "../terrain/obstacles";
import { AdaptiveResolution } from "./AdaptiveResolution";
import { GameRenderer, type RendererBackend } from "./Renderer";
import { buildTileGeometry } from "./TerrainRenderer";
import { sagAt, WorldRenderer } from "./WorldRenderer";

const profile = DROP_IN_GAME_PROFILES.breckenridge;

test("terrain tile samples world x/z and carries v1 vertex colors", () => {
  const calls: Array<[number, number]> = [];
  const sampler: TerrainSampler = {
    kind: "procedural", profile, seed: 1, noiseOffset: { x: 0, z: 0 },
    height(x, z) { calls.push([x, z]); return x * 0.1 + z * 0.2; },
    normal(_x, _z, out) { out.x = 0; out.y = 1; out.z = 0; return out; },
    trailField(x) { return x === 200 ? 1 : 0; },
    nearestTrail(_x, _z, out) { return out; },
  };
  const geometry = buildTileGeometry(sampler, 1, -1);
  const positions = geometry.getAttribute("position");
  const normals = geometry.getAttribute("normal");
  const colors = geometry.getAttribute("color");
  assert.equal(positions.count, 2601);
  assert.ok(calls.some(([x, z]) => x === 200 && z === -200));
  assert.equal(positions.getY(0), -20);
  assert.ok(Math.abs(normals.getX(0) + 0.097590007) < 1e-6);
  assert.ok(Math.abs(normals.getY(0) - 0.975900073) < 1e-6);
  assert.ok(Math.abs(normals.getZ(0) + 0.195180015) < 1e-6);
  assert.ok(colors.getX(0) > 0.85, "groomed snow remains bright");
  assert.equal(geometry.index?.count, 15_000);
  geometry.dispose();
});

test("lift cable sag matches the v1 span curve", () => {
  assert.equal(sagAt(216, 216), 0);
  assert.ok(Math.abs(sagAt(270, 216) - 2.2) < 1e-12);
  assert.ok(Math.abs(sagAt(324, 216)) < 1e-12);
});

test("ramp dressing uses the same 22m by 10.5m terrain-ramp footprint", () => {
  const world = createProceduralWorld(profile, profile.seed);
  const state = createSimulation(profile, profile.seed);
  state.pos.z = profile.trails[0].ramp;
  const scene = new THREE.Scene();
  const renderer = new WorldRenderer(scene, profile, world);
  renderer.update(state, 0);
  const rails: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>[] = [];
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh && object.geometry instanceof THREE.BoxGeometry &&
        object.material instanceof THREE.MeshStandardMaterial && object.material.emissive.getHex() === 0xffb020 && object.parent?.visible) {
      rails.push(object as THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>);
    }
  });
  assert.ok(rails.length >= 2);
  assert.equal(rails[0].geometry.parameters.depth, 22);
  assert.ok(Math.abs(Math.abs(rails[0].position.x) - 10.5 * 0.86) < 1e-12);
});

test("adaptive resolution responds only outside the 45/58 fps band and clamps", () => {
  const adaptive = new AdaptiveResolution();
  assert.equal(adaptive.observe(44), 0.88);
  assert.equal(adaptive.observe(52), 0.88);
  assert.equal(adaptive.observe(59), 0.96);
  assert.equal(adaptive.observe(59), 1);
  for (let i = 0; i < 10; i += 1) adaptive.observe(20);
  assert.equal(adaptive.scale, 0.55);
});

test("weather and lift actions are rising-edge input actions", () => {
  const input = new InputManager();
  input.setAction("weather2", true);
  input.setAction("weather2", true);
  input.setAction("lift", true);
  assert.equal(input.consumeWeatherPressed(), 1);
  assert.equal(input.consumeWeatherPressed(), null);
  assert.equal(input.consumeLiftPressed(), true);
  assert.equal(input.consumeLiftPressed(), false);
});

class FakeBackend implements RendererBackend {
  readonly domElement = {} as HTMLCanvasElement;
  readonly renderLists = { dispose: () => { this.renderListsDisposed += 1; } };
  renderListsDisposed = 0;
  disposed = 0;
  contextsLost = 0;
  pixelRatio = 0;
  outputColorSpace = THREE.SRGBColorSpace;
  toneMapping = THREE.NoToneMapping;
  toneMappingExposure = 1;
  readonly shadowMap = { enabled: false, type: THREE.PCFShadowMap };
  setPixelRatio(value: number) { this.pixelRatio = value; }
  setSize() {}
  setClearColor() {}
  render() {}
  dispose() { this.disposed += 1; }
  forceContextLoss() { this.contextsLost += 1; }
}

test("mount/unmount ten times disposes every scene resource and context", () => {
  const world = createProceduralWorld(profile, profile.seed);
  const state = createSimulation(profile, profile.seed);
  const canvas = {
    clientWidth: 800, clientHeight: 600,
    addEventListener() {}, removeEventListener() {},
  } as unknown as HTMLCanvasElement;
  for (let pass = 0; pass < 10; pass += 1) {
    const backend = new FakeBackend();
    const disposed = { geometries: 0, materials: 0, textures: 0 };
    const renderer = new GameRenderer(canvas, profile, world, state, {
      backend, devicePixelRatio: 1, reducedMotion: true,
      disposalAudit: {
        geometry: () => { disposed.geometries += 1; },
        material: () => { disposed.materials += 1; },
        texture: () => { disposed.textures += 1; },
      },
    });
    const resources = renderer.resources();
    assert.ok(resources.geometries > 20);
    assert.ok(resources.materials > 10);
    assert.ok(resources.textures >= 2);
    renderer.dispose();
    assert.deepEqual(disposed, resources);
    assert.deepEqual(renderer.resources(), { geometries: 0, materials: 0, textures: 0 });
    assert.equal(backend.disposed, 1);
    assert.equal(backend.renderListsDisposed, 1);
    assert.equal(backend.contextsLost, 1);
  }
});
