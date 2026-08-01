import * as THREE from "three";
import type { ResortGameProfile } from "../config/schema";
import { mulberry32 } from "../core/rng";

export const SUN_DIRECTION = new THREE.Vector3(-0.46, 0.62, -0.64).normalize();

export interface GameScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  skyUniforms: Record<string, THREE.IUniform>;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  sunDisc: THREE.Mesh;
  sunGlow: THREE.Mesh;
  peaks: THREE.Group;
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

export function createScene(profile: ResortGameProfile, aspect: number): GameScene {
  const weather = profile.weather[0], scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(weather.fogCol, weather.fog);
  const camera = new THREE.PerspectiveCamera(64, aspect, 0.5, 6000);
  const hemi = new THREE.HemisphereLight(weather.hor, 0x9fb2c8, weather.hemi);
  const ambient = new THREE.AmbientLight(0xbdd6f0, weather.amb);
  const sun = new THREE.DirectionalLight(0xfff2dc, weather.sun);
  sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.far = 460;
  sun.shadow.camera.left = -95; sun.shadow.camera.right = 95; sun.shadow.camera.top = 95; sun.shadow.camera.bottom = -95;
  sun.shadow.bias = -0.0009; sun.shadow.normalBias = 0.35;
  scene.add(hemi, ambient, sun, sun.target);

  const skyUniforms: Record<string, THREE.IUniform> = {
    uTop: { value: new THREE.Color(weather.top) }, uHorizon: { value: new THREE.Color(weather.hor) },
    uSun: { value: new THREE.Color(0xfff3d4) }, uSunDir: { value: SUN_DIRECTION.clone() }, uHaze: { value: weather.haze },
  };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3400, 32, 20), new THREE.ShaderMaterial({
    uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: "varying vec3 vDir; void main(){vDir=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
    fragmentShader: "uniform vec3 uTop,uHorizon,uSun,uSunDir;uniform float uHaze;varying vec3 vDir;void main(){vec3 d=normalize(vDir);float t=clamp(d.y*.5+.5,0.,1.);vec3 c=mix(uHorizon,uTop,pow(t,.78));float s=max(dot(d,normalize(uSunDir)),0.);c+=uSun*pow(s,480.)*2.4;c+=uSun*pow(s,12.)*.2;c=mix(c,uHorizon,uHaze*pow(1.-t,2.));gl_FragColor=vec4(c,1.);}",
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
  return { scene, camera, sky, skyUniforms, sun, hemi, ambient, sunDisc, sunGlow, peaks };
}
