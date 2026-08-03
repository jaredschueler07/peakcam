import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import type { Node, UniformNode } from "three/webgpu";
import { clamp, dot, float, floor, fract, max, mix, normalize, positionLocal, pow, sin, smoothstep, uniform, vec2 } from "three/tsl";
import { SkyMesh } from "three/addons/objects/SkyMesh.js";

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

export interface PhysicalSky {
  mesh: SkyMesh;
  /**
   * `SceneFactory` still needs a `SkyUniformSet`-shaped object to hand back as `GameScene.skyUniforms`
   * — `WeatherRenderer` writes `uTop`/`uHorizon`/etc by name on every weather change regardless of
   * which sky is mounted, and `Renderer.render()` ticks `uTime` unconditionally. `SkyMesh` reads none
   * of these (its clouds animate off TSL's own `time`), so this is a compatibility sink, not wiring.
   */
  uniforms: SkyNodeUniforms;
}

/**
 * A real atmospheric model (Preetham scattering) in place of the hand-tuned 3-stop gradient,
 * gated to rung 2+ because it is a full-screen shader with a five-octave cloud FBM in the
 * fragment stage — too expensive to force on the rungs that exist for weak hardware.
 *
 * Design decision: drive `SkyMesh`'s own physical parameters from the weather preset's severity
 * (`cloudiness`, `haze`) rather than tinting its output with the preset's `top`/`hor` colours.
 * Preetham scattering already produces a horizon-to-zenith gradient and a cloud layer from first
 * principles; painting a flat tint over that would fight the model's own colour response and had
 * no clean seam to inject into (`SkyMesh` builds its `NodeMaterial` internally and exposes no
 * `colorNode` hook to compose with). Turbidity and Mie coefficient rise with haze (more scattering
 * = the milky, desaturated sky a whiteout preset wants); cloud coverage/density track cloudiness;
 * the sun disc hides once haze crosses the point the gradient's own `uHaze` term would have washed
 * it out. This is coarser than the old gradient's exact preset colours, and deliberately so: fog
 * remains the only colour contract downstream code depends on (`atmosphereUniforms.blue`/`warm`),
 * and those never read from the sky at all — see `SceneFactory.createScene`.
 */
export function createPhysicalSky(seed: SkyNodeSeed): PhysicalSky {
  const mesh = new SkyMesh();
  // Scale is cosmetic here: SkyMesh's vertex shader pins depth to the far plane (`position.z =
  // position.w`), the same skybox trick the old sphere used via `renderOrder`/`frustumCulled`.
  // The upstream example's own demo uses this magnitude; kept for parity with its `sunfade` term,
  // which divides `sunPosition.y` by a fixed constant tuned for it.
  mesh.scale.setScalar(450_000);
  mesh.turbidity.value = 2 + seed.haze * 8;
  mesh.rayleigh.value = Math.max(0.3, 2 - seed.cloudiness * 1.6);
  mesh.mieCoefficient.value = 0.005 + seed.haze * 0.03;
  mesh.mieDirectionalG.value = 0.8;
  mesh.cloudCoverage.value = seed.cloudiness;
  mesh.cloudDensity.value = 0.3 + seed.cloudiness * 0.4;
  mesh.showSunDisc.value = seed.haze > 0.6 ? 0 : 1;
  // `seed.sunDir` is already a unit vector (`SUN_DIRECTION` is normalized at module scope), which
  // matches the magnitude the upstream Sky/SkyMesh examples pass — not a world-space position.
  mesh.sunPosition.value.copy(seed.sunDir);
  return { mesh, uniforms: createSkyNodeUniforms(seed) };
}
