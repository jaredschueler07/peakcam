import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import { createSimulation } from "../core/simulation";
import type { TerrainSampler } from "../core/types";
import { InputManager } from "../input/InputManager";
import { createProceduralWorld } from "../terrain/obstacles";
import { CameraController } from "./CameraController";
import { QualityController, seedQualityRung } from "./QualityController";
import { GameRenderer, type RendererBackend } from "./Renderer";
import { buildPosterLut, buildSnowDetailNormal } from "./SnowMaterial";
import { chromaticAberrationOffset } from "./MotionEffects";
import { configureSceneMaterials } from "./Renderer";
import { fogExp2Amount, heightFogAmount, type AtmosphereUniforms } from "./Atmosphere";
import { SkierRenderer } from "./SkierRenderer";
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

test("quality controller walks rungs before pixel scale and never crosses the 0.7 floor", () => {
  const quality = new QualityController(4);
  assert.deepEqual(quality.observe(44), { rung: 3, pixelScale: 1, changed: true });
  quality.observe(44); quality.observe(44); quality.observe(44);
  assert.equal(quality.rung, 0);
  assert.equal(quality.observe(44).pixelScale, 0.9);
  assert.equal(quality.observe(44).pixelScale, 0.8);
  assert.equal(quality.observe(44).pixelScale, 0.7);
  assert.equal(quality.observe(44).pixelScale, 0.7);
  assert.equal(quality.observe(59).rung, 0, "resolution recovers before quality");
  quality.observe(59); quality.observe(59);
  assert.equal(quality.pixelScale, 1);
  assert.equal(quality.observe(59).rung, 1);
});

test("initial quality rung uses device memory, cores, coarse pointer, and DPR", () => {
  assert.equal(seedQualityRung({ hardwareConcurrency: 12, deviceMemory: 16, coarsePointer: false, dpr: 1 }), 4);
  assert.equal(seedQualityRung({ hardwareConcurrency: 8, deviceMemory: 8, coarsePointer: false, dpr: 2 }), 3);
  assert.equal(seedQualityRung({ hardwareConcurrency: 4, deviceMemory: 4, coarsePointer: true, dpr: 3 }), 1);
  assert.equal(seedQualityRung({ hardwareConcurrency: 2, deviceMemory: 2, coarsePointer: true, dpr: 3 }), 0);
});

test("boot-generated poster LUT is 32 cubed and preserves forest and alpenglow accents", () => {
  const lut = buildPosterLut(32);
  assert.equal(lut.image.width, 32);
  assert.equal(lut.image.height, 32);
  assert.equal(lut.image.depth, 32);
  const data = lut.image.data as Uint8Array;
  assert.equal(data.length, 32 ** 3 * 4);
  assert.ok(data.some((value) => value > 0));
});

test("boot-generated snow normal is deterministic 256 square sobel data", () => {
  const a = buildSnowDetailNormal(7), b = buildSnowDetailNormal(7);
  assert.equal(a.image.width, 256); assert.equal(a.image.height, 256);
  assert.deepEqual(a.image.data, b.image.data);
  const data = a.image.data as Uint8Array;
  assert.ok(data.some((value, index) => index % 4 < 2 && value !== 128));
});

test("reduced motion removes shake and halves the 65 to 82 FOV ramp", () => {
  const world = createProceduralWorld(profile, profile.seed);
  const state = createSimulation(profile, profile.seed);
  state.vel.x = 58;
  const reducedCamera = new THREE.PerspectiveCamera(65, 1, 0.5, 1000);
  const fullCamera = new THREE.PerspectiveCamera(65, 1, 0.5, 1000);
  const reduced = new CameraController(reducedCamera, state, true);
  const full = new CameraController(fullCamera, state, false);
  for (let i = 0; i < 240; i += 1) {
    reduced.update(state, world.terrain, 1 / 120, 0);
    full.update(state, world.terrain, 1 / 120, 0);
  }
  assert.ok(Math.abs(reducedCamera.fov - 73.5) < 0.2);
  assert.ok(Math.abs(fullCamera.fov - 82) < 0.2);
  assert.equal(reduced.speedUniform.value, full.speedUniform.value);
  assert.equal(reduced.motionAmplitude, 0);
  assert.ok(full.motionAmplitude > 0);
});

test("reduced motion disables chromatic aberration at every speed", () => {
  assert.deepEqual(chromaticAberrationOffset(1, true), [0, 0]);
  assert.deepEqual(chromaticAberrationOffset(0, false), [0, 0]);
  const [x, y] = chromaticAberrationOffset(1, false);
  assert.ok(x > 0 && y > 0 && x < 0.002 && y < x);
});

test("every preset's height fog matches v1 FogExp2 at player altitude and ignores absolute resort elevation", () => {
  for (const resort of Object.values(DROP_IN_GAME_PROFILES)) for (const weather of resort.weather) for (const distance of [25, 100, 400]) {
    const expected = 1 - Math.exp(-((weather.fog * distance) ** 2));
    assert.ok(Math.abs(fogExp2Amount(weather.fog, distance) - expected) < 1e-12, `${resort.slug} ${weather.name}`);
    assert.equal(heightFogAmount(weather.fog, distance, 100, 100, 0.025), expected);
    assert.equal(heightFogAmount(weather.fog, distance, 3100, 3100, 0.025), expected);
  }
});

test("shared scene materials receive fog and CSM hooks once while skier colors opt out", () => {
  const scene = new THREE.Scene();
  const shared = new THREE.MeshStandardMaterial();
  const skier = new THREE.MeshStandardMaterial(); skier.userData.heightFog = false;
  const terrainA = new THREE.Mesh(new THREE.PlaneGeometry(), shared); terrainA.receiveShadow = true;
  const terrainB = new THREE.Mesh(new THREE.PlaneGeometry(), shared); terrainB.receiveShadow = true;
  scene.add(terrainA, terrainB, new THREE.Mesh(new THREE.BoxGeometry(), skier));
  let csmSetups = 0;
  const uniforms: AtmosphereUniforms = {
    density: { value: 0.002 }, heightFalloff: { value: 0.025 }, referenceHeight: { value: 3000 },
    blue: { value: new THREE.Color() }, warm: { value: new THREE.Color() }, sunDirection: { value: new THREE.Vector3(0, 1, 0) },
  };
  configureSceneMaterials(scene, { setupMaterial() { csmSetups += 1; } }, uniforms);
  assert.equal(csmSetups, 1);
  const shader = { uniforms: {}, vertexShader: "#include <common>\n#include <worldpos_vertex>", fragmentShader: "#include <common>\n#include <fog_fragment>" } as THREE.WebGLProgramParametersWithUniforms;
  shared.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  assert.equal(shader.vertexShader.match(/varying vec3 vAtmosphereWorldPosition/g)?.length, 1);
  assert.equal(skier.customProgramCacheKey().includes("height-fog"), false);

  const skierScene = new THREE.Scene(); new SkierRenderer(skierScene);
  const skierColors = new Set<number>();
  skierScene.traverse((object) => {
    const skierMesh = object as THREE.Mesh;
    if (!(skierMesh.material instanceof THREE.MeshStandardMaterial)) return;
    assert.equal(skierMesh.material.userData.heightFog, false);
    skierColors.add(skierMesh.material.color.getHex());
  });
  assert.ok(skierColors.has(0x1b6fe0), "blue jacket remains saturated");
  assert.ok(skierColors.has(0xff8b2e), "orange skis remain saturated");
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
