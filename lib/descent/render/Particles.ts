/**
 * lib/descent/render/Particles.ts
 * ───────────────────────────────
 * Two CPU-driven point pools: falling snow around the camera (density from
 * the weather preset) and carve spray thrown off the skis' edges, scaled by
 * the surface (a powder turn blooms, ice barely dusts). Both are plain
 * `THREE.Points` with per-particle size and alpha in attributes and a tiny
 * shader so a landing puff and a snowflake share one draw call each.
 */

import * as THREE from "three";
import type { World } from "../types";
import type { RenderFrame, RenderModule } from "./frame";
import { SNOW as SNOW_TUNING } from "../sim/tuning";

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (300.0 / max(1.0, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = dot(d, d) * 4.0;
    if (r > 1.0) discard;
    float a = (1.0 - r) * vAlpha;
    gl_FragColor = vec4(uColor, a);
  }
`;

class Pool {
  readonly points: THREE.Points;
  readonly positions: Float32Array;
  readonly sizes: Float32Array;
  readonly alphas: Float32Array;
  readonly velocities: Float32Array;
  readonly life: Float32Array;
  readonly maxLife: Float32Array;
  private cursor = 0;
  private readonly geometry: THREE.BufferGeometry;

  constructor(scene: THREE.Scene, readonly capacity: number, color: number, depthWrite: boolean) {
    this.positions = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.alphas = new Float32Array(capacity);
    this.velocities = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("aSize", new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: { uColor: { value: new THREE.Color(color) } },
      transparent: true, depthWrite, blending: THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, alpha: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.positions[i * 3] = x; this.positions[i * 3 + 1] = y; this.positions[i * 3 + 2] = z;
    this.velocities[i * 3] = vx; this.velocities[i * 3 + 1] = vy; this.velocities[i * 3 + 2] = vz;
    this.sizes[i] = size; this.alphas[i] = alpha; this.life[i] = life; this.maxLife[i] = life;
  }

  commit(): void {
    (this.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute("aSize") as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute("aAlpha") as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.points);
    this.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

export class Particles implements RenderModule {
  private readonly snow: Pool;
  private readonly spray: Pool;
  private sprayAccumulator = 0;
  private snowAccumulator = 0;
  private seed = 12345;

  constructor(private readonly scene: THREE.Scene, private readonly world: World) {
    this.snow = new Pool(scene, 2600, 0xffffff, false);
    this.spray = new Pool(scene, 1600, 0xf7fbff, false);
    // Snowflakes start invisible; they are spawned into the sky as the weather demands.
    this.snow.alphas.fill(0);
    this.snow.commit();
    this.spray.alphas.fill(0);
    this.spray.commit();
  }

  private random(): number {
    // Small LCG: deterministic, allocation-free.
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** A burst under the skis (landing, crash). */
  burst(x: number, y: number, z: number, strength: number, surface: keyof typeof SNOW_TUNING): void {
    const count = Math.min(120, Math.round(18 * strength * SNOW_TUNING[surface].spray));
    for (let i = 0; i < count; i++) {
      const a = this.random() * Math.PI * 2, r = 1.5 + this.random() * 3.5 * strength;
      this.spray.spawn(x, y + 0.1, z, Math.cos(a) * r, 1.2 + this.random() * 3 * strength, Math.sin(a) * r, 0.25 + this.random() * 0.5, 0.45 + this.random() * 0.5, 0.7);
    }
  }

  update(frame: RenderFrame): void {
    const dt = Math.min(frame.dt, 0.05);
    this.updateSnow(frame, dt);
    this.updateSpray(frame, dt);
  }

  private updateSnow(frame: RenderFrame, dt: number): void {
    const pool = this.snow;
    const cam = frame.camera.position;
    const weather = frame.weather;
    const density = frame.quality === 2 ? weather.snow * 0.4 : weather.snow;
    // Spawn rate proportional to preset density (0..3600) inside a 60 m box around the camera.
    this.snowAccumulator += density * 0.16 * dt;
    const wind = weather.wind;
    while (this.snowAccumulator >= 1) {
      this.snowAccumulator -= 1;
      const x = cam.x + (this.random() - 0.5) * 70, z = cam.z + (this.random() - 0.5) * 70;
      const y = cam.y + 8 + this.random() * 22;
      pool.spawn(x, y, z, wind * 0.35 + (this.random() - 0.5) * 0.8, -(1.6 + this.random() * 1.4), (this.random() - 0.5) * 0.8, 0.22 + this.random() * 0.4, 9, 0.5);
    }
    const p = pool.positions, v = pool.velocities, life = pool.life, alpha = pool.alphas;
    const t = frame.time;
    for (let i = 0; i < pool.capacity; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      const j = i * 3;
      p[j] += (v[j] + Math.sin(t * 1.3 + i) * 0.6) * dt;
      p[j + 1] += v[j + 1] * dt;
      p[j + 2] += (v[j + 2] + Math.cos(t * 1.1 + i * 0.7) * 0.6) * dt;
      // Fade when far from the camera or at end of life; hide below the snow.
      const dx = p[j] - cam.x, dz = p[j + 2] - cam.z;
      const near = 1 - Math.min(1, (dx * dx + dz * dz) / (45 * 45));
      alpha[i] = life[i] <= 0 ? 0 : 0.6 * near * Math.min(1, life[i] * 2);
      if (p[j + 1] < this.world.terrain.height(p[j], p[j + 2])) { life[i] = 0; alpha[i] = 0; }
    }
    pool.commit();
  }

  private updateSpray(frame: RenderFrame, dt: number): void {
    const s = frame.state;
    const pool = this.spray;
    if (s.onGround && s.liftIndex < 0 && s.crash <= 0 && s.speed > 3) {
      const tuning = SNOW_TUNING[s.surface];
      const skid = Math.min(1, Math.abs(Math.atan2(Math.sin(s.travelYaw - s.yaw), Math.cos(s.travelYaw - s.yaw))) / 0.7);
      const edge = Math.abs(s.edge);
      const intensity = (edge * 0.9 + skid * 1.3 + (s.braking ? 0.7 : 0)) * Math.min(1, s.speed / 18) * tuning.spray;
      this.sprayAccumulator += intensity * 220 * dt;
      // Spray leaves the outside edge, opposite to the turn.
      const sideX = Math.cos(s.yaw), sideZ = -Math.sin(s.yaw);
      const side = s.edge > 0 ? 1 : -1; // right edge → spray flies left... it flies away from the inside of the turn
      const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
      while (this.sprayAccumulator >= 1) {
        this.sprayAccumulator -= 1;
        const along = -0.4 - this.random() * 0.9;
        const x = s.x + fx * along + sideX * side * 0.25, z = s.z + fz * along + sideZ * side * 0.25;
        const lateral = (0.8 + this.random() * 2.2 + skid * 2) * side * -1;
        const up = 0.6 + this.random() * (1.2 + edge * 1.5 + skid * 1.2) * Math.min(1, s.speed / 15);
        pool.spawn(x, s.y + 0.12, z,
          sideX * lateral + s.vx * 0.3 + (this.random() - 0.5), up, sideZ * lateral + s.vz * 0.3 + (this.random() - 0.5),
          0.14 + this.random() * 0.3 * (1 + tuning.spray * 0.5), 0.25 + this.random() * 0.35, 0.6);
      }
    }
    if (s.events.landed && s.events.landingImpact > 2) this.burst(s.x, s.y, s.z, Math.min(3, s.events.landingImpact / 4), s.surface);
    if (s.events.crashed) this.burst(s.x, s.y, s.z, 2.2, s.surface);
    const p = pool.positions, v = pool.velocities, life = pool.life, maxLife = pool.maxLife, alpha = pool.alphas;
    for (let i = 0; i < pool.capacity; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      const j = i * 3;
      v[j + 1] -= 9.8 * dt;
      v[j] *= 0.985; v[j + 2] *= 0.985;
      p[j] += v[j] * dt; p[j + 1] += v[j + 1] * dt; p[j + 2] += v[j + 2] * dt;
      alpha[i] = life[i] <= 0 ? 0 : 0.7 * Math.min(1, life[i] / maxLife[i] * 2);
    }
    pool.commit();
  }

  dispose(): void {
    this.snow.dispose(this.scene);
    this.spray.dispose(this.scene);
  }
}
