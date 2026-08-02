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

test("?gfx=webgpu without adapter support still resolves webgl", () => {
  assert.equal(resolveBackendKind("?gfx=webgpu", false), "webgl");
});
