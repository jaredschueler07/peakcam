import * as THREE from "three";
import type { SimulationState, TerrainSampler } from "../core/types";
import { mulberry32 } from "../core/rng";
import type { QualityRung } from "./QualityController";
import { createParticleNodeMaterial, radialParticleTexture } from "./ParticleNodeMaterial";
import type { RendererBackendKind } from "./backend";

const SPRAY_MAX = 900, SNOW_MAX = 3600, SNOW_BOX = 130, TRACK_QUADS = 1600;
const pointVertex = "attribute float aAlpha;attribute float aSize;uniform float uScale;varying float vA;void main(){vA=aAlpha;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=aSize*uScale/max(1.,-mv.z);gl_Position=projectionMatrix*mv;}";
const pointFragment = "uniform sampler2D uTex;uniform vec3 uColor;varying float vA;void main(){vec4 t=texture2D(uTex,gl_PointCoord);float a=t.a*vA;if(a<.012)discard;gl_FragColor=vec4(uColor,a);}";
/** Preallocated attribute name list — `for (const name of [...])` would allocate every spray update. */
const SPRAY_ATTRS = ["position", "aAlpha", "aSize"] as const;

function radialTexture(): THREE.DataTexture {
  const size = 32, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const distance = Math.hypot(x - 15.5, y - 15.5) / 16, alpha = Math.max(0, 1 - distance);
    const i = (y * size + x) * 4; data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = Math.round(alpha * alpha * 255);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat); texture.needsUpdate = true; texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

export class EffectsRenderer {
  private readonly random: () => number;
  private readonly sprayPosition = new Float32Array(SPRAY_MAX * 3); private readonly sprayVelocity = new Float32Array(SPRAY_MAX * 3);
  private readonly sprayLife = new Float32Array(SPRAY_MAX); private readonly sprayMaxLife = new Float32Array(SPRAY_MAX);
  private readonly sprayAlpha = new Float32Array(SPRAY_MAX); private readonly spraySize = new Float32Array(SPRAY_MAX); private readonly sprayGeometry = new THREE.BufferGeometry();
  private readonly snowPosition = new Float32Array(SNOW_MAX * 3); private readonly snowAlpha = new Float32Array(SNOW_MAX); private readonly snowSize = new Float32Array(SNOW_MAX); private readonly snowSeed = new Float32Array(SNOW_MAX); private readonly snowGeometry = new THREE.BufferGeometry();
  private readonly trackPosition = new Float32Array(TRACK_QUADS * 18); private readonly trackGeometry = new THREE.BufferGeometry();
  private sprayHead = 0; private trackHead = 0; private trackUsed = 0;
  /** Scalar track ring — avoids allocating a `{lx,lz,rx,rz}` object every ground frame. */
  private trackHasPrevious = false;
  private prevLx = 0; private prevLz = 0; private prevRx = 0; private prevRz = 0;
  private quality: QualityRung = 4;

  /**
   * Both point clouds share one shader. The WebGPU backend cannot compile the raw `ShaderMaterial`,
   * so it gets the TSL port; `sizeNode`/`opacityNode` carry the same arithmetic the GLSL did.
   */
  private pointMaterial(color: number, scale: number): THREE.Material {
    if (this.backendKind === "webgpu") return createParticleNodeMaterial(radialParticleTexture(), new THREE.Color(color), scale);
    return new THREE.ShaderMaterial({
      uniforms: { uTex: { value: radialTexture() }, uColor: { value: new THREE.Color(color) }, uScale: { value: scale } },
      vertexShader: pointVertex, fragmentShader: pointFragment, transparent: true, depthWrite: false,
    });
  }

  constructor(
    scene: THREE.Scene,
    seed: number,
    private readonly terrain: TerrainSampler,
    private readonly reducedMotion: boolean,
    private readonly sprayDepthMultiplier = 1,
    private readonly backendKind: RendererBackendKind = "webgl",
  ) {
    this.random = mulberry32(seed ^ 0x8e37a12d);
    this.sprayGeometry.setAttribute("position", new THREE.BufferAttribute(this.sprayPosition, 3)); this.sprayGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.sprayAlpha, 1)); this.sprayGeometry.setAttribute("aSize", new THREE.BufferAttribute(this.spraySize, 1));
    const sprayMaterial = this.pointMaterial(0xf7fbff, 620);
    const spray = new THREE.Points(this.sprayGeometry, sprayMaterial); spray.frustumCulled = false; scene.add(spray);
    for (let i = 0; i < SNOW_MAX; i += 1) { this.snowPosition[i * 3] = (this.random() - 0.5) * SNOW_BOX; this.snowPosition[i * 3 + 1] = this.random() * SNOW_BOX * 0.7; this.snowPosition[i * 3 + 2] = (this.random() - 0.5) * SNOW_BOX; this.snowAlpha[i] = 0.55 + this.random() * 0.45; this.snowSize[i] = 0.5 + this.random() * 1.5; this.snowSeed[i] = this.random() * Math.PI * 2; }
    this.snowGeometry.setAttribute("position", new THREE.BufferAttribute(this.snowPosition, 3)); this.snowGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.snowAlpha, 1)); this.snowGeometry.setAttribute("aSize", new THREE.BufferAttribute(this.snowSize, 1));
    const snowMaterial = this.pointMaterial(0xffffff, 240);
    const snowfall = new THREE.Points(this.snowGeometry, snowMaterial); snowfall.frustumCulled = false; scene.add(snowfall);
    this.trackGeometry.setAttribute("position", new THREE.BufferAttribute(this.trackPosition, 3)); this.trackGeometry.setDrawRange(0, 0);
    const tracks = new THREE.Mesh(this.trackGeometry, new THREE.MeshBasicMaterial({ color: 0x9fb8d6, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3 })); tracks.frustumCulled = false; tracks.renderOrder = 1; scene.add(tracks);
  }

  update(state: SimulationState, camera: THREE.Camera, dt: number, snowCount: number, wind: number) {
    if (state.events.reset) this.clearTracks();
    const speed = Math.hypot(state.vel.x, state.vel.z);
    if (this.quality > 0 && state.onGround && state.crash <= 0 && speed > 5) {
      const intensity = Math.min(1, state.carve * 1.5) * Math.min(1, speed / 20), count = Math.min(8, Math.floor((intensity * 7 + (speed > 26 ? 1 : 0)) * this.sprayDepthMultiplier));
      const fx = Math.sin(state.yaw), fz = Math.cos(state.yaw), rx = fz, rz = -fx, side = -Math.sign(state.lean || 0.001);
      for (let i = 0; i < count; i += 1) { const off = (this.random() - 0.5) * 0.9 + side * 0.35; this.emitSpray(state.pos.x + rx * off - fx * 0.8, state.pos.y + 0.08 + this.random() * 0.25, state.pos.z + rz * off - fz * 0.8, rx * side * (2 + intensity * 9) - fx * speed * 0.16 + (this.random() - 0.5) * 2, 1.4 + this.random() * 3.4 * (0.4 + intensity), rz * side * (2 + intensity * 9) - fz * speed * 0.16 + (this.random() - 0.5) * 2, 1.4 + this.random() * 2.4, 0.45 + this.random() * 0.5); }
    }
    this.updateSpray(dt); this.updateSnow(dt, state.time, camera.position, snowCount * (0.35 + this.quality * 0.1625) * this.densityScale(), wind); this.updateTracks(state);
  }

  setQuality(rung: QualityRung): void { this.quality = rung; }

  /**
   * The top rung buys a denser snowfall, but only on the node pipeline: the WebGL chain reaches
   * rung 4 on weaker hardware, where the extra particles are the wrong thing to spend the frame on.
   */
  densityScale(): number { return this.backendKind === "webgpu" && this.quality >= 4 ? 1.25 : 1; }

  private emitSpray(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number) { const i = this.sprayHead = (this.sprayHead + 1) % SPRAY_MAX, p = i * 3; this.sprayPosition[p] = x; this.sprayPosition[p + 1] = y; this.sprayPosition[p + 2] = z; this.sprayVelocity[p] = vx; this.sprayVelocity[p + 1] = vy; this.sprayVelocity[p + 2] = vz; this.sprayLife[i] = this.sprayMaxLife[i] = life; this.spraySize[i] = size; this.sprayAlpha[i] = 1; }
  private updateSpray(dt: number) {
    for (let i = 0; i < SPRAY_MAX; i += 1) {
      if (this.sprayLife[i] <= 0) { this.sprayAlpha[i] = 0; continue; }
      const p = i * 3;
      this.sprayLife[i] -= dt;
      this.sprayVelocity[p + 1] -= 7 * dt;
      this.sprayVelocity[p] *= 1 - 1.9 * dt;
      this.sprayVelocity[p + 2] *= 1 - 1.9 * dt;
      this.sprayPosition[p] += this.sprayVelocity[p] * dt;
      this.sprayPosition[p + 1] += this.sprayVelocity[p + 1] * dt;
      this.sprayPosition[p + 2] += this.sprayVelocity[p + 2] * dt;
      const k = Math.max(0, this.sprayLife[i] / this.sprayMaxLife[i]);
      this.sprayAlpha[i] = k * k * 0.9;
      this.spraySize[i] += dt * 2.2;
    }
    for (let a = 0; a < SPRAY_ATTRS.length; a += 1) this.sprayGeometry.getAttribute(SPRAY_ATTRS[a]).needsUpdate = true;
  }
  private updateSnow(dt: number, time: number, camera: THREE.Vector3, requested: number, wind: number) { const count = Math.min(this.reducedMotion ? 320 : SNOW_MAX, requested | 0), half = SNOW_BOX * 0.5; this.snowGeometry.setDrawRange(0, count); for (let i = 0; i < count; i += 1) { const p = i * 3; this.snowPosition[p + 1] -= (5.5 + this.snowSize[i] * 3.2) * dt; this.snowPosition[p] += Math.sin(time * 0.9 + this.snowSeed[i]) * 3.4 * dt + wind * dt; this.snowPosition[p + 2] += Math.cos(time * 0.7 + this.snowSeed[i]) * 2.2 * dt; const dx = this.snowPosition[p] - camera.x, dy = this.snowPosition[p + 1] - camera.y, dz = this.snowPosition[p + 2] - camera.z; if (dx > half) this.snowPosition[p] -= SNOW_BOX; else if (dx < -half) this.snowPosition[p] += SNOW_BOX; if (dz > half) this.snowPosition[p + 2] -= SNOW_BOX; else if (dz < -half) this.snowPosition[p + 2] += SNOW_BOX; if (dy < -20) this.snowPosition[p + 1] += SNOW_BOX * 0.8; else if (dy > SNOW_BOX * 0.7) this.snowPosition[p + 1] -= SNOW_BOX * 0.8; } this.snowGeometry.getAttribute("position").needsUpdate = true; }
  private updateTracks(state: SimulationState) {
    if (!state.onGround || state.crash > 0) { this.trackHasPrevious = false; return; }
    const fx = Math.sin(state.yaw), fz = Math.cos(state.yaw), rx = fz, rz = -fx, width = 0.42;
    const lx = state.pos.x - rx * width, lz = state.pos.z - rz * width;
    const nrx = state.pos.x + rx * width, nrz = state.pos.z + rz * width;
    if (!this.trackHasPrevious) {
      this.prevLx = lx; this.prevLz = lz; this.prevRx = nrx; this.prevRz = nrz;
      this.trackHasPrevious = true;
      return;
    }
    const moved = Math.hypot(state.pos.x - (this.prevLx + this.prevRx) * 0.5, state.pos.z - (this.prevLz + this.prevRz) * 0.5);
    if (moved <= 1.4) return;
    this.pushTrackQuad(this.prevLx, this.prevLz, this.prevRx, this.prevRz, lx, lz, nrx, nrz);
    this.prevLx = lx; this.prevLz = lz; this.prevRx = nrx; this.prevRz = nrz;
  }
  private writeTrackVertex(offset: number, x: number, z: number): void {
    this.trackPosition[offset] = x;
    this.trackPosition[offset + 1] = this.terrain.height(x, z) + 0.07;
    this.trackPosition[offset + 2] = z;
  }
  private pushTrackQuad(
    alx: number, alz: number, arx: number, arz: number,
    blx: number, blz: number, brx: number, brz: number,
  ): void {
    const offset = this.trackHead * 18;
    // Two triangles: (aL,aR,bL) and (aR,bR,bL) — unrolled so we never allocate a corners array.
    this.writeTrackVertex(offset, alx, alz);
    this.writeTrackVertex(offset + 3, arx, arz);
    this.writeTrackVertex(offset + 6, blx, blz);
    this.writeTrackVertex(offset + 9, arx, arz);
    this.writeTrackVertex(offset + 12, brx, brz);
    this.writeTrackVertex(offset + 15, blx, blz);
    this.trackHead = (this.trackHead + 1) % TRACK_QUADS;
    this.trackUsed = Math.min(this.trackUsed + 1, TRACK_QUADS);
    this.trackGeometry.setDrawRange(0, this.trackUsed * 6);
    this.trackGeometry.getAttribute("position").needsUpdate = true;
  }
  private clearTracks() {
    this.trackHead = 0; this.trackUsed = 0; this.trackHasPrevious = false;
    this.trackGeometry.setDrawRange(0, 0);
  }
}
