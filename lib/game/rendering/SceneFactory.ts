import * as THREE from "three";
import type { ResortGameProfile } from "../config/schema";
import { mulberry32 } from "../core/rng";
import type { SnowUniforms } from "./SnowMaterial";
import type { AtmosphereUniforms } from "./Atmosphere";
import type { NodeFactories } from "./nodeFactories";
import { visualWeatherPreset } from "./VisualPresets";
import { SNOW_DEBUG, snowDebugMode } from "./debugFlags";
import type { QualityRung } from "./QualityController";

export const SUN_DIRECTION = new THREE.Vector3(-0.46, 0.62, -0.64).normalize();

/**
 * Far clipping plane, metres. Was 6000 while the horizon was two procedural ridge bands at 1750 m
 * and 2900 m; the baked far field reaches 30 km, and geometry past `far` is simply not drawn — so
 * without this the entire far field would be invisible rather than merely wrong.
 *
 * The cost is depth precision: at near 0.5 a 24-bit depth buffer resolves roughly 100 m at 30 km.
 * That is inside one far-field cell (256-384 m out there), so it should hold, but horizon z-fighting
 * is worth checking in a visual pass — **on both backends**. three's `reversedDepthBuffer` defaults
 * to false and `backend.ts` never enables it, so WebGPU has exactly the same precision here as
 * WebGL; an earlier version of this comment claimed otherwise and was wrong.
 */
export const CAMERA_FAR = 34_000;

/**
 * Both backends carry the same uniform *shape*: the WebGL path uses `THREE.IUniform` objects and
 * the WebGPU path uses TSL `uniform()` nodes, and both expose `.value`. Renderer and
 * WeatherRenderer are written against these structural types so they need no backend branch.
 */
/** A type alias, not an interface, so it still satisfies `ShaderMaterial`'s indexed uniform map. */
export type SkyUniformSet = {
  uTop: { value: THREE.Color };
  uMid: { value: THREE.Color };
  uHorizon: { value: THREE.Color };
  uCloud: { value: THREE.Color };
  uCloudiness: { value: number };
  uTime: { value: number };
  uSun: { value: THREE.Color };
  uSunDir: { value: THREE.Vector3 };
  uHaze: { value: number };
};

export interface SnowUniformSet {
  horizon: { value: THREE.Color };
  glint: { value: number };
  track: { value: THREE.Vector4 };
}

export interface AtmosphereUniformSet {
  density: { value: number };
  heightFalloff: { value: number };
  referenceHeight: { value: number };
  farRetention: { value: number };
  blue: { value: THREE.Color };
  warm: { value: THREE.Color };
  sunDirection: { value: THREE.Vector3 };
}

export interface GameScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /**
   * A `SphereGeometry` gradient dome below rung 2, or a `SkyMesh` (its own `BoxGeometry`, sized by
   * the depth-pinning trick in its vertex shader) at rung 2+ on WebGPU. `BufferGeometry` is the
   * common ancestor; nothing downstream reads the concrete geometry type.
   */
  sky: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  skyUniforms: SkyUniformSet;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  sunDisc: THREE.Mesh;
  sunGlow: THREE.Mesh;
  peaks: THREE.Group;
  snowUniforms: SnowUniformSet;
  atmosphereUniforms: AtmosphereUniformSet;
}

function makeRidge(radius: number, height: number, seed: number, low: number, high: number, segments: number) {
  const positions: number[] = [], colors: number[] = [];
  const random = mulberry32(seed), profile: number[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const a = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 3.1 + seed);
    const b = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 7.7 + seed * 2.3);
    const c = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 13.3 + seed * 0.7);
    profile.push((a * 0.62 + b * 0.27 + c * 0.11) * (0.55 + random() * 0.62));
  }
  profile[segments] = profile[0];
  const c0 = new THREE.Color(low), c1 = new THREE.Color(high);
  for (let i = 0; i < segments; i += 1) {
    const a0 = i / segments * Math.PI * 2, a1 = (i + 1) / segments * Math.PI * 2;
    const x0 = Math.cos(a0) * radius, z0 = Math.sin(a0) * radius;
    const x1 = Math.cos(a1) * radius, z1 = Math.sin(a1) * radius;
    const h0 = profile[i] * height, h1 = profile[i + 1] * height, base = -height * 0.55;
    positions.push(x0, base, z0, x1, base, z1, x1, h1, z1, x0, base, z0, x1, h1, z1, x0, h0, z0);
    for (let vertex = 0; vertex < 6; vertex += 1) {
      const color = c0.clone().lerp(c1, vertex === 2 || vertex >= 4 ? 0.9 : 0);
      colors.push(color.r, color.g, color.b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

/**
 * `nodes` doubles as the backend switch: the WebGPU pipeline is exactly the sessions that resolved
 * the node-material chunk (`loadNodeFactories()`), and `null` is the WebGL path with its GLSL
 * `ShaderMaterial` sky and `FogExp2`.
 *
 * `rung` is the *seeded* quality rung (`QualityController.rung` at construction time), not a live
 * value the sky re-reads later: the physical `SkyMesh` is a full-screen shader, expensive enough
 * that which sky mounts is a scene-build-time decision rather than something the governor swaps
 * mid-run, the way it does post-processing or shadow cascades.
 */
export function createScene(profile: ResortGameProfile, aspect: number, nodes: NodeFactories | null = null, rung: QualityRung = 0): GameScene {
  const weather = profile.weather[0], visual = visualWeatherPreset(0), scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(weather.fogCol, weather.fog);
  const camera = new THREE.PerspectiveCamera(65, aspect, 0.5, CAMERA_FAR);
  const hemi = new THREE.HemisphereLight(visual.hemiSky, visual.hemiGround, weather.hemi);
  const ambient = new THREE.AmbientLight(visual.ambientCol, weather.amb);
  const sun = new THREE.DirectionalLight(visual.sunCol, weather.sun);
  sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.far = 460;
  sun.shadow.camera.left = -95; sun.shadow.camera.right = 95; sun.shadow.camera.top = 95; sun.shadow.camera.bottom = -95;
  sun.shadow.bias = -0.0009; sun.shadow.normalBias = 0.35;
  scene.add(hemi, ambient, sun, sun.target);

  const skyGeometry = new THREE.SphereGeometry(3400, 32, 20);
  const skySeed = {
    top: new THREE.Color(weather.top), mid: new THREE.Color(visual.mid), horizon: new THREE.Color(weather.hor),
    cloud: new THREE.Color(visual.cloud), cloudiness: visual.cloudiness, sun: new THREE.Color(visual.sunCol),
    sunDir: SUN_DIRECTION.clone(), haze: weather.haze,
  };
  // A full-screen physical sky is real GPU cost; rungs 0-1 exist for hardware that can't spend it,
  // so they keep the gradient even on WebGPU. See SkyNodeMaterial.createPhysicalSky for why the
  // preset's colours drive the model's parameters rather than tinting its output.
  const physicalSky = nodes && rung >= 2 ? nodes.sky.createPhysicalSky(skySeed) : null;
  const skyNodeUniforms = physicalSky ? physicalSky.uniforms : nodes ? nodes.sky.createSkyNodeUniforms(skySeed) : null;
  const skyUniforms: SkyUniformSet = skyNodeUniforms ?? {
    uTop: { value: new THREE.Color(weather.top) }, uMid: { value: new THREE.Color(visual.mid) }, uHorizon: { value: new THREE.Color(weather.hor) },
    uCloud: { value: new THREE.Color(visual.cloud) }, uCloudiness: { value: visual.cloudiness }, uTime: { value: 0 },
    uSun: { value: new THREE.Color(visual.sunCol) }, uSunDir: { value: SUN_DIRECTION.clone() }, uHaze: { value: weather.haze },
  };
  const sky: THREE.Mesh<THREE.BufferGeometry, THREE.Material> = physicalSky
    ? physicalSky.mesh
    : nodes && skyNodeUniforms
    ? new THREE.Mesh(skyGeometry, nodes.sky.createSkyNodeMaterial(skyNodeUniforms) as THREE.Material)
    : new THREE.Mesh(skyGeometry, new THREE.ShaderMaterial({
    uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: "varying vec3 vDir; void main(){vDir=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
    fragmentShader: `uniform vec3 uTop,uMid,uHorizon,uCloud,uSun,uSunDir;uniform float uHaze,uCloudiness,uTime;varying vec3 vDir;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+1.),f.x),f.y);}
void main(){vec3 d=normalize(vDir);float t=clamp(d.y*.5+.5,0.,1.);vec3 c=mix(uHorizon,uMid,smoothstep(.12,.55,t));c=mix(c,uTop,smoothstep(.48,1.,t));vec2 p=normalize(d.xz)*2.5+uTime*vec2(.006,.002);float clouds=n(p*1.7)*.68+n(p*4.1+9.)*.32;float band=smoothstep(.02,.2,d.y)*(1.-smoothstep(.52,.86,d.y));c=mix(c,uCloud,smoothstep(.48,.7,clouds)*band*uCloudiness);float s=max(dot(d,normalize(uSunDir)),0.);c+=uSun*pow(s,180.)*1.7+c*uSun*pow(s,7.)*.08;c=mix(c,uHorizon,uHaze*pow(1.-t,2.));gl_FragColor=vec4(c,1.);}`,
  }));
  sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);
  const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(46, 18, 12), new THREE.MeshBasicMaterial({ color: 0xfff6de, fog: false, transparent: true, opacity: 0.95 }));
  const sunGlow = new THREE.Mesh(new THREE.SphereGeometry(140, 16, 10), new THREE.MeshBasicMaterial({ color: 0xffe6b0, fog: false, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }));
  sunDisc.renderOrder = sunGlow.renderOrder = -9; scene.add(sunDisc, sunGlow);
  const peaks = new THREE.Group(), ridgeSeed = profile.seed % 1000;
  const ridgeMaterial = () => new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide, transparent: true });
  const far = new THREE.Mesh(makeRidge(2900, 700 * profile.relief, 7 + ridgeSeed, 0x7d9dc4, 0xdcecff, 120), ridgeMaterial());
  const near = new THREE.Mesh(makeRidge(1750, 460 * profile.relief, 31 + ridgeSeed, 0x53749e, 0xd6e9ff, 96), ridgeMaterial());
  far.position.y = 120; near.position.y = 40; far.frustumCulled = near.frustumCulled = false;
  peaks.add(far, near); scene.add(peaks);
  const snowUniforms: SnowUniformSet = nodes ? nodes.snow.createSnowNodeUniforms(new THREE.Color(weather.hor), visual.glint) : {
    horizon: { value: new THREE.Color(weather.hor) },
    glint: { value: visual.glint },
    track: { value: new THREE.Vector4(1e6, 1e6, 1e6, 1e6) },
  } satisfies SnowUniforms;
  const atmosphereUniforms: AtmosphereUniformSet = nodes ? nodes.atmosphere.createAtmosphereNodeUniforms({
    // Always explicit: the module's own default density is a placeholder, not this weather preset.
    density: weather.fog, heightFalloff: 0.025, referenceHeight: 0,
    farRetention: weather.farRetention ?? 0,
    blue: new THREE.Color(visual.fogBlue), warm: new THREE.Color(visual.fogWarm),
    sunDirection: SUN_DIRECTION.clone(),
  }) : {
    density: { value: weather.fog }, heightFalloff: { value: 0.025 }, referenceHeight: { value: 0 },
    farRetention: { value: weather.farRetention ?? 0 },
    blue: { value: new THREE.Color(visual.fogBlue) }, warm: { value: new THREE.Color(visual.fogWarm) },
    sunDirection: { value: SUN_DIRECTION.clone() },
  } satisfies AtmosphereUniforms;
  if (nodes && snowDebugMode() !== SNOW_DEBUG.NO_FOG) {
    // An explicit scene.fogNode wins over the FogExp2 three would otherwise derive from scene.fog
    // (NodeManager.getFogNode), so the height fog replaces it rather than stacking with it.
    (scene as THREE.Scene & { fogNode?: unknown }).fogNode =
      nodes.atmosphere.createAtmosphereFog(atmosphereUniforms as Parameters<NodeFactories["atmosphere"]["createAtmosphereFog"]>[0]);
  }
  return { scene, camera, sky, skyUniforms, sun, hemi, ambient, sunDisc, sunGlow, peaks, snowUniforms, atmosphereUniforms };
}
