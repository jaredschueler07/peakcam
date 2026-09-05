import assert from "node:assert/strict";
import test from "node:test";
import { warmPosterModules } from "./poster-module-warmup";

function deferred() { let resolve!: (value?: unknown) => void; const promise = new Promise<unknown>(done => { resolve = done; }); return { promise, resolve }; }

test("poster starts both supported module downloads without creating GPU or runtime", async () => {
  const runtime = deferred(), backend = deferred(), calls: string[] = [];
  let created = 0;
  const warmed = warmPosterModules("", true, undefined, {
    runtime: () => { calls.push("runtime"); return runtime.promise; },
    webgpu: () => { calls.push("webgpu"); return backend.promise; },
  });
  await Promise.resolve(); assert.deepEqual(calls, ["runtime", "webgpu"]);
  runtime.resolve({ createGame() { created++; } });
  backend.resolve({ WebGPURenderer: class { constructor() { created++; } init() { created++; } } });
  await warmed; assert.equal(created, 0, "module exports must never be invoked during preload");
});

test("explicit WebGL and unsupported devices never download WebGPU", async () => {
  for (const [search, supported] of [["?gfx=webgl", true], ["", false], ["?gfx=webgpu", false]] as const) {
    const calls: string[] = [];
    await warmPosterModules(search, supported, undefined, { runtime: async () => { calls.push("runtime"); }, webgpu: async () => { calls.push("gpu"); } });
    assert.deepEqual(calls, ["runtime"]);
  }
});

test("unmounted posters start no pending imports and late import failures are handled", async () => {
  const controller = new AbortController(); let calls = 0;
  const pending = warmPosterModules("", true, controller.signal, { runtime: async () => { calls++; }, webgpu: async () => { calls++; } });
  controller.abort(); await pending; assert.equal(calls, 0);
  await warmPosterModules("", true, controller.signal, { runtime: async () => { calls++; }, webgpu: async () => { calls++; } });
  assert.equal(calls, 0);
  const late = deferred(), during = new AbortController();
  const warmed = warmPosterModules("", true, during.signal, { runtime: () => late.promise.then(() => { throw new Error("chunk failure after unmount"); }), webgpu: async () => { throw new Error("GPU module unavailable"); } });
  await Promise.resolve(); during.abort(); late.resolve(); await assert.doesNotReject(warmed);
});
