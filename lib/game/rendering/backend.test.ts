import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBackendKind, resolveBackendOverride } from "./backend";

test("defaults to webgpu when available", () => {
  assert.equal(resolveBackendKind("", true), "webgpu");
});

test("falls back to webgl when WebGPU is unavailable", () => {
  assert.equal(resolveBackendKind("", false), "webgl");
});

test("?gfx=webgl forces the fallback even with WebGPU present", () => {
  assert.equal(resolveBackendKind("?gfx=webgl", true), "webgl");
});

test("?gfx=webgpu without adapter support still resolves webgl", () => {
  assert.equal(resolveBackendKind("?gfx=webgpu", false), "webgl");
});

test("no gfx override keeps the legacy renderer path", () => {
  assert.equal(resolveBackendOverride("", true), null);
  assert.equal(resolveBackendOverride("?gfx=other", true), null);
});

test("?gfx=webgl explicitly requests the WebGL backend", () => {
  assert.equal(resolveBackendOverride("?gfx=webgl", true), "webgl");
});

test("?gfx=webgpu requests WebGPU when available", () => {
  assert.equal(resolveBackendOverride("?gfx=webgpu", true), "webgpu");
});

test("?gfx=webgpu without navigator.gpu resolves the forced WebGL backend", () => {
  assert.equal(resolveBackendOverride("?gfx=webgpu", false), "webgl");
});
