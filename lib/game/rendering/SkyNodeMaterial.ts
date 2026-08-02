import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import type { Node, UniformNode } from "three/webgpu";
import { clamp, dot, float, floor, fract, max, mix, normalize, positionLocal, pow, sin, smoothstep, uniform, vec2 } from "three/tsl";

/**
 * TSL port of the sky dome shader that lived inline in `SceneFactory` (a raw `ShaderMaterial`,
 * which the WebGPU backend cannot compile). Every constant is carried over from the GLSL.
 *
 * The `u*` key names are load-bearing: `WeatherRenderer` writes them by name for both backends.
 */
export interface SkyNodeUniforms {
  uTop: UniformNode<"color", THREE.Color>;
  uMid: UniformNode<"color", THREE.Color>;
  uHorizon: UniformNode<"color", THREE.Color>;
  uCloud: UniformNode<"color", THREE.Color>;
  uCloudiness: UniformNode<"float", number>;
  uTime: UniformNode<"float", number>;
  uSun: UniformNode<"color", THREE.Color>;
  uSunDir: UniformNode<"vec3", THREE.Vector3>;
  uHaze: UniformNode<"float", number>;
}

export interface SkyNodeSeed {
  top: THREE.Color;
  mid: THREE.Color;
  horizon: THREE.Color;
  cloud: THREE.Color;
  cloudiness: number;
  sun: THREE.Color;
  sunDir: THREE.Vector3;
  haze: number;
}

type Float = Node<"float">;
type Vec2 = Node<"vec2">;
type Vec3 = Node<"vec3">;

/** `color` and `vec3` generate the same three floats; only the r185 typings distinguish them. */
const asVec3 = (node: object): Vec3 => node as Vec3;

/** `h(p) = fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453)` */
const hash = (p: Vec2): Float => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));

/** Bilinear value noise with a smoothstep fade — `n(p)` in the GLSL. */
function valueNoise(p: Vec2): Float {
  const i = floor(p);
  const raw = fract(p);
  const f = raw.mul(raw).mul(float(3).sub(raw.mul(2)));
  return mix(
    mix(hash(i), hash(i.add(vec2(1, 0))), f.x),
    mix(hash(i.add(vec2(0, 1))), hash(i.add(1)), f.x),
    f.y,
  );
}

export function createSkyNodeUniforms(seed: SkyNodeSeed): SkyNodeUniforms {
  return {
    uTop: uniform(seed.top),
    uMid: uniform(seed.mid),
    uHorizon: uniform(seed.horizon),
    uCloud: uniform(seed.cloud),
    uCloudiness: uniform(seed.cloudiness),
    uTime: uniform(0),
    uSun: uniform(seed.sun),
    uSunDir: uniform(seed.sunDir),
    uHaze: uniform(seed.haze),
  };
}

function skyColorNode(uniforms: SkyNodeUniforms): Vec3 {
  // The GLSL passed the sphere's object-space vertex position through as `vDir`.
  const d = normalize(positionLocal);
  const t = clamp(d.y.mul(0.5).add(0.5), 0, 1);

  const gradient = mix(
    mix(asVec3(uniforms.uHorizon), asVec3(uniforms.uMid), smoothstep(0.12, 0.55, t)),
    asVec3(uniforms.uTop),
    smoothstep(0.48, 1, t),
  );

  const p = normalize(d.xz).mul(2.5).add(uniforms.uTime.mul(vec2(0.006, 0.002)));
  const clouds = valueNoise(p.mul(1.7)).mul(0.68).add(valueNoise(p.mul(4.1).add(9)).mul(0.32));
  const band = smoothstep(0.02, 0.2, d.y).mul(float(1).sub(smoothstep(0.52, 0.86, d.y)));
  const clouded = mix(gradient, asVec3(uniforms.uCloud), smoothstep(0.48, 0.7, clouds).mul(band).mul(uniforms.uCloudiness));

  // Both sun terms read the pre-sun colour, exactly as GLSL's `c += ... + c * ...` does.
  const s = max(dot(d, normalize(uniforms.uSunDir)), 0);
  const sunlit = clouded
    .add(asVec3(uniforms.uSun).mul(pow(s, 180)).mul(1.7))
    .add(clouded.mul(asVec3(uniforms.uSun)).mul(pow(s, 7)).mul(0.08));

  return mix(sunlit, asVec3(uniforms.uHorizon), uniforms.uHaze.mul(pow(float(1).sub(t), 2)));
}

export function createSkyNodeMaterial(uniforms: SkyNodeUniforms): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.colorNode = skyColorNode(uniforms);
  material.side = THREE.BackSide;
  material.depthWrite = false;
  material.fog = false;
  return material;
}
