import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import { FIXED_HZ } from "../core/clock";
import { createSimulation } from "../core/simulation";
import type { GhostSample } from "../replay/codec";
import { InputManager } from "../input/InputManager";
import { createProceduralWorld } from "../terrain/obstacles";
import { CameraController } from "./CameraController";
import { QualityController, seedQualityRung } from "./QualityController";
import { createGhostPose, GhostRenderer, sampleGhostAt } from "./GhostRenderer";
import { GameRenderer, shouldInitializePostProcessing, type RendererBackend } from "./Renderer";
import { disposeObjectTree, type ResourceCounts } from "./resources";
import { LiftRenderer } from "./LiftRenderer";
import { buildPosterLut, buildSnowDetailNormal } from "./SnowMaterial";
import { chromaticAberrationOffset } from "./MotionEffects";
import { configureSceneMaterials } from "./Renderer";
import { fogExp2Amount, heightFogAmount, type AtmosphereUniforms } from "./Atmosphere";
import { SkierRenderer } from "./SkierRenderer";
import { buildTileGeometry } from "./TerrainRenderer";
import {
  rampRise, RAMP_BANNER_H, RAMP_BANNER_MAX_AREA, RAMP_DECK_CLEARANCE, RAMP_MAX_RISE, RAMP_RAIL_OFFSET,
  sagAt, WorldRenderer,
} from "./WorldRenderer";
import { RAMP_W } from "../terrain/heightfield";
import { staticNodeFactories } from "./nodeFactories.fixture";
import { CAMERA_FAR, createScene } from "./SceneFactory";
import { WeatherRenderer } from "./WeatherRenderer";
import { FAR_FIELD_GROUP_NAME, FAR_FIELD_INNER_RADIUS_M, FarFieldRenderer } from "./FarFieldRenderer";
import { CSM_FAR_REFERENCE, CsmShadows } from "./CsmShadows";
import { visualWeatherPreset } from "./VisualPresets";
import { resourceCounts } from "./resources";
import type { DecodedFarField, FarFieldWedge } from "../terrain/far-field-format";
import { RAMP_LEN } from "../terrain/heightfield";
import type { RealRun, SimulationWorld, TerrainSampler } from "../core/types";

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

test("a ramp's rise is clamped to a rail-shaped range in both directions", () => {
  assert.equal(RAMP_MAX_RISE, RAMP_LEN * 0.6);
  // Ordinary pitches pass through untouched.
  assert.equal(rampRise(100, 96), -4);
  assert.equal(rampRise(100, 103.5), 3.5);
  assert.equal(rampRise(100, 100), 0);
  // A tail segment cutting across a cliff cannot pitch the rail past ~31 degrees.
  assert.equal(rampRise(1800, 1600), -RAMP_MAX_RISE);
  assert.equal(rampRise(1800, 2400), RAMP_MAX_RISE);
  // Exactly at the bound is still allowed, so the clamp adds no discontinuity of its own.
  assert.equal(rampRise(0, RAMP_MAX_RISE), RAMP_MAX_RISE);
});

/**
 * A two-point run whose single segment drops `dropM` over `runM` — a simplified cliff tail — with
 * the drawn heightfield sagging `sagM` below that chord in the middle. Real courses do exactly
 * this: `points` is a simplification, and Portillo's Roca Jack chord runs 5.5-9.9m above the
 * terrain at its ramps. `chordY` is deliberately the *wrong* height to place furniture at.
 */
function syntheticCourse(runM: number, dropM: number, sagM = 0): { world: SimulationWorld; run: RealRun } {
  const chordY = (z: number) => 2000 - dropM * Math.max(0, Math.min(runM, z)) / runM;
  // A half-sine sag: zero at both ends, deepest at mid-course, so the chord and the ground agree
  // exactly where the polyline has vertices and diverge everywhere between them.
  const sag = (z: number) => sagM * Math.sin(Math.PI * Math.max(0, Math.min(runM, z)) / runM);
  const at = (distanceM: number) => ({ x: 0, y: chordY(distanceM), z: distanceM, heading: 0 });
  const run: RealRun = {
    kind: "real", sourceIndex: 0, name: "Cliff", difficulty: null, halfWidthM: 18,
    points: [{ x: 0, y: 2000, z: 0 }, { x: 0, y: 2000 - dropM, z: runM }],
    lengthM: runM, finishM: runM,
    gates: [{ key: 0, distanceM: runM * 0.5, ...at(runM * 0.5), halfWidthM: 9 }],
    ramps: [{ key: 0, distanceM: runM - 45, ...at(runM - 45) }],
  };
  const terrain: TerrainSampler = {
    kind: "real", profile, seed: 1, noiseOffset: { x: 0, z: 0 }, realRuns: [run], mainLift: null,
    height(_x, z) { return chordY(z) - sag(z); },
    normal(_x, _z, out) { out.x = 0; out.y = 1; out.z = 0; return out; },
    trailField() { return 0; },
    nearestTrail(_x, _z, out) { return out; },
  };
  const world = { ...createProceduralWorld(profile, profile.seed), terrain } as SimulationWorld;
  return { world, run };
}

type RampParts = { rail: THREE.Mesh; rail2: THREE.Mesh; banner: THREE.Mesh; postL: THREE.Mesh; postR: THREE.Mesh };

/** The visible ramp group, plus the ground height directly under it. */
function placedRamp(world: SimulationWorld) {
  const state = createSimulation(profile, profile.seed);
  const scene = new THREE.Scene();
  new WorldRenderer(scene, profile, world).update(state, 0);
  const group = scene.children.find((child) => child instanceof THREE.Group && child.visible &&
    (child.userData as { rail?: THREE.Mesh }).rail) as THREE.Group;
  assert.ok(group, "the tail ramp is placed");
  // The renderer never renders in tests, so nothing has resolved the group's world matrices yet.
  scene.updateMatrixWorld(true);
  const parts = group.userData as RampParts;
  return { group, ...parts, groundY: world.terrain.height(group.position.x, group.position.z) };
}

/** World-space axis-aligned extents of a mesh, which is what a screenshot actually shows. */
function worldBox(mesh: THREE.Mesh) {
  const box = new THREE.Box3().setFromObject(mesh), size = new THREE.Vector3();
  box.getSize(size);
  return { box, size };
}

test("a cliff-tail ramp renders as a ramp, not a beam hanging over the course", () => {
  // 800m of run losing 700m of altitude: 22m along it reads as a ~19m drop, which used to pitch
  // the rail to 41 degrees and hang its centre 9.6m in the air.
  const { rail, rail2 } = placedRamp(syntheticCourse(800, 700).world);
  assert.ok(Math.abs(rail.position.y) <= RAMP_MAX_RISE / 2 + 1e-9, `rail centre stays low, got ${rail.position.y}`);
  assert.ok(Math.abs(rail.rotation.x) <= Math.atan2(RAMP_MAX_RISE, RAMP_LEN) + 1e-9, `pitch is bounded, got ${rail.rotation.x}`);
  assert.equal(rail2.rotation.x, rail.rotation.x, "both rails share the pitch");
  assert.equal(rail2.position.y, rail.position.y);
});

test("a gentle course leaves the ramp pitch exactly as the terrain dictates", () => {
  const { rail } = placedRamp(syntheticCourse(800, 80).world);
  const expected = -80 * RAMP_LEN / 800;
  assert.ok(Math.abs(rail.position.y - expected / 2) < 1e-6, `unclamped rise survives, got ${rail.position.y}`);
});

test("the ramp deck sits on the drawn terrain, not on the run polyline chord", () => {
  // 40m of sag is the pathology at full scale: Portillo's Roca Jack chord measured 5.5m and 9.9m
  // above the heightfield at its two ramps, which floated the whole group — banner included.
  const { world, run } = syntheticCourse(800, 240, 40);
  const { group, groundY } = placedRamp(world);
  const chordY = run.ramps[0].y;
  assert.ok(chordY - groundY > 5, `the fixture reproduces a real float, got ${(chordY - groundY).toFixed(2)}m`);
  assert.ok(Math.abs(group.position.y - (groundY + 0.2)) < 1e-9,
    `deck rides the terrain, got ${group.position.y} for ground ${groundY}`);
});

/** Courses the banner must survive: a gentle run, the cliff tail, and two mid cases. */
const BANNER_COURSES: [number, number, number][] = [[800, 240, 40], [800, 700, 0], [400, 60, 12], [1200, 300, 25]];

test("the ramp banner stands as an upright gate panel, not a slab lying on the snow", () => {
  for (const [runM, dropM, sagM] of BANNER_COURSES) {
    const label = `${runM}/${dropM}/${sagM}`;
    const { banner } = placedRamp(syntheticCourse(runM, dropM, sagM).world);
    const { size } = worldBox(banner);
    // The discriminator between a standing banner and the reported flat slab. A panel facing down
    // the fall line has all its area in x-y and no depth; a slab lying on the snow has it in x-z.
    assert.ok(size.z < 0.2, `banner has no depth when upright, got ${size.z.toFixed(2)}m at ${label}`);
    assert.ok(Math.abs(size.y - RAMP_BANNER_H) < 1e-6, `banner stands its full height at ${label}`);
    // It must reach across the rails it is a gate for...
    assert.ok(size.x >= RAMP_RAIL_OFFSET * 2, `banner clears both rails, got ${size.x.toFixed(2)}m at ${label}`);
    // ...and never exceed the deck it stands on. RAMP_W is the ramp's *half*-width (heightfield
    // rejects |x - centre| > RAMP_W), so the deck is 21m and this is a real bound, not a formality.
    assert.ok(size.x <= RAMP_W * 2, `banner never outgrows the 21m deck, got ${size.x.toFixed(2)}m at ${label}`);
    // The tight one: the posts sit just outside the rails, so the span cannot creep back up.
    assert.ok(size.x <= RAMP_RAIL_OFFSET * 2 + 1.4, `posts hug the rails, got ${size.x.toFixed(2)}m at ${label}`);
  }
});

test("the ramp banner's face stays inside its projected-area budget", () => {
  // Span is pinned by the feature the gate spans, so height is the only free term and area is the
  // thing that actually made it read as a billboard wall. Budget it explicitly.
  for (const [runM, dropM, sagM] of BANNER_COURSES) {
    const { banner } = placedRamp(syntheticCourse(runM, dropM, sagM).world);
    const { size } = worldBox(banner);
    const area = size.x * size.y;
    assert.ok(area <= RAMP_BANNER_MAX_AREA,
      `banner face is ${area.toFixed(1)}m2, over the ${RAMP_BANNER_MAX_AREA}m2 budget at ${runM}/${dropM}/${sagM}`);
  }
});

test("the ramp banner reads as fabric, not as a solid panel", () => {
  // Near-opaque navy at ~19m wide is a wall whatever its dimensions. The run line behind the gate
  // has to stay visible through it, so transparency is part of the contract, not a style choice.
  const { banner } = placedRamp(syntheticCourse(800, 240, 40).world);
  const material = banner.material as THREE.MeshStandardMaterial;
  assert.ok(material.transparent, "banner blends rather than occluding");
  assert.ok(material.opacity <= 0.7, `banner is see-through, got opacity ${material.opacity}`);
  assert.ok(material.emissiveIntensity <= 0.2, `banner does not glow as a block, got ${material.emissiveIntensity}`);
});

test("the ramp banner's up-vector stays vertical regardless of the ramp's rise", () => {
  // The group is yawed by heading and nothing else, so the panel's own +Y must remain world up.
  // A rise-dependent pitch leaking into the banner — the failure mode this guards — tilts it.
  for (const [runM, dropM, sagM] of BANNER_COURSES) {
    const { banner } = placedRamp(syntheticCourse(runM, dropM, sagM).world);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(banner.getWorldQuaternion(new THREE.Quaternion()));
    assert.ok(up.dot(new THREE.Vector3(0, 1, 0)) > 0.9998,
      `banner up-vector is vertical, got ${up.toArray().map((v) => v.toFixed(3)).join(",")} at ${runM}/${dropM}/${sagM}`);
  }
});

test("the ramp banner is carried overhead by uprights that stand on the deck", () => {
  for (const [runM, dropM, sagM] of BANNER_COURSES) {
    const label = `${runM}/${dropM}/${sagM}`;
    const { banner, postL, postR, groundY } = placedRamp(syntheticCourse(runM, dropM, sagM).world);
    const deck = groundY + RAMP_DECK_CLEARANCE;
    const panel = worldBox(banner).box, left = worldBox(postL).box, right = worldBox(postR).box;
    // Bounded at both ends. Below ~2.5m a skier clips the panel and it starts reading as ground
    // marking again; above ~5m it rises onto the horizon line at the cinematic camera's downward
    // pitch, which is what made the 6m-post version read as a wall rather than as a gate.
    assert.ok(panel.min.y - deck > 2.5, `panel clears a skier, got ${(panel.min.y - deck).toFixed(2)}m at ${label}`);
    assert.ok(panel.max.y - deck < 5, `panel stays below the skyline, got ${(panel.max.y - deck).toFixed(2)}m at ${label}`);
    // Posts do the holding up: based on the deck, tall enough to reach the panel's top edge.
    for (const [name, post] of [["left", left], ["right", right]] as const) {
      assert.ok(Math.abs(post.min.y - deck) < 1e-6, `${name} post is footed on the deck at ${label}`);
      assert.ok(post.max.y >= panel.max.y - 1e-6, `${name} post reaches the panel top at ${label}`);
    }
    // And they straddle it rather than standing inside the span.
    assert.ok(left.max.x <= panel.min.x + 0.3 && right.min.x >= panel.max.x - 0.3,
      `posts straddle the panel at ${label}`);
    assert.ok(Math.abs(left.min.z - panel.min.z) < 1, `posts share the panel's plane at ${label}`);
  }
});

test("gates are draped on the terrain too, not left floating on the chord", () => {
  // Same defect class, and worse in the real data: Roca Jack's gates measured up to 17.5m off.
  const { world, run } = syntheticCourse(800, 240, 40);
  const state = createSimulation(profile, profile.seed);
  const scene = new THREE.Scene();
  new WorldRenderer(scene, profile, world).update(state, 0);
  const gate = scene.children.find((child) => child instanceof THREE.Group && child.visible &&
    (child.userData as { panel?: THREE.Mesh }).panel) as THREE.Group;
  assert.ok(gate, "the gate is placed");
  const groundY = world.terrain.height(gate.position.x, gate.position.z);
  assert.ok(run.gates[0].y - groundY > 5, "the fixture reproduces a real float");
  assert.ok(Math.abs(gate.position.y - groundY) < 1e-9,
    `gate rides the terrain, got ${gate.position.y} for ground ${groundY}`);
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
    density: { value: 0.002 }, heightFalloff: { value: 0.025 }, referenceHeight: { value: 3000 }, farRetention: { value: 0 },
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

/**
 * The two flavours are not interchangeable, and pretending they were is what let a WebGL-only call
 * ship on the WebGPU default. `renderLists`, `forceContextLoss` and `resetState` are WebGLRenderer
 * APIs: `WebGPURenderer` (three 0.185.1) exposes none of them — it keeps a private `_renderLists`
 * that its own `dispose()` tears down. A fake that stubs them on both flavours makes the disposal
 * audit pass while production crashes on unmount, so the WebGPU fake must omit them.
 */
class FakeBackend implements RendererBackend {
  readonly domElement = {} as HTMLCanvasElement;
  readonly renderLists?: { dispose(): void };
  readonly forceContextLoss?: () => void;
  readonly resetState?: () => void;
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
  constructor(readonly backendKind: "webgpu" | "webgl" = "webgl") {
    if (backendKind === "webgl") {
      this.renderLists = { dispose: () => { this.renderListsDisposed += 1; } };
      this.forceContextLoss = () => { this.contextsLost += 1; };
      this.resetState = () => {};
    }
  }
}

/**
 * The disposal audit ran WebGL-only, which left the whole node-material set untested: the sky
 * `MeshBasicNodeMaterial`, the snow `MeshStandardNodeMaterial` and its detail normal, the two
 * `PointsNodeMaterial` particle clouds and their radial sprite textures, and the instanced quad
 * geometries those clouds use instead of point clouds. Each is built by a different factory and
 * hangs its texture off `userData`, which is the one place `collectResources` can still see it.
 */
function disposalPasses(backendKind: "webgpu" | "webgl") {
  const world = createProceduralWorld(profile, profile.seed);
  const state = createSimulation(profile, profile.seed);
  const canvas = {
    clientWidth: 800, clientHeight: 600,
    addEventListener() {}, removeEventListener() {},
  } as unknown as HTMLCanvasElement;
  let counts: ResourceCounts | null = null;
  for (let pass = 0; pass < 10; pass += 1) {
    const backend = new FakeBackend(backendKind);
    // Guards the fake itself: if a WebGL-only stub ever creeps back onto the WebGPU flavour, the
    // audit below silently stops covering the backend the default production path actually uses.
    if (backendKind === "webgpu") {
      assert.equal(backend.renderLists, undefined, "the WebGPU fake must model a backend without renderLists");
      assert.equal(backend.forceContextLoss, undefined, "…nor forceContextLoss");
      assert.equal(backend.resetState, undefined, "…nor resetState");
    }
    const disposed = { geometries: 0, materials: 0, textures: 0 };
    const renderer = new GameRenderer(canvas, profile, world, state, {
      backend, devicePixelRatio: 1, reducedMotion: true,
      nodeFactories: backendKind === "webgpu" ? staticNodeFactories() : null,
      disposalAudit: {
        geometry: () => { disposed.geometries += 1; },
        material: () => { disposed.materials += 1; },
        texture: () => { disposed.textures += 1; },
      },
    });
    const beforeFarField = renderer.resources();
    renderer.attachFarField(farFieldAsset());
    const resources = renderer.resources();
    // The audit is what catches leaks on route changes, so it has to see the far field too.
    assert.equal(resources.geometries - beforeFarField.geometries, 16, `${backendKind}: far-field wedges`);
    assert.equal(resources.materials - beforeFarField.materials, 1, `${backendKind}: far-field material`);
    assert.ok(resources.geometries > 20, `${backendKind}: geometries ${resources.geometries}`);
    assert.ok(resources.materials > 10, `${backendKind}: materials ${resources.materials}`);
    assert.ok(resources.textures >= 2, `${backendKind}: textures ${resources.textures}`);
    renderer.dispose();
    assert.deepEqual(disposed, resources, `${backendKind}: every collected resource is disposed`);
    assert.deepEqual(renderer.resources(), { geometries: 0, materials: 0, textures: 0 });
    assert.equal(backend.disposed, 1);
    // The WebGL-only teardown must still run in full on WebGL, and must simply be skipped — not
    // crash — on WebGPU, whose own `dispose()` already releases its private render lists.
    const webglOnly = backendKind === "webgl" ? 1 : 0;
    assert.equal(backend.renderListsDisposed, webglOnly, `${backendKind}: renderLists.dispose()`);
    assert.equal(backend.contextsLost, webglOnly, `${backendKind}: forceContextLoss()`);
    counts ??= resources;
    assert.deepEqual(resources, counts, `${backendKind}: pass ${pass} rebuilds the same scene`);
  }
  return counts!;
}

test("PostProcessing remains enabled when no backend is injected", () => {
  assert.equal(shouldInitializePostProcessing({}), true);
  assert.equal(shouldInitializePostProcessing({ backend: new FakeBackend() }), false);
});

/**
 * Regression: `dispose()` called `this.renderer.renderLists.dispose()` unconditionally. That is a
 * WebGLRenderer API, so once WebGPU became the default backend every user on a WebGPU browser hit
 * "Cannot read properties of undefined (reading 'dispose')" the moment React unmounted the game —
 * i.e. on the in-game Conditions back link.
 */
test("disposing a WebGPU backend does not touch WebGL-only teardown APIs", () => {
  const world = createProceduralWorld(profile, profile.seed);
  const state = createSimulation(profile, profile.seed);
  const canvas = { clientWidth: 800, clientHeight: 600, addEventListener() {}, removeEventListener() {} } as unknown as HTMLCanvasElement;
  const backend = new FakeBackend("webgpu");
  const renderer = new GameRenderer(canvas, profile, world, state, {
    backend, devicePixelRatio: 1, reducedMotion: true, nodeFactories: staticNodeFactories(),
  });
  renderer.dispose();
  assert.equal(backend.disposed, 1, "the backend's own dispose() still runs");
  assert.deepEqual(renderer.resources(), { geometries: 0, materials: 0, textures: 0 });
});

test("mount/unmount ten times disposes every scene resource and context (WebGL)", () => {
  disposalPasses("webgl");
});

test("mount/unmount ten times disposes every node-material resource too (WebGPU)", () => {
  const webgpu = disposalPasses("webgpu");
  const webgl = disposalPasses("webgl");
  // The node path swaps materials one-for-one but replaces both THREE.Points clouds with instanced
  // quad meshes, so it carries the same counts — if a factory ever stops registering its texture on
  // userData, `collectResources` goes blind to it and this equality is what catches the leak.
  assert.deepEqual(webgpu, { ...webgl, geometries: webgl.geometries + 1, materials: webgl.materials + 2 }, "the node scene retains an inactive sky and snow material for thermal transitions");
  assert.ok(webgpu.textures >= 3, `sky/snow detail plus both particle sprites, got ${webgpu.textures}`);
});

test("the WebGPU scene really is built from node materials, so the audit above covers them", () => {
  const world = createProceduralWorld(profile, profile.seed);
  const state = createSimulation(profile, profile.seed);
  const canvas = { clientWidth: 800, clientHeight: 600, addEventListener() {}, removeEventListener() {} } as unknown as HTMLCanvasElement;
  const renderer = new GameRenderer(canvas, profile, world, state, {
    backend: new FakeBackend("webgpu"), devicePixelRatio: 1, reducedMotion: true,
    nodeFactories: staticNodeFactories(),
    // Pinned above rung 2 so the sky is deterministically SkyMesh (its `NodeMaterial`, not the
    // gradient's `MeshBasicNodeMaterial`) regardless of the machine running the suite.
    qualitySignals: { hardwareConcurrency: 8, deviceMemory: 8, coarsePointer: false, dpr: 1 },
  });
  const scene = (renderer as unknown as { built: { scene: THREE.Scene } }).built.scene;
  const kinds = new Set<string>();
  const sprites = new Set<THREE.Texture>();
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    const list = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of list) {
      if ((material as THREE.Material & { isNodeMaterial?: boolean }).isNodeMaterial) kinds.add(material.constructor.name);
      for (const value of Object.values(material.userData)) if (value instanceof THREE.Texture) sprites.add(value);
    }
  });
  // "NodeMaterial" is SkyMesh's own material (rung 2+ mounts the physical sky, not the gradient).
  assert.deepEqual([...kinds].sort(), ["MeshBasicNodeMaterial", "NodeMaterial", "PointsNodeMaterial", "SnowStandardNodeMaterial"]);
  assert.equal(sprites.size, 3, "snow detail normal plus a radial sprite per particle cloud");
  renderer.dispose();
  assert.deepEqual(renderer.resources(), { geometries: 0, materials: 0, textures: 0 });
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

// ─── Far field ───────────────────────────────────────────────

/** A minimal but structurally real asset: one quad per wedge, inner rim to horizon. */
function farFieldAsset(wedgeCount = 16, radiusM = 30_000, elevation = 3000): DecodedFarField {
  const innerM = 50; // off-origin, so each wedge is a real quad rather than a degenerate fan
  const wedges: FarFieldWedge[] = [];
  for (let w = 0; w < wedgeCount; w += 1) {
    const azimuthStartRad = (w * 2 * Math.PI) / wedgeCount;
    const azimuthEndRad = ((w + 1) * 2 * Math.PI) / wedgeCount;
    const positions = new Float32Array(12);
    let at = 0;
    for (const r of [innerM, radiusM]) {
      for (const az of [azimuthStartRad, azimuthEndRad]) {
        positions[at] = r * Math.sin(az);
        positions[at + 1] = elevation;
        positions[at + 2] = -r * Math.cos(az);
        at += 3;
      }
    }
    wedges.push({
      index: w, azimuthStartRad, azimuthEndRad, positions,
      indices: new Uint32Array([0, 2, 1, 1, 2, 3]), minY: elevation, maxY: elevation,
    });
  }
  return {
    meta: {
      formatVersion: 1, slug: "ski-portillo", radiusM, wedgeCount,
      centre: [-32.842, -70.129], demSource: "test", bakedAt: "2026-08-02T00:00:00.000Z",
    },
    wedges,
  };
}

/** A frustum for a camera at `y` metres looking along `dir`. */
function frustumLookingAt(dir: THREE.Vector3, y = 3010): { camera: THREE.PerspectiveCamera; frustum: THREE.Frustum } {
  const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.5, CAMERA_FAR);
  camera.position.set(0, y, 0);
  camera.lookAt(dir.x, y, dir.z);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
  return { camera, frustum };
}

test("the camera far plane reaches past the far field, or none of it would draw", () => {
  assert.ok(CAMERA_FAR > 30_000, `camera far ${CAMERA_FAR} clips a 30 km far field`);
  const scene = createScene(profile, 16 / 9, null);
  assert.equal(scene.camera.far, CAMERA_FAR);
});

test("far field builds one mesh per wedge, with normals and no shadow participation", () => {
  const scene = new THREE.Scene();
  const far = new FarFieldRenderer(scene, farFieldAsset(), { nodes: null });
  const meshes: THREE.Mesh[] = [];
  far.group.traverse((o) => { if (o instanceof THREE.Mesh) meshes.push(o); });
  assert.equal(meshes.length, 16);
  for (const mesh of meshes) {
    assert.ok(mesh.geometry.getAttribute("position"));
    assert.ok(mesh.geometry.getAttribute("normal"), "lighting needs normals the asset does not carry");
    assert.ok(mesh.geometry.getIndex());
    // Distant geometry sits far beyond the 460 m shadow cascade — by design.
    assert.equal(mesh.castShadow, false);
    assert.equal(mesh.receiveShadow, false);
    // We cull by wedge ourselves; three's sphere test is useless at this scale.
    assert.equal(mesh.frustumCulled, false);
  }
  far.dispose();
});

test("the renderer's inner radius mirrors the baker's: no hole, because the tiles follow the player", () => {
  // The near-field tile grid re-centres on the player each frame while the asset is anchored to
  // the resort, so any resort-centred hole is uncovered the moment the player skis away from it.
  assert.equal(FAR_FIELD_INNER_RADIUS_M, 0);
});

test("the far field does not follow the camera — it is georeferenced, unlike the ridge bands", () => {
  const scene = new THREE.Scene();
  const far = new FarFieldRenderer(scene, farFieldAsset(), { nodes: null });
  assert.deepEqual(far.group.position.toArray(), [0, 0, 0]);
  far.dispose();
});

test("far-field material takes the same height fog as the near field on WebGL", () => {
  const scene = new THREE.Scene();
  const far = new FarFieldRenderer(scene, farFieldAsset(), { nodes: null });
  const material = far.material as THREE.Material & { fog?: boolean };
  // The three conditions configureSceneMaterials requires to fog a material.
  assert.notEqual(material.fog, false, "fog:false is what made the ridge bands read as a colour step");
  assert.notEqual(material.userData.heightFog, false);
  assert.ok(!(material instanceof THREE.ShaderMaterial), "configureSceneMaterials skips ShaderMaterials");

  const uniforms: AtmosphereUniforms = {
    density: { value: 0.012 }, heightFalloff: { value: 0.025 }, referenceHeight: { value: 0 }, farRetention: { value: 0 },
    blue: { value: new THREE.Color(0x9fc0e8) }, warm: { value: new THREE.Color(0xffd9a8) },
    sunDirection: { value: new THREE.Vector3(0, 1, 0) },
  };
  configureSceneMaterials(scene, { setupMaterial() { assert.fail("far field must not join the shadow cascade"); } }, uniforms);
  assert.equal(material.userData.heightFogConfigured, true, "the far field never got height fog");
  far.dispose();
});

test("far-field material is backend gated: node material on WebGPU, classic on WebGL", () => {
  const webglScene = new THREE.Scene();
  const webgl = new FarFieldRenderer(webglScene, farFieldAsset(), { nodes: null });
  assert.ok(webgl.material instanceof THREE.MeshStandardMaterial, "WebGL gets the classic material");
  webgl.dispose();

  const webgpuScene = new THREE.Scene();
  const webgpu = new FarFieldRenderer(webgpuScene, farFieldAsset(), { nodes: staticNodeFactories() });
  assert.ok(!(webgpu.material instanceof THREE.MeshStandardMaterial), "WebGPU must not get the classic material");
  assert.match(webgpu.material.constructor.name, /Node/, "expected a node material");
  // Node materials are fogged by scene.fogNode, which skips `fog === false`.
  assert.notEqual((webgpu.material as THREE.Material & { fog?: boolean }).fog, false);
  webgpu.dispose();
});

test("update() hides the wedges behind the camera and shows the ones ahead", () => {
  const scene = new THREE.Scene();
  const far = new FarFieldRenderer(scene, farFieldAsset(), { nodes: null });
  // Azimuth 0 is north = -z; wedge 0 covers [0°, 22.5°), wedge 8 covers [180°, 202.5°).
  const north = frustumLookingAt(new THREE.Vector3(0, 0, -1));
  far.update(north.camera.position, north.frustum);
  assert.equal(far.wedgeVisible(0), true, "the wedge straight ahead must draw");
  assert.equal(far.wedgeVisible(8), false, "the wedge directly behind must not");
  assert.ok(far.visibleWedgeCount < 16, `${far.visibleWedgeCount}/16 wedges drawn — culling did nothing`);

  const south = frustumLookingAt(new THREE.Vector3(0, 0, 1));
  far.update(south.camera.position, south.frustum);
  assert.equal(far.wedgeVisible(8), true);
  assert.equal(far.wedgeVisible(0), false);
  far.dispose();
});

test("update() only toggles visibility — it never rebuilds geometry and allocates nothing", () => {
  const scene = new THREE.Scene();
  const far = new FarFieldRenderer(scene, farFieldAsset(), { nodes: null });
  const meshes: THREE.Mesh[] = [];
  far.group.traverse((o) => { if (o instanceof THREE.Mesh) meshes.push(o); });
  const geometries = meshes.map((m) => m.geometry);
  const bounds = far.wedgeBounds;
  const visibility = far.visibility;

  const view = frustumLookingAt(new THREE.Vector3(0, 0, -1));
  for (let i = 0; i < 50; i += 1) far.update(view.camera.position, view.frustum);

  // Scratch identity is the whole contract: same arrays, same Box3s, same geometries.
  assert.equal(far.wedgeBounds, bounds, "the bounds array was reallocated");
  assert.equal(far.visibility, visibility, "the visibility scratch was reallocated");
  for (let i = 0; i < bounds.length; i += 1) assert.equal(far.wedgeBounds[i], bounds[i], `Box3 ${i} replaced`);
  const after: THREE.Mesh[] = [];
  far.group.traverse((o) => { if (o instanceof THREE.Mesh) after.push(o); });
  assert.deepEqual(after.map((m) => m.geometry), geometries, "update() rebuilt geometry");
  far.dispose();
});

test("far field disposes every geometry and material and leaves the scene clean", () => {
  const scene = new THREE.Scene();
  const before = resourceCounts(scene);
  const far = new FarFieldRenderer(scene, farFieldAsset(), { nodes: null });
  const attached = resourceCounts(scene);
  assert.equal(attached.geometries - before.geometries, 16);
  assert.equal(attached.materials - before.materials, 1, "one shared material across the wedges");

  const disposedGeometries = new Set<THREE.BufferGeometry>();
  far.group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.addEventListener("dispose", () => disposedGeometries.add(o.geometry));
  });
  far.dispose();
  assert.equal(disposedGeometries.size, 16);
  assert.deepEqual(resourceCounts(scene), before, "the far field left resources behind");
  assert.equal(far.group.parent, null);
});

test("the procedural ridge bands stay as the fallback and hide only once a real far field attaches", () => {
  const built = createScene(profile, 16 / 9, null);
  const ridges: THREE.Mesh[] = [];
  built.peaks.traverse((o) => { if (o instanceof THREE.Mesh) ridges.push(o); });
  assert.equal(ridges.length, 2, "the fallback horizon must survive for resorts with no baked asset");
  assert.ok(ridges.every((r) => r.visible), "ridges are visible until a far field replaces them");

  const far = new FarFieldRenderer(built.scene, farFieldAsset(), { nodes: null, fallback: built.peaks });
  assert.equal(built.peaks.visible, false, "the ridge bands must hide behind a real far field");
  far.dispose();
  assert.equal(built.peaks.visible, true, "disposing the far field restores the fallback horizon");
});

test("raising the camera far plane for the far field leaves the shadow cascades untouched", () => {
  // three's CSM expands each cascade by a fade margin of 0.25·z²/(max(camera.far, maxFar) − near),
  // so CAMERA_FAR going 6,000 → 34,000 would have shrunk it 2.60 m → 0.46 m on desktop WebGL,
  // where `fade = !mobile` is on. CsmShadows pins what CSM sees; this asserts the boxes match.
  const boxesFor = (far: number) => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.5, far);
    camera.updateMatrixWorld(true);
    const csm = new CsmShadows(camera, scene, false, profile.weather[0], visualWeatherPreset(0));
    const boxes = csm.cascadeExtents();
    assert.equal(camera.far, far, "the pin must restore the camera's own far plane");
    csm.dispose();
    return boxes;
  };
  const legacy = boxesFor(CSM_FAR_REFERENCE);
  assert.ok(legacy.length === 2, `expected 2 cascades, got ${legacy.length}`);
  assert.deepEqual(boxesFor(CAMERA_FAR), legacy, "the far field changed the shadow cascades");

  // The measurement is live, not vacuous: below the reference the pin is a no-op and the fade
  // margin really does move the boxes, which is exactly the sensitivity being neutralised above.
  const shallow = boxesFor(2000);
  assert.notDeepEqual(shallow, legacy, "cascadeExtents does not respond to camera.far at all");
  const outer = legacy[legacy.length - 1][1] - shallow[shallow.length - 1][1];
  assert.ok(outer < 0, `a nearer far plane should widen the outer cascade's margin, got ${outer}`);
});

test("the far field gets height fog on its real, asynchronous attach path", () => {
  // rendering.test's other fog test drives configureSceneMaterials directly, but in production
  // the far field attaches long AFTER that sweep, and is fogged only by attachFarField's
  // configureMaterial callback. That callback is the thing that stops the seam reading as a
  // colour step, so it is the thing to test.
  for (const backendKind of ["webgl", "webgpu"] as const) {
    const world = createProceduralWorld(profile, profile.seed);
    const state = createSimulation(profile, profile.seed);
    const canvas = {
      clientWidth: 800, clientHeight: 600, addEventListener() {}, removeEventListener() {},
    } as unknown as HTMLCanvasElement;
    const renderer = new GameRenderer(canvas, profile, world, state, {
      backend: new FakeBackend(backendKind), devicePixelRatio: 1, reducedMotion: true,
      nodeFactories: backendKind === "webgpu" ? staticNodeFactories() : null,
    });
    renderer.attachFarField(farFieldAsset());

    const group = renderer.scene.getObjectByName(FAR_FIELD_GROUP_NAME);
    assert.ok(group, `${backendKind}: the far field is not in the scene`);
    const mesh = group.children[0] as THREE.Mesh;
    const material = mesh.material as THREE.Material & { fog?: boolean };

    // Both backends: never opt out, or scene.fogNode / addHeightFog skips it entirely.
    assert.notEqual(material.fog, false, `${backendKind}: far field opted out of fog`);
    assert.notEqual(material.userData.heightFog, false);
    if (backendKind === "webgl") {
      assert.equal(material.userData.heightFogConfigured, true, "WebGL far field never got height fog");
    } else {
      // WebGPU fogs from scene.fogNode; the callback must be a no-op, not a second fog path.
      assert.equal(material.userData.heightFogConfigured, undefined, "WebGPU must not add GLSL fog");
      assert.ok((renderer.scene as THREE.Scene & { fogNode?: unknown }).fogNode, "scene.fogNode missing");
    }
    renderer.dispose();
  }
});

/**
 * Phase 2 task 2: `SkyMesh` (the Preetham physical sky) replaces the procedural gradient on
 * WebGPU once quality clears rung 2 — a full-screen atmospheric shader is too expensive to force
 * on the rungs that exist for weak hardware. WebGL has no WebGPU-only `SkyMesh` import available
 * to it at all (the P11 bundle split forbids it reaching that path), so it keeps the legacy
 * `ShaderMaterial` gradient regardless of rung.
 *
 * The hard constraint: the gradient's `top`/`hor` colours used to double as the only colour input
 * the sky owned, but fog is coloured entirely by `atmosphereUniforms.blue`/`warm`, which come from
 * `VisualWeatherPreset.fogBlue`/`fogWarm` — never from the sky's palette. Swapping the sky
 * implementation must leave those two fog uniforms byte-identical for every resort and weather
 * preset; this test drives `WeatherRenderer.apply` across all of them and diffs the hex values
 * between a rung-4 WebGPU scene (SkyMesh) and the WebGL scene (legacy gradient, the baseline).
 */
test("SkyMesh replaces the gradient at rung 2+ on WebGPU, and never touches the fog colour inputs", () => {
  const NODES = staticNodeFactories();
  const backend = new FakeBackend("webgpu");

  for (const resortProfile of Object.values(DROP_IN_GAME_PROFILES)) {
    // Rungs 0-1 keep the gradient even on WebGPU: SkyMesh is a full-screen shader, not something
    // to force on the rungs that exist for weak hardware.
    for (const rung of [0, 1] as const) {
      const built = createScene(resortProfile, 16 / 9, NODES, rung);
      assert.equal((built.sky as unknown as { isSkyMesh?: boolean }).isSkyMesh, undefined, `rung ${rung}: gradient, not SkyMesh`);
    }

    const legacy = createScene(resortProfile, 16 / 9, null, 4);
    const physical = createScene(resortProfile, 16 / 9, NODES, 2);
    assert.ok(legacy.sky.material instanceof THREE.ShaderMaterial, "WebGL always keeps the legacy gradient");
    assert.equal((physical.sky as unknown as { isSkyMesh?: boolean }).isSkyMesh, true, "rung 2+ WebGPU is SkyMesh");

    const legacyWeather = new WeatherRenderer(resortProfile, legacy, backend);
    const physicalWeather = new WeatherRenderer(resortProfile, physical, backend);
    for (let weatherIndex = 0; weatherIndex < resortProfile.weather.length; weatherIndex += 1) {
      legacyWeather.apply(weatherIndex);
      physicalWeather.apply(weatherIndex);
      assert.equal(
        physical.atmosphereUniforms.blue.value.getHex(), legacy.atmosphereUniforms.blue.value.getHex(),
        `${resortProfile.slug} weather ${weatherIndex}: fog blue diverged`,
      );
      assert.equal(
        physical.atmosphereUniforms.warm.value.getHex(), legacy.atmosphereUniforms.warm.value.getHex(),
        `${resortProfile.slug} weather ${weatherIndex}: fog warm diverged`,
      );
    }
  }
});

/**
 * Fix round 1: a storm rolling in mid-run (WeatherRenderer.apply on player input) used to leave
 * the physical sky frozen at whatever preset built the scene — `SkyMesh` never read the `u*`
 * uniforms `WeatherRenderer` writes, unlike the gradient (both backends) where those uniforms are
 * live references the shader reads every frame. `GameScene.updatePhysicalSky` closes that gap by
 * re-running `applyPhysicalSkyParams` on every weather change; this proves it actually fires and
 * moves `SkyMesh`'s own uniforms, not just `skyUniforms`.
 */
test("cycling weather mid-run re-derives the physical sky's parameters, not just skyUniforms", () => {
  const NODES = staticNodeFactories();
  const backend = new FakeBackend("webgpu");
  const resortProfile = DROP_IN_GAME_PROFILES.breckenridge;
  const physical = createScene(resortProfile, 16 / 9, NODES, 2);
  assert.equal((physical.sky as unknown as { isSkyMesh?: boolean }).isSkyMesh, true);
  assert.equal(typeof physical.updatePhysicalSky, "function", "GameScene exposes the re-derive hook at rung 2+");

  const sky = physical.sky as unknown as {
    turbidity: { value: number }; mieCoefficient: { value: number }; cloudCoverage: { value: number };
  };
  const weather = new WeatherRenderer(resortProfile, physical, backend);

  // Index 0 is the clearest preset (Bluebird), index 2 the harshest (Whiteout/Ground Blizzard) —
  // see VISUAL_WEATHER_PRESETS' cloudiness ladder (0.14 → 0.94) and each profile's haze ladder.
  weather.apply(0);
  const clear = { turbidity: sky.turbidity.value, mie: sky.mieCoefficient.value, cloud: sky.cloudCoverage.value };

  weather.apply(2);
  const stormy = { turbidity: sky.turbidity.value, mie: sky.mieCoefficient.value, cloud: sky.cloudCoverage.value };

  assert.ok(stormy.turbidity > clear.turbidity, `turbidity should rise with haze: ${clear.turbidity} -> ${stormy.turbidity}`);
  assert.ok(stormy.mie > clear.mie, `mieCoefficient should rise with haze: ${clear.mie} -> ${stormy.mie}`);
  assert.ok(stormy.cloud > clear.cloud, `cloudCoverage should rise with cloudiness: ${clear.cloud} -> ${stormy.cloud}`);

  // And back to clear: proves this isn't a one-shot "second preset always wins" artefact.
  weather.apply(0);
  assert.equal(sky.turbidity.value, clear.turbidity, "cycling back to the same preset reproduces the same parameters");
});

test("far field cuts out the exact streamed tile footprint as the skier changes tiles", () => {
  const far = new FarFieldRenderer(new THREE.Scene(), farFieldAsset(), { nodes: staticNodeFactories() });
  const frustum = new THREE.Frustum();
  far.update(new THREE.Vector3(), frustum, { x: 210, z: -10 });
  assert.deepEqual(far.nearBounds.toArray(), [-199, -399, 799, 599]);
  assert.ok((far.material as unknown as { maskNode: unknown }).maskNode);
  far.update(new THREE.Vector3(), frustum, { x: -1, z: 201 });
  assert.deepEqual(far.nearBounds.toArray(), [-599, 1, 399, 999]);
  far.dispose();
});


test("spawn immunity never makes the player's skier disappear", () => {
  const world = createProceduralWorld(DROP_IN_GAME_PROFILES.breckenridge, 42);
  const state = createSimulation(world.profile, world.seed, world.terrain);
  const skier = new SkierRenderer(new THREE.Scene());
  for (const immunity of [1, 0.9, 0.75, 0.4, 0]) {
    state.invuln = immunity; skier.update(state, world.terrain, 1 / 60);
    assert.equal(skier.root.visible, true);
  }
});

 test("textured rock batches stay within the repeated shadow geometry budget", () => {
  const scene = new THREE.Scene();
  const world = createProceduralWorld(profile, profile.seed);
  new WorldRenderer(scene, profile, world);
  const rock = scene.children.find(object => object instanceof THREE.InstancedMesh && object.instanceMatrix.count === 900) as THREE.InstancedMesh;
  assert.ok(rock);
  const triangles = (rock.geometry.index?.count ?? rock.geometry.getAttribute("position").count) / 3;
  assert.ok(triangles <= 56, `rock repeats ${triangles} triangles per colour/shadow pass`);
  assert.ok((rock.material as THREE.MeshStandardMaterial).map, "stone detail remains textured");
  assert.ok(rock.castShadow, "geometry savings retain rock contact shadows");
});


test("empty lift carrier batches skip colour and shadow traversal and restore when active", () => {
  const profile = DROP_IN_GAME_PROFILES.breckenridge;
  const terrain = createProceduralWorld(profile, 12).terrain;
  const points = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 100, z: 200 }];
  const scene = new THREE.Scene();
  const renderer = new LiftRenderer(scene, { ...terrain, realLifts: [{
    kind: "real", name: "Test chair", type: "chair_lift", lengthM: 224, points,
    stations: points.map(point => ({ ...point, radiusM: 7 })),
  }] });
  const mesh = scene.children.find(object => object instanceof THREE.InstancedMesh) as THREE.InstancedMesh;
  assert.ok(mesh); assert.equal(mesh.count, 0); assert.equal(mesh.visible, false);
  const state = createSimulation(profile, 12);
  state.pos.x = 0; state.pos.z = 0;
  renderer.update(state);
  assert.ok(mesh.count > 0); assert.equal(mesh.visible, true); assert.equal(mesh.castShadow, true);
  state.pos.x = 10000; state.pos.z = 10000;
  renderer.update(state);
  assert.equal(mesh.count, 0); assert.equal(mesh.visible, false);
  state.liftIndex = 0; state.liftDistanceM = 50;
  renderer.update(state);
  assert.equal(mesh.count, 1, "occupied carrier remains even beyond proximity culling");
  assert.equal(mesh.visible, true);
  state.liftIndex = -1; state.pos.x = 0; state.pos.z = 0;
  renderer.update(state);
  assert.ok(mesh.count > 0); assert.equal(mesh.visible, true);
  disposeObjectTree(scene);
});
