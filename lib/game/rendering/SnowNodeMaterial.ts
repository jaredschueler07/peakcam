import * as THREE from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import {
  abs, cameraPosition, cameraViewMatrix, clamp, diffuseColor, dot, float, floor, fract, length, max,
  mix, normalize, normalView, normalWorld, positionWorld, pow, sin, smoothstep, step, texture,
  uniform, vec3, vec4,
} from "three/tsl";
import type { Node, NodeBuilder, UniformNode } from "three/webgpu";
import { SNOW_DEBUG } from "./debugFlags";

/**
 * TSL port of `polishSnowMaterial` (SnowMaterial.ts) for the WebGPU backend. Every constant is
 * carried over from the GLSL so both backends render the same snow.
 */
export interface SnowNodeUniforms {
  horizon: UniformNode<"color", THREE.Color>;
  glint: UniformNode<"float", number>;
  track: UniformNode<"vec4", THREE.Vector4>;
}

type Float = Node<"float">;
type Vec2 = Node<"vec2">;
type Vec3 = Node<"vec3">;

const SUN = vec3(-0.46, 0.62, -0.64);
const AERIAL = vec3(0.6588, 0.7686, 0.9098);
const BACKSCATTER = vec3(0.68, 0.86, 0.96);

/**
 * The glint hash is `fract(sin(dot(p, k)) * 43758.5453)` on floored world position. At a resort
 * with large absolute coordinates (Heavenly sits ~3km up) `dot(p, k)` reaches ~1e7, and WGSL
 * leaves `sin()` undefined for arguments that large — Metal returns NaN, which propagates through
 * the glint into `outgoingLight` and clamps the fragment to black. GLSL ES merely lost precision
 * there, so this never showed on WebGL.
 *
 * Wrapping the position into a 64m cell keeps the argument small and finite. The sparkle pattern
 * repeats every 64m, which is far beyond the 28-105m band where glints are visible at all, and at
 * these coordinates the unwrapped pattern was already quantised into nonsense by f32 precision.
 */
const HASH_WRAP = 64;
const wrapForHash = (p: Vec3): Vec3 => p.sub(floor(p.div(HASH_WRAP)).mul(HASH_WRAP));

const snowHash = (p: Vec3): Float => fract(sin(dot(p, vec3(127.1, 311.7, 74.7))).mul(43758.5453));

const snowFlake = (p: Vec3): Vec3 =>
  normalize(vec3(snowHash(p).sub(0.5), snowHash(p.add(17.3)).sub(0.5), snowHash(p.add(41.7)).sub(0.5)));

const segmentDistance = (p: Vec2, a: Vec2, b: Vec2): Float => {
  const pa = p.sub(a);
  const ba = b.sub(a);
  return length(pa.sub(ba.mul(clamp(dot(pa, ba).div(max(dot(ba, ba), 0.001)), 0, 1))));
};

/** `1 - smoothstep(28, 105, distanceToCamera)` — the near/far detail blend from line 94 of the GLSL. */
const nearness = (): Float => float(1).sub(smoothstep(28, 105, length(positionWorld.sub(cameraPosition))));

function triplanarDetail(detailNormal: THREE.Texture, scale: number, weights: Vec3): Vec3 {
  const at = (uv: Vec2): Vec3 => texture(detailNormal, uv.div(scale)).xyz.mul(2).sub(1);
  return at(positionWorld.yz).mul(weights.x)
    .add(at(positionWorld.xz).mul(weights.y))
    .add(at(positionWorld.xy).mul(weights.z));
}

function snowNormalNode(detailNormal: THREE.Texture): Vec3 {
  const raw = abs(normalize(normalWorld)).pow(4);
  const weights = raw.div(max(dot(raw, vec3(1)), 0.001));
  const near = nearness();
  const detail = mix(triplanarDetail(detailNormal, 3, weights), triplanarDetail(detailNormal, 0.35, weights), near);
  // mat3(viewMatrix) * detail — a w of 0 drops the translation column.
  const detailView = cameraViewMatrix.mul(vec4(detail, 0)).xyz;
  return normalize(normalView.add(detailView.mul(mix(0.08, 0.22, near))));
}

/** The wrap/rim/glint/backscatter block (GLSL lines 101-111) applied to the lit colour. */
function snowShading(uniforms: SnowNodeUniforms, outgoingLight: Vec3, debug: number = SNOW_DEBUG.NONE): Vec3 {
  const n = normalize(normalWorld);
  const v = normalize(cameraPosition.sub(positionWorld));
  const l = normalize(SUN);

  const wrap = clamp(dot(n, l).add(0.5).div(1.5), 0, 1);
  const rim = pow(float(1).sub(clamp(dot(n, v), 0, 1)), 3);
  const half = normalize(v.add(l));
  const glint1 = pow(max(dot(snowFlake(wrapForHash(floor(positionWorld.mul(7)))), half), 0), 400);
  const glint2 = pow(max(dot(snowFlake(wrapForHash(floor(positionWorld.mul(19)).add(53))), half), 0), 2000);
  const track = float(1).sub(
    smoothstep(0.24, 0.62, segmentDistance(positionWorld.xz, uniforms.track.xy, uniforms.track.zw)),
  );
  const sparkle = step(0.72, glint1).mul(glint1).add(step(0.82, glint2).mul(glint2));

  // Each `?snowdbg` step drops one more term so a browser shot can bisect which one misbehaves.
  // The terms are removed from the graph entirely, not multiplied by zero: a NaN survives `* 0`.
  const wrapRimBlock = debug >= SNOW_DEBUG.NO_WRAP_RIM;
  const noGlint = debug >= SNOW_DEBUG.NO_GLINT;

  let shaded: Vec3 = wrapRimBlock
    ? outgoingLight
    : mix(outgoingLight, AERIAL, float(1).sub(wrap).mul(0.08))
      .add(diffuseColor.rgb.mul(wrap).mul(0.04))
      .add(BACKSCATTER.mul(pow(clamp(dot(v, l.negate()), 0, 1), 4)).mul(0.025))
      // `color` and `vec3` are the same three components once generated; only the types disagree.
      .add(uniforms.horizon.mul(rim).mul(0.055) as unknown as Vec3);

  if (!noGlint) shaded = shaded.add(vec3(sparkle).mul(uniforms.glint).mul(float(1).sub(track)).mul(0.35));
  return shaded;
}

/**
 * The GLSL injected its block before `<opaque_fragment>` — after lighting, before fog.
 * `material.outputNode` runs *after* fog, so the snow pass rides on `setupOutput` instead, which is
 * the extension point three documents for exactly this.
 */
class SnowStandardNodeMaterial extends MeshStandardNodeMaterial {
  constructor(private readonly snowUniforms: SnowNodeUniforms, private readonly debug: number = SNOW_DEBUG.NONE) {
    super();
  }

  setupOutput(builder: NodeBuilder, outputNode: Node): Node {
    const lit = outputNode as Node<"vec4">;
    return super.setupOutput(builder, vec4(snowShading(this.snowUniforms, lit.rgb, this.debug), lit.a));
  }
}

export function createSnowNodeUniforms(horizon = new THREE.Color(0xffffff), glint = 0): SnowNodeUniforms {
  return {
    horizon: uniform(horizon),
    glint: uniform(glint),
    track: uniform(new THREE.Vector4(1e6, 1e6, 1e6, 1e6)),
  };
}

export function createSnowNodeMaterial(
  detailNormal: THREE.Texture,
  uniforms: SnowNodeUniforms,
  debug: number = SNOW_DEBUG.NONE,
): MeshStandardNodeMaterial {
  // Mode 5 is a scene-level switch (no fogNode); it must leave this material untouched.
  const mode = debug === SNOW_DEBUG.NO_FOG ? SNOW_DEBUG.NONE : debug;
  // `?snowdbg=4` drops every custom term, leaving the stock node material on the same surface
  // settings — if the defect survives that, nothing in this module is responsible for it.
  const plain = mode >= SNOW_DEBUG.PLAIN;
  const material = plain ? new MeshStandardNodeMaterial() : new SnowStandardNodeMaterial(uniforms, mode);
  material.vertexColors = true;
  material.roughness = 0.86;
  material.metalness = 0.02;
  material.flatShading = false;
  material.dithering = true;
  if (mode < SNOW_DEBUG.NO_DETAIL_NORMAL) material.normalNode = snowNormalNode(detailNormal);
  material.userData.snowDetail = detailNormal;
  material.userData.snowOutputNode = (outgoingLight: Vec3) => snowShading(uniforms, outgoingLight, mode);
  return material;
}

/**
 * The far field's surface material on the WebGPU path (`FarFieldRenderer.ts`).
 *
 * Deliberately plain: at 0.5–30 km the signal is silhouette and aerial perspective, not surface
 * detail, so this skips the snow shading, the triplanar detail normal and the ski-track uniform
 * that `createSnowNodeMaterial` carries — all of which cost per-pixel work for something no one
 * can resolve at that distance.
 *
 * What it must *not* skip is the fog. `fog` stays true so `scene.fogNode` reaches it and the
 * near/far seam matches; `userData.heightFog` is left unset for the same reason on the WebGL
 * twin. Shadows are irrelevant out here — the cascade's `maxFar` is 460 m.
 */
export function createFarFieldNodeMaterial(color: THREE.Color): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.color = color;
  material.roughness = 1;
  material.metalness = 0;
  material.flatShading = false;
  material.dithering = true;
  // The far field is baked from r = 0, so it lies under the near-field tiles rather than meeting
  // them at a rim. At 16 m against the tiles' 4 m the two surfaces are close enough to fight for
  // depth; biasing the far field backwards makes the near field win wherever both are drawn.
  material.polygonOffset = true;
  material.polygonOffsetFactor = 1;
  material.polygonOffsetUnits = 1;
  return material;
}
