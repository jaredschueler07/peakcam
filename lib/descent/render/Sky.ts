/**
 * lib/descent/render/Sky.ts
 * ─────────────────────────
 * Sky dome, sun, fog and the scene's lights — everything that decides the
 * light on the snow. Driven by the resort's weather presets
 * (`profile.weather[i]`: sky top / horizon / fog colours, sun and ambient
 * strengths, haze) so a Portillo bluebird and a Heavenly whiteout look like
 * themselves.
 */

import * as THREE from "three";
import type { ResortWeather, World } from "../types";
import type { RenderFrame, RenderModule } from "./frame";

const SKY_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSun;
  uniform vec3 uSunColor;
  uniform float uHaze;
  uniform vec3 uCamera;
  varying vec3 vWorld;
  void main() {
    vec3 dir = normalize(vWorld - uCamera);
    float h = clamp(dir.y, -0.1, 1.0);
    // Horizon band widens with haze.
    float t = pow(clamp(h / (0.55 + uHaze * 0.5), 0.0, 1.0), 0.62);
    vec3 color = mix(uHorizon, uTop, t);
    float sun = max(dot(dir, uSun), 0.0);
    color += uSunColor * (pow(sun, 900.0) * 1.6 + pow(sun, 24.0) * 0.16 * (1.0 - uHaze));
    gl_FragColor = vec4(color, 1.0);
  }
`;

export class Sky implements RenderModule {
  private readonly dome: THREE.Mesh;
  private readonly uniforms: {
    uTop: { value: THREE.Color }; uHorizon: { value: THREE.Color }; uSun: { value: THREE.Vector3 };
    uSunColor: { value: THREE.Color }; uHaze: { value: number }; uCamera: { value: THREE.Vector3 };
  };
  readonly sun: THREE.DirectionalLight;
  readonly hemisphere: THREE.HemisphereLight;
  readonly ambient: THREE.AmbientLight;
  private readonly fog: THREE.Fog;
  private weatherIndex = -1;
  private readonly sunDirection = new THREE.Vector3();

  constructor(private readonly scene: THREE.Scene, private readonly world: World) {
    this.uniforms = {
      uTop: { value: new THREE.Color(0x2560c4) },
      uHorizon: { value: new THREE.Color(0xdef0ff) },
      uSun: { value: new THREE.Vector3(0.4, 0.7, 0.2).normalize() },
      uSunColor: { value: new THREE.Color(0xfff2d6) },
      uHaze: { value: 0.1 },
      uCamera: { value: new THREE.Vector3() },
    };
    const material = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(45_000, 32, 16), material);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -100;
    scene.add(this.dome);

    this.sun = new THREE.DirectionalLight(0xfff1d8, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;
    const cam = this.sun.shadow.camera;
    cam.near = 1; cam.far = 600; cam.left = -110; cam.right = 110; cam.top = 110; cam.bottom = -110;
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.hemisphere = new THREE.HemisphereLight(0xbfd8ff, 0x5c6470, 0.9);
    scene.add(this.hemisphere);
    this.ambient = new THREE.AmbientLight(0xdfe8ff, 0.12);
    scene.add(this.ambient);

    this.fog = new THREE.Fog(0xdef0ff, 800, 9000);
    scene.fog = this.fog;
    scene.background = null;
    this.applyWeather(world.profile.weather[0], 0);
  }

  private applyWeather(weather: ResortWeather, index: number): void {
    this.weatherIndex = index;
    this.uniforms.uTop.value.setHex(weather.top);
    this.uniforms.uHorizon.value.setHex(weather.hor);
    this.uniforms.uHaze.value = weather.haze;
    this.sun.intensity = 0.9 + weather.sun * 0.6;
    this.hemisphere.intensity = 0.35 + weather.hemi * 0.3;
    this.ambient.intensity = 0.05 + weather.amb * 0.25;
    // A low-ish afternoon sun so every roll and gully throws a shadow. It sits south of overhead in
    // the northern hemisphere and north of it at Portillo.
    const south = this.world.profile.slug === "ski-portillo" ? -1 : 1;
    this.sunDirection.set(0.62, 0.55, 0.5 * south).normalize();
    this.uniforms.uSun.value.copy(this.sunDirection);
    // Fog leans toward the sky so distance reads as blue haze, not as more snow.
    this.fog.color.setHex(weather.fogCol).lerp(this.uniforms.uTop.value, index === 0 ? 0.22 : 0.06);
    this.uniforms.uHorizon.value.lerp(this.uniforms.uTop.value, index === 0 ? 0.12 : 0);
    const visibility = this.world.conditions.environment?.visibilityM ?? 20000;
    const stormy = index > 0 || visibility < 5000;
    const far = stormy ? Math.min(6000, Math.max(400, visibility * (index === 2 ? 0.35 : 0.8))) : 7500;
    this.fog.near = stormy ? far * 0.12 : 500;
    this.fog.far = far;
    // Desaturate the zenith a touch: a poster sky, not a render-farm one.
    this.uniforms.uTop.value.lerp(this.uniforms.uHorizon.value, 0.18);
  }

  update(frame: RenderFrame): void {
    if (frame.weatherIndex !== this.weatherIndex) this.applyWeather(frame.weather, frame.weatherIndex);
    const s = frame.state;
    this.uniforms.uCamera.value.copy(frame.camera.position);
    // Shadow camera follows the rider so the 2k map covers ~220 m around them.
    this.sun.position.set(s.x + this.sunDirection.x * 300, s.y + this.sunDirection.y * 300, s.z + this.sunDirection.z * 300);
    this.sun.target.position.set(s.x, s.y, s.z);
    this.sun.target.updateMatrixWorld();
    this.dome.position.copy(frame.camera.position);
  }

  dispose(): void {
    this.dome.geometry.dispose();
    (this.dome.material as THREE.Material).dispose();
    this.scene.remove(this.dome, this.sun, this.sun.target, this.hemisphere, this.ambient);
    this.sun.dispose();
    this.scene.fog = null;
  }
}
