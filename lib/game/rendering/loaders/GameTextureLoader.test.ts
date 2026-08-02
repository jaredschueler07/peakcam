import assert from "node:assert/strict";
import test from "node:test";
import type { RendererBackend } from "../Renderer";
import { createGameTextureLoader, resolveTranscoderPath } from "./GameTextureLoader";

test("texture loader resolves the public Basis transcoder directory", () => {
  assert.equal(resolveTranscoderPath(), "/game/basis/");
});

test("texture loader rejects a missing renderer before GPU support detection", () => {
  assert.throws(
    () => createGameTextureLoader(undefined as unknown as RendererBackend),
    /renderer is required/i,
  );
});
