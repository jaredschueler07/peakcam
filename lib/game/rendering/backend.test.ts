import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBackendKind } from "./backend";

test("defaults to webgpu when available", () => {
  assert.equal(resolveBackendKind("", true), "webgpu");
});

test("falls back to webgl when WebGPU is unavailable", () => {
  assert.equal(resolveBackendKind("", false), "webgl");
});

test("?gfx=webgl forces the fallback even with WebGPU present", () => {
  assert.equal(resolveBackendKind("?gfx=webgl", true), "webgl");
});

test("?gfx=webgpu explicitly requests WebGPU, which is already the default", () => {
  assert.equal(resolveBackendKind("?gfx=webgpu", true), "webgpu");
});

test("?gfx=webgpu without adapter support still resolves webgl", () => {
  assert.equal(resolveBackendKind("?gfx=webgpu", false), "webgl");
});

// Folded in from the retired `resolveBackendOverride`, which treated an unrecognised value as
// "no override" and returned null. There is no legacy path left to fall back to, so anything that
// is not `webgl` simply takes the default.
test("an unrecognised gfx value takes the default rather than a third path", () => {
  assert.equal(resolveBackendKind("?gfx=other", true), "webgpu");
  assert.equal(resolveBackendKind("?gfx=other", false), "webgl");
  assert.equal(resolveBackendKind("?gfx=", true), "webgpu");
});
