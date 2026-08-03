import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import type { GameTextureLoader } from "./loaders/GameTextureLoader";
import { loadSurfaceTextures } from "./surfaceTextures";

test("surface textures load from the pinned KTX2 URLs and are configured for triplanar repetition", async () => {
  const normal = new THREE.Texture();
  const roughness = new THREE.Texture();
  const urls: string[] = [];
  const loader: GameTextureLoader = {
    async load(url) {
      urls.push(url);
      return url.includes("normal") ? normal : roughness;
    },
    dispose() {},
  };

  const loaded = await loadSurfaceTextures(loader);

  assert.deepEqual(urls, ["/game/textures/snow-normal.ktx2", "/game/textures/snow-roughness.ktx2"]);
  assert.deepEqual(loaded, { snowNormal: normal, snowRoughness: roughness });
  for (const texture of [normal, roughness]) {
    assert.equal(texture.wrapS, THREE.RepeatWrapping);
    assert.equal(texture.wrapT, THREE.RepeatWrapping);
    assert.equal(texture.colorSpace, THREE.NoColorSpace);
  }
});

test("a missing surface texture returns null instead of breaking the run", async () => {
  const loader: GameTextureLoader = {
    async load() {
      throw new Error("404 missing");
    },
    dispose() {},
  };

  await assert.doesNotReject(async () => {
    assert.equal(await loadSurfaceTextures(loader), null);
  });
});

test("a normal map loaded before a roughness failure is disposed", async () => {
  const normal = new THREE.Texture();
  let disposed = false;
  normal.addEventListener("dispose", () => { disposed = true; });
  let calls = 0;
  const loader: GameTextureLoader = {
    async load() {
      calls += 1;
      if (calls === 1) return normal;
      throw new Error("roughness missing");
    },
    dispose() {},
  };

  assert.equal(await loadSurfaceTextures(loader), null);
  assert.equal(disposed, true, "the successful half of a failed pair must not leak GPU memory");
});
