import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { MeshBasicNodeMaterial, PointsNodeMaterial } from "three/webgpu";
import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import { createSimulation } from "../core/simulation";
import { createProceduralWorld } from "../terrain/obstacles";
import { applyNodeFogOptOuts, GameRenderer, type QualityChangeEvent, type RendererBackend } from "./Renderer";
import { createScene } from "./SceneFactory";
import { CsmShadowsNode } from "./CsmShadowsNode";
import { EffectsRenderer } from "./EffectsRenderer";
import { PARTICLE_CENTRE } from "./ParticleNodeMaterial";
import { staticNodeFactories } from "./nodeFactories.fixture";

// SMAANode decodes its lookup atlases through `new Image()`, which Node lacks. The post chain is
// imported lazily by the renderer, so without this the WebGPU path warns and drops post.
class StubImage { src = ""; onload: (() => void) | null = null; }
(globalThis as { Image?: unknown }).Image ??= StubImage;

const profile = DROP_IN_GAME_PROFILES["ski-portillo"];
/** `loadNodeFactories()` is async and these constructors are not; see `nodeFactories.fixture`. */
const NODES = staticNodeFactories();

class FakeBackend implements RendererBackend {
  compiled = 0;
  rendered = 0;
  readonly renderLists = { dispose: () => {} };
  readonly shadowMap = { enabled: false, type: THREE.PCFShadowMap };
  outputColorSpace = THREE.SRGBColorSpace;
  toneMapping = THREE.NoToneMapping;
  toneMappingExposure = 1;
  pixelRatio = 1;
  constructor(readonly backendKind: "webgpu" | "webgl" = "webgpu") {}
  setPixelRatio(value: number) { this.pixelRatio = value; }
  setSize() {}
  setClearColor() {}
  render() { this.rendered += 1; }
  async compileAsync() { this.compiled += 1; }
  dispose() {}
}

function fakeCanvas() {
  return { clientWidth: 800, clientHeight: 600, addEventListener() {}, removeEventListener() {} } as unknown as HTMLCanvasElement;
}

function buildRenderer(backend: RendererBackend, onQualityChange?: (event: QualityChangeEvent) => void) {
  const world = createProceduralWorld(profile, profile.seed);
  const state = createSimulation(profile, profile.seed);
  const renderer = new GameRenderer(fakeCanvas(), profile, world, state, {
    backend, devicePixelRatio: 1, reducedMotion: true, onQualityChange, nodeFactories: NODES,
  });
  return { renderer, world, state };
}

test("the WebGPU scene is built entirely from node materials and a scene-level fog node", () => {
  const built = createScene(profile, 1.6, NODES);

  assert.ok(built.sky.material instanceof MeshBasicNodeMaterial, "the sky ShaderMaterial is ported");
  assert.equal((built.sky.material as THREE.Material & { fog?: boolean }).fog, false);
  assert.ok((built.scene as THREE.Scene & { fogNode?: unknown }).fogNode, "height fog is installed on the scene");

  // The fog uniforms must carry this preset's density, not the module's placeholder default.
  assert.equal(built.atmosphereUniforms.density.value, profile.weather[0].fog);
  assert.equal(built.atmosphereUniforms.heightFalloff.value, 0.025);
  assert.equal(built.snowUniforms.horizon.value.getHex(), profile.weather[0].hor);
});

test("the WebGL scene is untouched by the port", () => {
  const built = createScene(profile, 1.6, null);
  assert.ok(built.sky.material instanceof THREE.ShaderMaterial);
  assert.equal((built.scene as THREE.Scene & { fogNode?: unknown }).fogNode, undefined);
  assert.ok(built.scene.fog instanceof THREE.FogExp2, "the WebGL path keeps its FogExp2");
});

test("both backends expose the same uniform shape, so the per-frame writes need no branch", () => {
  for (const kind of ["webgl", "webgpu"] as const) {
    const built = createScene(profile, 1.6, kind === "webgpu" ? NODES : null);
    built.snowUniforms.glint.value = 0.5;
    built.snowUniforms.track.value.set(1, 2, 3, 4);
    built.snowUniforms.horizon.value.setHex(0x123456);
    built.atmosphereUniforms.referenceHeight.value = 812;
    built.skyUniforms.uTime.value += 0.25;
    built.skyUniforms.uCloudiness.value = 0.9;
    assert.equal(built.snowUniforms.glint.value, 0.5, `${kind} glint`);
    assert.deepEqual(built.snowUniforms.track.value.toArray(), [1, 2, 3, 4], `${kind} track`);
    assert.equal(built.snowUniforms.horizon.value.getHex(), 0x123456, `${kind} horizon`);
    assert.equal(built.atmosphereUniforms.referenceHeight.value, 812, `${kind} reference height`);
    assert.equal(built.skyUniforms.uTime.value, 0.25, `${kind} sky time`);
    assert.equal(built.skyUniforms.uCloudiness.value, 0.9, `${kind} cloudiness`);
  }
});

test("the height-fog opt-out survives the move to scene-level fog", () => {
  const scene = new THREE.Scene();
  const skier = new THREE.MeshStandardMaterial();
  skier.userData.heightFog = false;
  const terrain = new THREE.MeshStandardMaterial();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), skier), new THREE.Mesh(new THREE.PlaneGeometry(), terrain));

  const opted = applyNodeFogOptOuts(scene);

  assert.deepEqual(opted, [skier], "only the flagged material opts out");
  assert.equal(skier.fog, false, "scene.fogNode skips it now that material.fog is false");
  assert.equal(terrain.fog, true, "everything else still fogs");
});

test("the renderer wires the ghost and skier out of the scene fog on the node path", () => {
  const { renderer } = buildRenderer(new FakeBackend("webgpu"));
  const scene = (renderer as unknown as { built: { scene: THREE.Scene } }).built.scene;
  let checked = 0;
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    const list = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of list) {
      if (material.userData.heightFog !== false) continue;
      checked += 1;
      assert.equal((material as THREE.Material & { fog?: boolean }).fog, false);
    }
  });
  assert.ok(checked > 0, "the skier and ghost materials are present and opted out");
  renderer.dispose();
});

test("the WebGPU renderer builds the node terrain and cascaded shadows", () => {
  const { renderer } = buildRenderer(new FakeBackend("webgpu"));
  const internals = renderer as unknown as { csm: unknown };
  assert.ok(internals.csm instanceof CsmShadowsNode, "shadows come from CSMShadowNode");
  renderer.dispose();
});

test("particles are instanced quads on WebGPU, because point-list cannot size a point", () => {
  const { renderer } = buildRenderer(new FakeBackend("webgpu"));
  const scene = (renderer as unknown as { built: { scene: THREE.Scene } }).built.scene;

  const clouds: THREE.Mesh[] = [];
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.material instanceof PointsNodeMaterial) clouds.push(mesh);
  });

  assert.equal(clouds.length, 2, "spray and snowfall");
  for (const cloud of clouds) {
    assert.equal((cloud as unknown as { isPoints?: boolean }).isPoints, undefined,
      "a THREE.Points would take the point-list path and rasterise one pixel per particle");
    const geometry = cloud.geometry as THREE.InstancedBufferGeometry;
    assert.equal(geometry.isInstancedBufferGeometry, true);
    // positionGeometry.xy is the quad corner, so the particle centre needs its own attribute.
    assert.ok(geometry.getAttribute(PARTICLE_CENTRE), "the centre rides on an instanced attribute");
    assert.ok(geometry.getAttribute("uv"), "and the quad carries the UVs the sprite samples");
    assert.equal(geometry.getAttribute("position").count, 6, "two triangles");
  }
  renderer.dispose();
});

test("the WebGL path keeps its THREE.Points clouds", () => {
  const { renderer } = buildRenderer(new FakeBackend("webgl"));
  const scene = (renderer as unknown as { built: { scene: THREE.Scene } }).built.scene;
  let points = 0;
  scene.traverse((object) => { if ((object as THREE.Points).isPoints) points += 1; });
  assert.equal(points, 2, "gl_PointSize still works there");
  renderer.dispose();
});

test("the instanced props carry vertex colours identically on both backends", () => {
  // Trees rendered white on WebGPU. NodeMaterial only multiplies in vertexColor() when
  // `material.vertexColors === true` AND `geometry.hasAttribute("color")` — otherwise
  // VertexColorNode falls back to white, which is exactly the symptom. Pin both here so the JS
  // side is ruled in or out without a GPU.
  for (const kind of ["webgl", "webgpu"] as const) {
    const { renderer } = buildRenderer(new FakeBackend(kind));
    const scene = (renderer as unknown as { built: { scene: THREE.Scene } }).built.scene;
    let instanced = 0;
    scene.traverse((object) => {
      const mesh = object as THREE.InstancedMesh;
      if (!mesh.isInstancedMesh) return;
      instanced += 1;
      const material = mesh.material as THREE.Material & { vertexColors?: boolean };
      assert.equal(material.vertexColors, true, `${kind}: instanced prop keeps vertexColors`);
      assert.ok(mesh.geometry.getAttribute("color"), `${kind}: and its geometry carries the colours`);
    });
    assert.ok(instanced >= 3, "trees, rocks and markers are instanced");
    renderer.dispose();
  }
});

test("pre-warm compiles the seeded rung and the top rung, then restores the rung", async () => {
  const backend = new FakeBackend("webgpu");
  const { renderer } = buildRenderer(backend);
  const quality = (renderer as unknown as { quality: { rung: number } }).quality;
  const seeded = quality.rung;

  await renderer.prewarm();

  assert.equal(backend.compiled, seeded === 4 ? 1 : 2, "one compile per distinct rung");
  assert.equal(quality.rung, seeded, "the seeded rung is restored");
  renderer.dispose();
});

test("a compile that never settles costs a stutter, not the loading screen", async () => {
  const backend = Object.assign(new FakeBackend("webgpu"), {
    compileAsync: () => new Promise<void>(() => {}),
  });
  const world = createProceduralWorld(profile, profile.seed);
  const state = createSimulation(profile, profile.seed);
  const renderer = new GameRenderer(fakeCanvas(), profile, world, state, {
    backend, devicePixelRatio: 1, reducedMotion: true, prewarmTimeoutMs: 10, nodeFactories: NODES,
  });
  const quality = (renderer as unknown as { quality: { rung: number } }).quality;
  quality.rung = 2;

  await renderer.prewarm();

  assert.equal(quality.rung, 2, "and the budget expiring mid-sequence does not strand it on rung 4");
  renderer.dispose();
});

test("pre-warm is safe on a backend without compileAsync", async () => {
  const complete: Record<string, unknown> = { ...new FakeBackend("webgl") };
  delete complete.compileAsync;
  const withoutCompile = complete;
  const backend = Object.assign(Object.create(null), withoutCompile, {
    setPixelRatio() {}, setSize() {}, setClearColor() {}, render() {}, dispose() {},
  }) as RendererBackend;
  assert.equal(backend.compileAsync, undefined);
  const { renderer } = buildRenderer(backend);
  await renderer.prewarm();
  renderer.dispose();
});

test("the governor drives the adapt tick and reports the rung it came from", () => {
  const events: QualityChangeEvent[] = [];
  const { renderer, world, state } = buildRenderer(new FakeBackend("webgpu"), (event) => events.push(event));
  const quality = (renderer as unknown as { quality: { rung: number } }).quality;
  quality.rung = 4;

  // Ten seconds of 40ms frames: over the desktop budget, past the 5s dwell, and short of the
  // 5s spacing that would allow a second step.
  for (let i = 0; i < 250; i += 1) renderer.render(state, world, 0.04, 0, 40);

  assert.equal(quality.rung, 3, "one rung, not a cascade of them");
  assert.deepEqual(events, [{ reason: "governor", from: 4, to: 3 }]);
  renderer.dispose();
});

test("a healthy 60Hz display never loses quality to the governor", () => {
  const events: QualityChangeEvent[] = [];
  const { renderer, world, state } = buildRenderer(new FakeBackend("webgpu"), (event) => events.push(event));
  const quality = (renderer as unknown as { quality: { rung: number } }).quality;
  quality.rung = 4;

  // A vsync-locked 60Hz display, with the jitter a real browser produces. Under a 58fps budget
  // this walked all the way to rung 0, taking the LUT, bloom and vignette with it.
  for (let i = 0; i < 1500; i += 1) renderer.render(state, world, 1 / 60, 0, i % 3 === 0 ? 17.6 : 16.5);

  assert.equal(quality.rung, 4, "60fps is not distress");
  assert.deepEqual(events, []);
  renderer.dispose();
});

test("the governor keeps hearing after the perf buffer stops recording", () => {
  // frameTimes caps at 36,000 entries (~10 min at 60fps). A window read from its tail would freeze
  // on ten-minute-old frames — deaf exactly when a device starts to throttle.
  const { renderer, world, state } = buildRenderer(new FakeBackend("webgpu"));
  const internals = renderer as unknown as { frameTimes: number[]; windowedP75(): number };

  for (let i = 0; i < 36_050; i += 1) renderer.render(state, world, 1 / 60, 0, 40);
  assert.equal(internals.frameTimes.length, 36_000, "the perf array is full and no longer growing");
  assert.equal(Math.round(internals.windowedP75()), 40);

  // Everything after this point is invisible to frameTimes, and must not be to the governor.
  for (let i = 0; i < 120; i += 1) renderer.render(state, world, 1 / 60, 0, 8);
  assert.equal(Math.round(internals.windowedP75()), 8, "the window tracks the newest samples");
  assert.equal(internals.frameTimes[internals.frameTimes.length - 1], 40, "…which frameTimes never saw");
  renderer.dispose();
});

test("a brief spike does not cost a rung", () => {
  const events: QualityChangeEvent[] = [];
  const { renderer, world, state } = buildRenderer(new FakeBackend("webgpu"), (event) => events.push(event));
  const quality = (renderer as unknown as { quality: { rung: number } }).quality;
  quality.rung = 4;

  for (let i = 0; i < 75; i += 1) renderer.render(state, world, 0.04, 0, i < 25 ? 40 : 8);

  assert.equal(quality.rung, 4);
  assert.deepEqual(events, []);
  renderer.dispose();
});

test("the top rung spends its headroom on glint and denser snow only on the node path", () => {
  for (const kind of ["webgpu", "webgl"] as const) {
    const { renderer } = buildRenderer(new FakeBackend(kind));
    const internals = renderer as unknown as {
      quality: { rung: number };
      built: { snowUniforms: { glint: { value: number } } };
      applyQuality(rung: number): void;
      effects: EffectsRenderer;
    };

    internals.applyQuality(4);
    const glintAtTop = internals.built.snowUniforms.glint.value;
    const densityAtTop = internals.effects.densityScale();
    internals.applyQuality(3);

    if (kind === "webgpu") {
      assert.ok(glintAtTop > 0, "WebGPU rung 4 turns the glint on");
      assert.equal(densityAtTop, 1.25, "and thickens the snowfall");
    } else {
      assert.equal(glintAtTop, 0, "WebGL rung 4 stays on the cheaper frame");
      assert.equal(densityAtTop, 1);
    }
    assert.equal(internals.built.snowUniforms.glint.value, 0, "and every lower rung is dark");
    renderer.dispose();
  }
});

test("a lost WebGPU device stops the render loop the way a lost WebGL context does", async () => {
  let loseDevice: (info: { reason: string }) => void = () => {};
  const backend = Object.assign(new FakeBackend("webgpu"), {
    backend: { device: { lost: new Promise<{ reason: string }>((resolve) => { loseDevice = resolve; }) } },
  });
  const { renderer, world, state } = buildRenderer(backend);

  renderer.render(state, world, 1 / 60, 0);
  const before = backend.rendered;
  assert.ok(before > 0, "rendering before the loss");

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    loseDevice({ reason: "destroyed" });
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    console.warn = originalWarn;
  }

  renderer.render(state, world, 1 / 60, 0);
  assert.equal(backend.rendered, before, "no frames are drawn into a dead device");
  renderer.dispose();
});
