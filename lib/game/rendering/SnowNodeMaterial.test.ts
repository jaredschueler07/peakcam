import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import type { Node } from "three/webgpu";
import { vec3 } from "three/tsl";
import { buildSnowDetailNormal } from "./SnowMaterial";
import { createSnowNodeMaterial, createSnowNodeUniforms } from "./SnowNodeMaterial";
import type { SurfaceTextures } from "./surfaceTextures";

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

test("snow node uniforms expose .value so the per-frame writes in Renderer keep working", () => {
  const uniforms = createSnowNodeUniforms();
  assert.ok(uniforms.horizon.value instanceof THREE.Color, "horizon carries a Color");
  assert.ok(uniforms.track.value instanceof THREE.Vector4, "track carries a Vector4");
  assert.equal(typeof uniforms.glint.value, "number");

  uniforms.glint.value = 0.5;
  assert.equal(uniforms.glint.value, 0.5, "scalar uniforms round-trip");
  uniforms.horizon.value.setHex(0x123456);
  assert.equal(uniforms.horizon.value.getHex(), 0x123456, "WeatherRenderer mutates the Color in place");
  uniforms.track.value.set(1, 2, 3, 4);
  assert.deepEqual(uniforms.track.value.toArray(), [1, 2, 3, 4], "Renderer mutates the Vector4 in place");
});

test("createSnowNodeUniforms seeds the same defaults SceneFactory used for the GLSL material", () => {
  const uniforms = createSnowNodeUniforms(new THREE.Color(0x8899aa), 0.25);
  assert.equal(uniforms.horizon.value.getHex(), 0x8899aa);
  assert.equal(uniforms.glint.value, 0.25);
  assert.deepEqual(uniforms.track.value.toArray(), [1e6, 1e6, 1e6, 1e6], "the track starts far off-course");
});

test("snow node material carries poster uniforms and triplanar detail", () => {
  const uniforms = createSnowNodeUniforms();
  const detail = buildSnowDetailNormal(7);
  const material = createSnowNodeMaterial(detail, uniforms, 0, null, 2);

  assert.equal(material.isNodeMaterial, true);
  assert.ok(material instanceof MeshStandardNodeMaterial, "Task 6 can drop it in where MeshStandardMaterial was");
  assert.ok(material.normalNode, "must install the triplanar detail normal graph");
  assert.notEqual(
    Object.getPrototypeOf(material).setupOutput,
    MeshStandardNodeMaterial.prototype.setupOutput,
    "must install the wrap/rim/glint/track shading pass ahead of fog",
  );
  assert.ok(material.userData.snowOutputNode, "the shading node is reachable for inspection");
});

test("the node graphs reach the detail texture and every snow uniform", () => {
  const uniforms = createSnowNodeUniforms();
  const detail = buildSnowDetailNormal(5);
  const material = createSnowNodeMaterial(detail, uniforms, 0, null, 2);

  const normalNodes = collectNodes(material.normalNode);
  const sampled = [...normalNodes].filter((node) => (node as { value?: unknown }).value === detail);
  assert.equal(sampled.length, 6, "three triplanar axes at each of the two detail scales");

  const shadeNodes = collectNodes(material.userData.snowOutputNode(vec3(0, 0, 0)));
  for (const [name, node] of Object.entries(uniforms)) {
    assert.ok(shadeNodes.has(node), `the ${name} uniform feeds the shading graph`);
  }
});

test("snow node material matches the TerrainRenderer surface settings", () => {
  const material = createSnowNodeMaterial(buildSnowDetailNormal(3), createSnowNodeUniforms());
  assert.equal(material.roughness, 0.86);
  assert.equal(material.metalness, 0.02);
  assert.equal(material.vertexColors, true);
  assert.equal(material.flatShading, false);
  assert.equal(material.dithering, true);
});

test("the detail texture is bound to the material so disposal can find it", () => {
  const detail = buildSnowDetailNormal(11);
  const material = createSnowNodeMaterial(detail, createSnowNodeUniforms());
  assert.equal(material.userData.snowDetail, detail);
  material.dispose();
  detail.dispose();
});

test("real snow maps replace the procedural detail only at rung 3 and above", () => {
  const procedural = buildSnowDetailNormal(17);
  const surfaces: SurfaceTextures = {
    snowNormal: new THREE.Texture(),
    snowRoughness: new THREE.Texture(),
  };

  for (const rung of [0, 1, 2] as const) {
    const material = createSnowNodeMaterial(procedural, createSnowNodeUniforms(), 0, surfaces, rung);
    const normalNodes = collectNodes(material.normalNode);
    assert.equal([...normalNodes].filter((node) => (node as { value?: unknown }).value === procedural).length, rung < 2 ? 0 : 6);
    assert.equal([...normalNodes].some((node) => (node as { value?: unknown }).value === surfaces.snowNormal), false);
    assert.equal(material.roughnessNode, null, `rung ${rung} keeps today's scalar roughness`);
  }

  for (const rung of [3, 4] as const) {
    const material = createSnowNodeMaterial(procedural, createSnowNodeUniforms(), 0, surfaces, rung);
    const normalNodes = collectNodes(material.normalNode);
    assert.equal([...normalNodes].filter((node) => (node as { value?: unknown }).value === surfaces.snowNormal).length, 6);
    assert.equal([...normalNodes].some((node) => (node as { value?: unknown }).value === procedural), false);
    const roughnessNodes = collectNodes(material.roughnessNode);
    assert.equal(
      [...roughnessNodes].filter((node) => (node as { value?: unknown }).value === surfaces.snowRoughness).length,
      6,
      "roughness follows the same two-scale triplanar path",
    );
    assert.equal(material.userData.snowDetail, surfaces.snowNormal);
  }
});
