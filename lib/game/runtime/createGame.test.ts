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
import { loadTerrainForRuntime, selectRendererBackend } from "./createGame";
import { warmUpAndStart } from "./GameRuntime";
import type { createRendererBackend } from "../rendering/backend";
import { attachFarFieldWhenReady, attachSurfaceTexturesWhenReady, type CreateGameOptions } from "./createGame";
import { RESORT_BAKE_CONFIGS } from "../terrain/resorts";
import type { DecodedFarField } from "../terrain/far-field-format";
import type { RendererBackend } from "../rendering/Renderer";
import type { SurfaceTextures } from "../rendering/surfaceTextures";

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
      controlActivated() {}, pointerLock() {}, terrainFallback: (name) => failures.push(name), performance() {},
    }, { load: async () => { throw new TypeError("offline"); } });
    assert.equal(source.kind, "procedural");
    assert.deepEqual(failures, ["TypeError"]);
  } finally {
    console.warn = originalWarn;
  }
});

test("the loaded scene streams the sourced hotel while retaining far-field lake support", async () => {
  const profile = DROP_IN_GAME_PROFILES["ski-portillo"];
  const bridge = new UiBridge(profile);
  const source = await loadTerrainForRuntime(profile, bridge, {
    controlActivated() {}, pointerLock() {}, terrainFallback() {}, performance() {},
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
  assert.ok(hotel instanceof THREE.Group);
  assert.ok(lake instanceof THREE.Mesh && lake.geometry instanceof THREE.ShapeGeometry);
  assert.ok(Math.abs(hotel.position.y - source.sampler.height(hotel.position.x, hotel.position.z)) <= 0.5);
  assert.ok(hotel.userData.terrainFootprint.halfX * 2 <= 110, "hotel bounds follow the sourced footprint");
  assert.equal(hotel.visible, false, "hotel must hide while its supporting terrain tile is absent");
  assert.equal(lake.userData.farFieldSupported, true);
  assert.equal(lake.visible, true, "lake remains supported by the baked far field beyond streamed tiles");

  state.pos.x = hotel.position.x;
  state.pos.z = hotel.position.z;
  renderer.update(state, 0);
  assert.equal(hotel.visible, true, "grounded hotel appears once its terrain is in the streaming window");
});

test("the renderer backend defaults to WebGPU and falls back to the legacy WebGL path", async () => {
  const canvas = {} as HTMLCanvasElement;
  const created: string[] = [];
  const create = async (_canvas: HTMLCanvasElement, kind: "webgpu" | "webgl") => {
    created.push(kind);
    return { backendKind: kind } as unknown as Awaited<ReturnType<typeof createRendererBackend>>;
  };

  // No override: WebGPU wherever the browser has it...
  assert.equal((await selectRendererBackend(canvas, "", true, create))?.backendKind, "webgpu");
  // ...and `undefined` otherwise, which is what makes GameRenderer build its own WebGLRenderer.
  assert.equal(await selectRendererBackend(canvas, "", false, create), undefined);

  // ?gfx=webgl pins the legacy path even on a WebGPU browser.
  assert.equal(await selectRendererBackend(canvas, "?gfx=webgl", true, create), undefined);
  // ?gfx=webgpu asks for WebGPU, and cannot conjure it where the browser has none.
  assert.equal((await selectRendererBackend(canvas, "?gfx=webgpu", true, create))?.backendKind, "webgpu");
  assert.equal(await selectRendererBackend(canvas, "?gfx=webgpu", false, create), undefined);

  assert.deepEqual(created, ["webgpu", "webgpu"], "the WebGL rows never build a backend at all");
});

test("a WebGPU backend that fails to initialise falls back instead of failing the run", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const backend = await selectRendererBackend({} as HTMLCanvasElement, "", true, async () => {
      throw new Error("no adapter");
    });
    assert.equal(backend, undefined, "the run continues on WebGL");
  } finally {
    console.warn = originalWarn;
  }
});

test("the loading bar holds at 95% until the shaders are warm, then the loop starts", async () => {
  const progress: number[] = [];
  const order: string[] = [];
  let releasePrewarm: () => void = () => {};
  const prewarmed = new Promise<void>((resolve) => { releasePrewarm = resolve; });

  const running = warmUpAndStart(
    { setLoadingProgress: (value) => progress.push(value) },
    { prewarm: async () => { order.push("prewarm"); await prewarmed; } },
    () => order.push("start"),
  );

  assert.deepEqual(progress, [0.95], "the bar parks at 95% while compiling");
  assert.deepEqual(order, ["prewarm"], "and the loop has not started yet");

  releasePrewarm();
  await running;

  assert.deepEqual(progress, [0.95, 1]);
  assert.deepEqual(order, ["prewarm", "start"], "the first frame comes after the compile");
});

test("a pre-warm failure still starts the run", async () => {
  const progress: number[] = [];
  const originalWarn = console.warn;
  console.warn = () => {};
  let started = false;
  try {
    await warmUpAndStart(
      { setLoadingProgress: (value) => progress.push(value) },
      { prewarm: async () => { throw new Error("device lost during compile"); } },
      () => { started = true; },
    );
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(started, true, "nobody is stranded on the loading screen");
  assert.deepEqual(progress, [0.95, 1]);
});

// ─── Far field ───────────────────────────────────────────────

const farFieldProfile = { slug: "ski-portillo" } as CreateGameOptions["profile"];

test("the far field attaches when it loads", async () => {
  const asset = { meta: {}, wedges: [] } as unknown as DecodedFarField;
  const attached: unknown[] = [];
  const seen: Array<{ centre: [number, number]; radiusM: number }> = [];
  await attachFarFieldWhenReady(
    { attachFarField: (a) => attached.push(a) },
    { profile: farFieldProfile },
    { load: async (_slug, o) => { seen.push(o.expect); return asset; } },
  );
  assert.deepEqual(attached, [asset]);
  // The asset is validated against the resort it claims, so it cannot render Heavenly at Portillo.
  assert.equal(seen[0].radiusM, 30_000);
  assert.deepEqual(seen[0].centre, RESORT_BAKE_CONFIGS["ski-portillo"].center);
});

test("a far field that fails to load leaves the run untouched", async () => {
  let attachedCount = 0;
  // null (missing/corrupt/wrong resort) and a rejection are both survivable.
  await attachFarFieldWhenReady(
    { attachFarField: () => { attachedCount += 1; } },
    { profile: farFieldProfile },
    { load: async () => null },
  );
  await attachFarFieldWhenReady(
    { attachFarField: () => { attachedCount += 1; } },
    { profile: farFieldProfile },
    { load: async () => { throw new Error("network down"); } },
  );
  assert.equal(attachedCount, 0, "nothing should attach, and nothing should throw");
});

test("a resort with no bake config never asks for a far field", async () => {
  let requested = 0;
  await attachFarFieldWhenReady(
    { attachFarField: () => assert.fail("must not attach") },
    { profile: { slug: "not-a-pilot-resort" } as unknown as CreateGameOptions["profile"] },
    { load: async () => { requested += 1; return null; } },
  );
  assert.equal(requested, 0);
});

// ─── Surface textures ───────────────────────────────────────────────

const webgpuBackend = { backendKind: "webgpu" } as RendererBackend;
const webglBackend = { backendKind: "webgl" } as RendererBackend;

function fakeSurfaces(): SurfaceTextures {
  return { snowNormal: {} as SurfaceTextures["snowNormal"], snowRoughness: {} as SurfaceTextures["snowRoughness"] };
}

test("real surface textures attach on WebGPU once the rung is high enough", async () => {
  const attached: unknown[] = [];
  const asset = fakeSurfaces();
  const seenBackends: RendererBackend[] = [];
  await attachSurfaceTexturesWhenReady(
    { attachSurfaceTextures: (s) => attached.push(s), rung: 3 },
    webgpuBackend,
    async (backend) => { seenBackends.push(backend); return asset; },
  );
  assert.deepEqual(attached, [asset]);
  assert.deepEqual(seenBackends, [webgpuBackend]);
});

test("surface textures never load on the WebGL path", async () => {
  let requested = 0;
  await attachSurfaceTexturesWhenReady(
    { attachSurfaceTextures: () => assert.fail("must not attach"), rung: 4 },
    webglBackend,
    async () => { requested += 1; return fakeSurfaces(); },
  );
  assert.equal(requested, 0);
});

test("surface textures never load below rung 3, so a low-end device never spends the bandwidth", async () => {
  let requested = 0;
  await attachSurfaceTexturesWhenReady(
    { attachSurfaceTextures: () => assert.fail("must not attach"), rung: 2 },
    webgpuBackend,
    async () => { requested += 1; return fakeSurfaces(); },
  );
  assert.equal(requested, 0);
});

test("a missing WebGPU backend never attempts the load", async () => {
  let requested = 0;
  await attachSurfaceTexturesWhenReady(
    { attachSurfaceTextures: () => assert.fail("must not attach"), rung: 4 },
    undefined,
    async () => { requested += 1; return fakeSurfaces(); },
  );
  assert.equal(requested, 0);
});

test("missing or failed surface textures leave the run untouched", async () => {
  let attachedCount = 0;
  await attachSurfaceTexturesWhenReady(
    { attachSurfaceTextures: () => { attachedCount += 1; }, rung: 3 },
    webgpuBackend,
    async () => null,
  );
  await attachSurfaceTexturesWhenReady(
    { attachSurfaceTextures: () => { attachedCount += 1; }, rung: 3 },
    webgpuBackend,
    async () => { throw new Error("KTX2 decode failed"); },
  );
  assert.equal(attachedCount, 0, "nothing should attach, and nothing should throw");
});
