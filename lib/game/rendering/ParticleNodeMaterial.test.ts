import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { collectResources } from "./resources";
import { createParticleNodeMaterial, radialParticleTexture } from "./ParticleNodeMaterial";

test("the particle material is a point sprite that draws the radial dot", () => {
  const texture = radialParticleTexture();
  const material = createParticleNodeMaterial(texture, new THREE.Color(0xf7fbff), 620);

  assert.equal(material.isNodeMaterial, true);
  assert.equal((material as unknown as { isPointsNodeMaterial?: boolean }).isPointsNodeMaterial, true);
  assert.ok(material.sizeNode, "gl_PointSize is replaced by a size node");
  assert.ok(material.colorNode, "the tint colour is installed");
  assert.ok(material.opacityNode, "the sprite alpha comes from the texture times the per-point alpha");
  assert.equal(material.transparent, true);
  assert.equal(material.depthWrite, false);
  assert.equal(material.alphaTest, 0.012, "matches the GLSL's `if (a < .012) discard`");
  assert.equal(material.sizeAttenuation, false, "the 1/-viewZ falloff is computed by the size node itself");
});

test("the sprite texture stays reachable for disposal", () => {
  // collectResources() finds textures on material properties, in userData, and in ShaderMaterial
  // uniforms — a texture living only inside a TSL node would leak on dispose.
  const texture = radialParticleTexture();
  const material = createParticleNodeMaterial(texture, new THREE.Color(0xffffff), 240);
  const scene = new THREE.Scene();
  scene.add(new THREE.Points(new THREE.BufferGeometry(), material));

  assert.equal(collectResources(scene).textures.has(texture), true);
});

test("the radial texture is the same 32px premultiplied dot the GLSL sampled", () => {
  const texture = radialParticleTexture();
  assert.equal(texture.image.width, 32);
  assert.equal(texture.image.height, 32);
  assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
  const data = texture.image.data as Uint8Array;
  const centre = (15 * 32 + 15) * 4;
  const corner = 0;
  assert.equal(data[centre], 255, "RGB is flat white");
  assert.ok(data[centre + 3] > data[corner + 3], "alpha falls off from the centre");
  assert.equal(data[corner + 3], 0, "and reaches zero at the corners");
});
