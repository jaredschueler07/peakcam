import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import type { Node } from "three/webgpu";
import { createSkyNodeMaterial, createSkyNodeUniforms } from "./SkyNodeMaterial";
import { SUN_DIRECTION } from "./SceneFactory";

type Traversable = { getChildren?: () => Iterable<Traversable> };

function collectNodes(root: Node | Traversable | null): Set<unknown> {
  const seen = new Set<unknown>();
  const walk = (node: Traversable | null) => {
    if (!node || seen.has(node) || typeof node.getChildren !== "function") return;
    seen.add(node);
    for (const child of node.getChildren()) walk(child);
  };
  walk(root as Traversable | null);
  return seen;
}

function build() {
  return createSkyNodeUniforms({
    top: new THREE.Color(0x2a5f9e), mid: new THREE.Color(0x79afe4), horizon: new THREE.Color(0xd9e8f5),
    cloud: new THREE.Color(0xfaf4e6), cloudiness: 0.14, sun: new THREE.Color(0xfff3d4),
    sunDir: SUN_DIRECTION.clone(), haze: 0.2,
  });
}

test("the sky uniforms keep the GLSL key names WeatherRenderer writes by hand", () => {
  const uniforms = build();
  // WeatherRenderer.ts mutates these exact keys; renaming any of them silently stops the weather cycle.
  for (const key of ["uTop", "uMid", "uHorizon", "uCloud", "uCloudiness", "uTime", "uSun", "uSunDir", "uHaze"] as const) {
    assert.ok(key in uniforms, `${key} is present`);
  }
  assert.equal(uniforms.uTop.value.getHex(), 0x2a5f9e);
  assert.equal(uniforms.uCloudiness.value, 0.14);
  assert.equal(uniforms.uHaze.value, 0.2);
  assert.equal(uniforms.uTime.value, 0);
  assert.ok(uniforms.uSunDir.value.distanceTo(SUN_DIRECTION) < 1e-12);
});

test("the per-frame and per-weather writes round-trip through .value", () => {
  const uniforms = build();
  uniforms.uTop.value.setHex(0x112233);
  assert.equal(uniforms.uTop.value.getHex(), 0x112233, "WeatherRenderer mutates the Color in place");
  uniforms.uCloudiness.value = 0.8;
  assert.equal(uniforms.uCloudiness.value, 0.8);
  uniforms.uTime.value += 0.5;
  uniforms.uTime.value += 0.25;
  assert.equal(uniforms.uTime.value, 0.75, "Renderer accumulates uTime every frame");
});

test("the sky material draws the gradient itself, unlit and unfogged", () => {
  const material = createSkyNodeMaterial(build());
  assert.equal(material.isNodeMaterial, true);
  assert.ok(material.colorNode, "the gradient is installed as the colour");
  assert.equal(material.side, THREE.BackSide, "seen from inside the dome");
  assert.equal(material.depthWrite, false);
  assert.equal(material.fog, false, "the scene fogNode must not touch the sky");
});

test("every sky uniform is reachable from the colour graph", () => {
  const uniforms = build();
  const material = createSkyNodeMaterial(uniforms);
  const reached = collectNodes(material.colorNode);
  for (const [name, node] of Object.entries(uniforms)) {
    assert.ok(reached.has(node), `the ${name} uniform feeds the sky graph`);
  }
  const stranger = build();
  assert.equal(reached.has(stranger.uHaze), false, "and the traversal only reaches what is wired in");
});
