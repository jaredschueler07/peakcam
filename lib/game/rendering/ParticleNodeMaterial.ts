import * as THREE from "three";
import { PointsNodeMaterial } from "three/webgpu";
import type { Node } from "three/webgpu";
import { attribute, max, positionView, screenDPR, texture, uniform, uv } from "three/tsl";

const SIZE = 32;

/** @types/three types `attribute()` as a bare AttributeNode, without the arithmetic helpers. */
const floatAttribute = (name: string) => attribute(name, "float") as unknown as Node<"float">;

/**
 * The soft round dot the spray and snowfall points sample. Identical to the `radialTexture()` the
 * WebGL `EffectsRenderer` built inline; kept here so both backends share one definition.
 */
export function radialParticleTexture(): THREE.DataTexture {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
    const distance = Math.hypot(x - 15.5, y - 15.5) / 16, alpha = Math.max(0, 1 - distance);
    const i = (y * SIZE + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = Math.round(alpha * alpha * 255);
  }
  const map = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  map.needsUpdate = true;
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

/**
 * TSL port of the shared point-sprite `ShaderMaterial` in `EffectsRenderer`, which the WebGPU
 * backend cannot compile. The GLSL was:
 *
 *   gl_PointSize = aSize * uScale / max(1., -mv.z);
 *   vec4 t = texture2D(uTex, gl_PointCoord); float a = t.a * aAlpha;
 *   if (a < .012) discard; gl_FragColor = vec4(uColor, a);
 */
export function createParticleNodeMaterial(map: THREE.Texture, color: THREE.Color, scale: number): PointsNodeMaterial {
  const material = new PointsNodeMaterial();

  // gl_PointSize is in framebuffer pixels; PointsNodeMaterial multiplies sizeNode by screenDPR to
  // convert from logical pixels, so divide it back out to land on the same on-screen size.
  const attenuated = floatAttribute("aSize").mul(uniform(scale)).div(max(positionView.z.negate(), 1));
  material.sizeNode = attenuated.div(screenDPR);
  material.sizeAttenuation = false;

  material.colorNode = uniform(color);
  material.opacityNode = texture(map, uv()).a.mul(floatAttribute("aAlpha"));
  material.alphaTest = 0.012;
  material.transparent = true;
  material.depthWrite = false;
  // collectResources() cannot see textures buried in a node graph; userData is where it looks.
  material.userData.particleTexture = map;
  return material;
}
