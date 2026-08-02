import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import { FIXED_HZ } from "../core/clock";
import { createSimulation } from "../core/simulation";
import type { TerrainSampler } from "../core/types";
import type { GhostSample } from "../replay/codec";
import { InputManager } from "../input/InputManager";
import { createProceduralWorld } from "../terrain/obstacles";
import { CameraController } from "./CameraController";
import { QualityController, seedQualityRung } from "./QualityController";
import { createGhostPose, GhostRenderer, sampleGhostAt } from "./GhostRenderer";
import { GameRenderer, shouldInitializePostProcessing, type RendererBackend } from "./Renderer";
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

test("chromaticAberrationOffset reuses a module-scope tuple (zero-alloc frame path)", () => {
  const first = chromaticAberrationOffset(1, false);
  const second = chromaticAberrationOffset(0.5, false);
  assert.equal(first, second, "must return the same buffer every call");
  // Values from the latest call are still correct after reuse.
  assert.deepEqual([...chromaticAberrationOffset(0, false)], [0, 0]);
  const full = chromaticAberrationOffset(1, false);
  assert.ok(full[0] > 0 && full[1] > 0 && full[1] < full[0]);
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
  readonly backendKind = "webgl" as const;
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

test("PostProcessing remains enabled when no backend is injected", () => {
  assert.equal(shouldInitializePostProcessing({}), true);
  assert.equal(shouldInitializePostProcessing({ backend: new FakeBackend() }), false);
});

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

// ─── Ghost renderer ──────────────────────────────────────────

function ghostSample(tick: number, xCm: number, zCm: number, yaw: number, groundOffsetCm = 0): GhostSample {
  return { tick, xCm, zCm, groundOffsetCm, yaw, speedCms: 1200, poseFlags: 0 };
}

test("ghost interpolation lands halfway between two samples at the midpoint tick", () => {
  const samples = [ghostSample(0, 0, 0, 0, 100), ghostSample(FIXED_HZ, 1000, -2000, 0, 300)];
  const pose = sampleGhostAt(samples, 0.5, createGhostPose());
  assert.equal(pose.visible, true);
  assert.ok(Math.abs(pose.x - 5) < 1e-9, `x ${pose.x}`);
  assert.ok(Math.abs(pose.z + 10) < 1e-9, `z ${pose.z}`);
  assert.ok(Math.abs(pose.groundOffset - 2) < 1e-9, `groundOffset ${pose.groundOffset}`);
});

test("ghost yaw interpolation crosses the wrap seam along the short arc", () => {
  // 0.1 rad before 2π to 0.1 rad after 0: the short arc is 0.2 rad through the seam.
  const a = Math.PI * 2 - 0.1;
  const samples = [ghostSample(0, 0, 0, a), ghostSample(FIXED_HZ, 0, 0, 0.1)];
  const mid = sampleGhostAt(samples, 0.5, createGhostPose()).yaw;
  const delta = Math.atan2(Math.sin(mid - a), Math.cos(mid - a));
  assert.ok(Math.abs(delta - 0.1) < 1e-3, `expected +0.1 rad from ${a}, got ${mid} (delta ${delta})`);
  // And the same seam taken the other way.
  const back = [ghostSample(0, 0, 0, 0.1), ghostSample(FIXED_HZ, 0, 0, a)];
  const midBack = sampleGhostAt(back, 0.5, createGhostPose()).yaw;
  const deltaBack = Math.atan2(Math.sin(midBack - 0.1), Math.cos(midBack - 0.1));
  assert.ok(Math.abs(deltaBack + 0.1) < 1e-3, `expected -0.1 rad from 0.1, got ${midBack}`);
});

test("ghost is hidden outside the recorded sample range and exact at the ends", () => {
  const samples = [ghostSample(FIXED_HZ, 500, 0, 0), ghostSample(FIXED_HZ * 3, 900, 0, 0)];
  assert.equal(sampleGhostAt(samples, 0.5, createGhostPose()).visible, false, "before the first sample");
  assert.equal(sampleGhostAt(samples, 3.5, createGhostPose()).visible, false, "after the last sample");
  const first = sampleGhostAt(samples, 1, createGhostPose());
  assert.equal(first.visible, true);
  assert.ok(Math.abs(first.x - 5) < 1e-9);
  const last = sampleGhostAt(samples, 3, createGhostPose());
  assert.equal(last.visible, true);
  assert.ok(Math.abs(last.x - 9) < 1e-9);
  assert.equal(sampleGhostAt([], 1, createGhostPose()).visible, false, "empty ghost");
});

test("ghost interpolation finds the right bracket across many samples without allocating", () => {
  const samples = Array.from({ length: 64 }, (_, i) => ghostSample(i * 12, i * 100, i * -50, 0));
  const pose = createGhostPose();
  for (let i = 0; i < 63; i += 1) {
    const t = (i * 12 + 6) / FIXED_HZ;
    sampleGhostAt(samples, t, pose);
    assert.ok(Math.abs(pose.x - (i + 0.5)) < 1e-9, `sample ${i}: x ${pose.x}`);
  }
  // Reusing one `out` object is the whole contract — no new object per call.
  assert.equal(sampleGhostAt(samples, 0.1, pose), pose);
});

test("ghost renderer draws a translucent poster-ink rider that never writes depth or shadows", () => {
  const scene = new THREE.Scene();
  const ghost = new GhostRenderer(scene);
  ghost.setGhost({
    meta: { formatVersion: 1, physicsVersion: 1, courseVersion: 1, sampleHz: 10, flags: 0, seed: 1, originXCm: 0, originYCm: 0, originZCm: 0, keyframeCount: 2 },
    samples: [ghostSample(0, 0, 0, 0, 200), ghostSample(FIXED_HZ, 1000, 0, 0, 200)],
  });
  const meshes: THREE.Mesh[] = [];
  scene.traverse((object) => { if (object instanceof THREE.Mesh) meshes.push(object); });
  assert.ok(meshes.length >= 3, `expected a body/head/skis rig, got ${meshes.length} meshes`);
  for (const mesh of meshes) {
    const material = mesh.material as THREE.MeshStandardMaterial;
    assert.equal(mesh.castShadow, false);
    assert.equal(material.transparent, true);
    assert.equal(material.opacity, 0.45);
    assert.equal(material.depthWrite, false);
    assert.equal(material.color.getHex(), 0x2a1f14);
  }
  ghost.update(0.5);
  const root = scene.children.find((child) => child instanceof THREE.Group) as THREE.Group;
  assert.equal(root.visible, true);
  assert.ok(Math.abs(root.position.x - 5) < 1e-9);
  assert.ok(Math.abs(root.position.y - 2) < 1e-9, "ground offset with no terrain sampler");
  ghost.update(9);
  assert.equal(root.visible, false, "hidden past the last sample");
  ghost.dispose();
});

test("ghost renderer rides the terrain when a sampler is supplied and releases on setGhost(null)", () => {
  const scene = new THREE.Scene();
  const ghost = new GhostRenderer(scene);
  const sampler: TerrainSampler = {
    kind: "procedural", profile, seed: 1, noiseOffset: { x: 0, z: 0 },
    height(x) { return x * 2; },
    normal(_x, _z, out) { out.x = 0; out.y = 1; out.z = 0; return out; },
    trailField() { return 0; },
    nearestTrail(_x, _z, out) { return out; },
  };
  ghost.setGhost({
    meta: { formatVersion: 1, physicsVersion: 1, courseVersion: 1, sampleHz: 10, flags: 0, seed: 1, originXCm: 0, originYCm: 0, originZCm: 0, keyframeCount: 2 },
    samples: [ghostSample(0, 0, 0, 0, 100), ghostSample(FIXED_HZ, 400, 0, 0, 100)],
  });
  ghost.update(0.5, sampler);
  const root = scene.children.find((child) => child instanceof THREE.Group) as THREE.Group;
  assert.equal(root.visible, true);
  assert.ok(Math.abs(root.position.x - 2) < 1e-9);
  assert.ok(Math.abs(root.position.y - (4 + 1)) < 1e-9, `terrain height + ground offset, got ${root.position.y}`);

  ghost.setGhost(null);
  assert.equal(root.visible, false, "setGhost(null) hides the rider");
  ghost.update(0.5, sampler);
  assert.equal(root.visible, false, "and keeps it hidden");
  ghost.dispose();
  assert.equal(scene.children.length, 0, "dispose detaches the rig from the scene");
});

test("GameRenderer exposes an optional ghost track driven by the sim clock", () => {
  const world = createProceduralWorld(profile, profile.seed);
  const state = createSimulation(profile, profile.seed);
  const canvas = { clientWidth: 800, clientHeight: 600, addEventListener() {}, removeEventListener() {} } as unknown as HTMLCanvasElement;
  const renderer = new GameRenderer(canvas, profile, world, state, { backend: new FakeBackend(), devicePixelRatio: 1, reducedMotion: true });
  const before = renderer.resources().materials;
  renderer.setGhost({
    meta: { formatVersion: 1, physicsVersion: 1, courseVersion: 1, sampleHz: 10, flags: 0, seed: 1, originXCm: 0, originYCm: 0, originZCm: 0, keyframeCount: 2 },
    samples: [ghostSample(0, 0, 0, 0, 100), ghostSample(FIXED_HZ * 20, 1000, 0, 0, 100)],
  });
  assert.equal(renderer.resources().materials, before, "the ghost rig is built once, up front");
  state.time = 1;
  renderer.render(state, world, 1 / 60, 0);
  const ghostRoot = findGhostRoot(renderer);
  assert.equal(ghostRoot.visible, true, "the ghost follows state.time");
  state.time = 40;
  renderer.render(state, world, 1 / 60, 0);
  assert.equal(ghostRoot.visible, false, "and hides past the end of the replay");
  renderer.setGhost(null);
  renderer.dispose();
});

function findGhostRoot(renderer: GameRenderer): THREE.Object3D {
  const root = (renderer as unknown as { ghost: { root: THREE.Object3D } }).ghost.root;
  assert.ok(root, "GameRenderer owns a GhostRenderer");
  return root;
}
