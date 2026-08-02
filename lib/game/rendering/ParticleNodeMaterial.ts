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
 * The instanced particle centre. It cannot be called `position`: `PointsNodeMaterial`'s sprite path
 * reads `positionGeometry.xy` as the quad corner offset, so `position` belongs to the unit quad.
 */
export const PARTICLE_CENTRE = "aCentre";

const QUAD_CORNERS = [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0];
const QUAD_UVS = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];

/**
 * WebGPU's `point-list` topology rasterises exactly one pixel and WGSL has no point size, so a
 * `THREE.Points` cloud is invisible there no matter what `sizeNode` says. Particles therefore
 * become instanced quads, which is the branch of `PointsNodeMaterial.setupVertex` that actually
 * honours `sizeNode` (`builder.object.isPoints` must be false to reach `setupVertexSprite`).
 *
 * The instanced attributes alias the very same `Float32Array`s the WebGL geometry uses, so the
 * per-frame simulation in `EffectsRenderer` is untouched.
 */
export function createParticleSpriteGeometry(
  centre: Float32Array,
  alpha: Float32Array,
  size: Float32Array,
): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(QUAD_CORNERS, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(QUAD_UVS, 2));
  geometry.setAttribute(PARTICLE_CENTRE, new THREE.InstancedBufferAttribute(centre, 3));
  geometry.setAttribute("aAlpha", new THREE.InstancedBufferAttribute(alpha, 1));
  geometry.setAttribute("aSize", new THREE.InstancedBufferAttribute(size, 1));
  geometry.instanceCount = alpha.length;
  return geometry;
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

  // Each instance is placed by its centre; positionGeometry.xy stays free as the quad corner.
  material.positionNode = attribute(PARTICLE_CENTRE, "vec3");

  // gl_PointSize is in framebuffer pixels; the sprite path multiplies sizeNode by screenDPR to
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
