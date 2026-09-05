import * as THREE from "three";
import type { SimulationState, TerrainSampler } from "../core/types";
import { mulberry32 } from "../core/rng";
import type { QualityRung } from "./QualityController";
import type { NodeFactories } from "./nodeFactories";

const SPRAY_MAX = 900, SNOW_MAX = 3600, SNOW_BOX = 130, TRACK_QUADS = 4096;
const pointVertex = "attribute float aAlpha;attribute float aSize;uniform float uScale;varying float vA;void main(){vA=aAlpha;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=aSize*uScale/max(1.,-mv.z);gl_Position=projectionMatrix*mv;}";
const pointFragment = "uniform sampler2D uTex;uniform vec3 uColor;varying float vA;void main(){vec4 t=texture2D(uTex,gl_PointCoord);float a=t.a*vA;if(a<.012)discard;gl_FragColor=vec4(uColor,a);}";
/**
 * Attribute names re-uploaded every spray frame, preallocated because
 * `for (const name of [...])` would allocate one array per frame. Index 0 is the particle centre,
 * which the node path renames — see `centreAttr`.
 */
const SPRAY_ATTRS = ["position", "aAlpha", "aSize"];

function radialTexture(): THREE.DataTexture {
  const size = 32, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const distance = Math.hypot(x - 15.5, y - 15.5) / 16, alpha = Math.max(0, 1 - distance);
    const i = (y * size + x) * 4; data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = Math.round(alpha * alpha * 255);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat); texture.needsUpdate = true; texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

/** Tangent-space twin ski grooves: lighting changes across the compressed snow. */
export function buildTrackNormal(): THREE.DataTexture {
  const width = 128, data = new Uint8Array(width * 4);
  for (let x = 0; x < width; x++) {
    const u = x / (width - 1);
    let slope = 0;
    for (const center of [0.27, 0.73]) {
      const d = (u - center) / 0.065;
      slope += d * Math.exp(-d * d) * 0.5;
    }
    const length = Math.hypot(slope, 1);
    data[x * 4] = Math.round((slope / length * 0.5 + 0.5) * 255);
    data[x * 4 + 1] = 128;
    data[x * 4 + 2] = Math.round((1 / length * 0.5 + 0.5) * 255);
    data[x * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, width, 1);
  texture.magFilter = THREE.LinearFilter; texture.needsUpdate = true;
  return texture;
}

/** Only the two ~12 cm ski grooves cover snow; the ribbon center stays clear.
 * Alpha maps sample green, so store the mask in RGB rather than only alpha. */
export function buildTrackAlpha(): THREE.DataTexture {
  const width = 128, data = new Uint8Array(width * 4);
  for (let x = 0; x < width; x++) {
    const u = x / (width - 1);
    const distance = Math.min(Math.abs(u - 0.27), Math.abs(u - 0.73));
    const edge = Math.max(0, Math.min(1, (0.075 - distance) / 0.035));
    const alpha = Math.round(edge * edge * (3 - 2 * edge) * 255);
    data[x * 4] = data[x * 4 + 1] = data[x * 4 + 2] = alpha;
    data[x * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, width, 1);
  texture.magFilter = THREE.LinearFilter; texture.needsUpdate = true;
  return texture;
}

export class EffectsRenderer {
  private readonly random: () => number;
  private readonly sprayPosition = new Float32Array(SPRAY_MAX * 3); private readonly sprayVelocity = new Float32Array(SPRAY_MAX * 3);
  private readonly sprayLife = new Float32Array(SPRAY_MAX); private readonly sprayMaxLife = new Float32Array(SPRAY_MAX);
  private readonly sprayAlpha = new Float32Array(SPRAY_MAX); private readonly spraySize = new Float32Array(SPRAY_MAX); private readonly sprayGeometry: THREE.BufferGeometry;
  private readonly snowPosition = new Float32Array(SNOW_MAX * 3); private readonly snowAlpha = new Float32Array(SNOW_MAX); private readonly snowSize = new Float32Array(SNOW_MAX); private readonly snowSeed = new Float32Array(SNOW_MAX); private readonly snowGeometry: THREE.BufferGeometry;
  private readonly trackPosition = new Float32Array(TRACK_QUADS * 18); private readonly trackGeometry = new THREE.BufferGeometry();
  private readonly trackNormals = new Float32Array(TRACK_QUADS * 18);
  private readonly trackNormal = { x: 0, y: 1, z: 0 };
  private lastTime = 0;
  private sprayHead = 0; private trackHead = 0; private trackUsed = 0;
  /** Scalar track ring — avoids allocating a `{lx,lz,rx,rz}` object every ground frame. */
  private trackHasPrevious = false;
  private prevLx = 0; private prevLz = 0; private prevRx = 0; private prevRz = 0;
  private quality: QualityRung = 4;
  /** Attribute names to re-upload each frame; `sprayAttrs[0]` is always `centreAttr`. */
  private readonly sprayAttrs: string[];
  /**
   * Whichever attribute carries the particle centre on this backend: `position` for the WebGL
   * point cloud, `aCentre` for the instanced node quads, whose `position` is the quad corner.
   */
  private readonly centreAttr: string;

  /**
   * WebGPU renders `THREE.Points` as one-pixel `point-list` primitives, so the particles have to be
   * instanced quads there. Both variants read the same simulation arrays; only the attribute
   * carrying the particle centre is named differently, because the sprite path claims `position`.
   */
  private particleGeometry(centre: Float32Array, alpha: Float32Array, size: Float32Array): THREE.BufferGeometry {
    if (this.nodes) return this.nodes.particles.createParticleSpriteGeometry(centre, alpha, size);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(centre, 3));
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    return geometry;
  }

  private particleCloud(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Object3D {
    return this.nodes ? new THREE.Mesh(geometry, material) : new THREE.Points(geometry, material);
  }

  /** How many particles are drawn — instance count for quads, draw range for points. */
  private setVisibleParticles(geometry: THREE.BufferGeometry, count: number): void {
    if (this.nodes) (geometry as THREE.InstancedBufferGeometry).instanceCount = count;
    else geometry.setDrawRange(0, count);
  }

  private pointMaterial(color: number, scale: number): THREE.Material {
    if (this.nodes) return this.nodes.particles.createParticleNodeMaterial(this.nodes.particles.radialParticleTexture(), new THREE.Color(color), scale);
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
    /** Present exactly on the WebGPU path; see `nodeFactories`. */
    private readonly nodes: NodeFactories | null = null,
  ) {
    this.random = mulberry32(seed ^ 0x8e37a12d);
    this.centreAttr = nodes ? nodes.particles.PARTICLE_CENTRE : SPRAY_ATTRS[0];
    this.sprayAttrs = [this.centreAttr, SPRAY_ATTRS[1], SPRAY_ATTRS[2]];
    this.sprayGeometry = this.particleGeometry(this.sprayPosition, this.sprayAlpha, this.spraySize);
    const sprayMaterial = this.pointMaterial(0xf7fbff, 620);
    const spray = this.particleCloud(this.sprayGeometry, sprayMaterial); spray.frustumCulled = false; scene.add(spray);
    for (let i = 0; i < SNOW_MAX; i += 1) { this.snowPosition[i * 3] = (this.random() - 0.5) * SNOW_BOX; this.snowPosition[i * 3 + 1] = this.random() * SNOW_BOX * 0.7; this.snowPosition[i * 3 + 2] = (this.random() - 0.5) * SNOW_BOX; this.snowAlpha[i] = 0.55 + this.random() * 0.45; this.snowSize[i] = 0.5 + this.random() * 1.5; this.snowSeed[i] = this.random() * Math.PI * 2; }
    this.snowGeometry = this.particleGeometry(this.snowPosition, this.snowAlpha, this.snowSize);
    const snowMaterial = this.pointMaterial(0xffffff, 240);
    const snowfall = this.particleCloud(this.snowGeometry, snowMaterial); snowfall.frustumCulled = false; scene.add(snowfall);
    this.trackGeometry.setAttribute("position", new THREE.BufferAttribute(this.trackPosition, 3)); this.trackGeometry.setDrawRange(0, 0);
    this.trackGeometry.setAttribute("normal", new THREE.BufferAttribute(this.trackNormals, 3));
    const uvs = new Float32Array(TRACK_QUADS * 12);
    for (let i = 0; i < TRACK_QUADS; i++) uvs.set([0,0,1,0,0,1,1,0,1,1,0,1], i * 12);
    this.trackGeometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    const tracks = new THREE.Mesh(this.trackGeometry, new THREE.MeshStandardMaterial({ color: 0xf7faff, normalMap: buildTrackNormal(), alphaMap: buildTrackAlpha(), roughness: 0.9, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3 })); tracks.frustumCulled = false; tracks.renderOrder = 1; scene.add(tracks);
  }

  update(state: SimulationState, camera: THREE.Camera, dt: number, snowCount: number, wind: number) {
    if (state.time < this.lastTime) this.clearTracks();
    this.lastTime = state.time;
    const speed = Math.hypot(state.vel.x, state.vel.z);
    if (this.quality > 0 && state.onGround && state.crash <= 0 && speed > 5) {
      const intensity = Math.min(1, state.carve * 1.5) * Math.min(1, speed / 20), count = Math.min(8, Math.floor((intensity * 7 + (speed > 26 ? 1 : 0)) * this.sprayDepthMultiplier));
      const fx = Math.sin(state.yaw), fz = Math.cos(state.yaw), rx = fz, rz = -fx, side = -Math.sign(state.lean || 0.001);
      for (let i = 0; i < count; i += 1) { const off = (this.random() - 0.5) * 0.9 + side * 0.35; this.emitSpray(state.pos.x + rx * off - fx * 0.8, state.pos.y + 0.08 + this.random() * 0.25, state.pos.z + rz * off - fz * 0.8, rx * side * (2 + intensity * 9) - fx * speed * 0.16 + (this.random() - 0.5) * 2, 1.4 + this.random() * 3.4 * (0.4 + intensity), rz * side * (2 + intensity * 9) - fz * speed * 0.16 + (this.random() - 0.5) * 2, 0.12 + this.random() * 0.26, 0.32 + this.random() * 0.4); }
    }
    this.updateSpray(dt); this.updateSnow(dt, state.time, camera.position, snowCount * (0.35 + this.quality * 0.1625) * this.densityScale(), wind); this.updateTracks(state);
  }

  setQuality(rung: QualityRung): void { this.quality = rung; }

  /**
   * The top rung buys a denser snowfall, but only on the node pipeline: the WebGL chain reaches
   * rung 4 on weaker hardware, where the extra particles are the wrong thing to spend the frame on.
   */
  densityScale(): number { return this.nodes !== null && this.quality >= 4 ? 1.25 : 1; }

  private emitSpray(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number) { const i = this.sprayHead = (this.sprayHead + 1) % SPRAY_MAX, p = i * 3; this.sprayPosition[p] = x; this.sprayPosition[p + 1] = y; this.sprayPosition[p + 2] = z; this.sprayVelocity[p] = vx; this.sprayVelocity[p + 1] = vy; this.sprayVelocity[p + 2] = vz; this.sprayLife[i] = this.sprayMaxLife[i] = life; this.spraySize[i] = size; this.sprayAlpha[i] = 1; }
  private updateSpray(dt: number) {
    for (let i = 0; i < SPRAY_MAX; i += 1) {
      if (this.sprayLife[i] <= 0) { this.sprayAlpha[i] = 0; continue; }
      const p = i * 3;
      this.sprayLife[i] -= dt;
      this.sprayVelocity[p + 1] -= 9.81 * dt;
      this.sprayVelocity[p] *= 1 - 1.9 * dt;
      this.sprayVelocity[p + 2] *= 1 - 1.9 * dt;
      this.sprayPosition[p] += this.sprayVelocity[p] * dt;
      this.sprayPosition[p + 1] += this.sprayVelocity[p + 1] * dt;
      this.sprayPosition[p + 2] += this.sprayVelocity[p + 2] * dt;
      const k = Math.max(0, this.sprayLife[i] / this.sprayMaxLife[i]);
      this.sprayAlpha[i] = k * k * 0.9;
      this.spraySize[i] *= 1 - dt * 0.25;
    }
    for (let a = 0; a < this.sprayAttrs.length; a += 1) this.sprayGeometry.getAttribute(this.sprayAttrs[a]).needsUpdate = true;
  }
  private updateSnow(dt: number, time: number, camera: THREE.Vector3, requested: number, wind: number) { const count = Math.min(this.reducedMotion ? 320 : SNOW_MAX, requested | 0), half = SNOW_BOX * 0.5; this.setVisibleParticles(this.snowGeometry, count); for (let i = 0; i < count; i += 1) { const p = i * 3; this.snowPosition[p + 1] -= (5.5 + this.snowSize[i] * 3.2) * dt; this.snowPosition[p] += Math.sin(time * 0.9 + this.snowSeed[i]) * 3.4 * dt + wind * dt; this.snowPosition[p + 2] += Math.cos(time * 0.7 + this.snowSeed[i]) * 2.2 * dt; const dx = this.snowPosition[p] - camera.x, dy = this.snowPosition[p + 1] - camera.y, dz = this.snowPosition[p + 2] - camera.z; if (dx > half) this.snowPosition[p] -= SNOW_BOX; else if (dx < -half) this.snowPosition[p] += SNOW_BOX; if (dz > half) this.snowPosition[p + 2] -= SNOW_BOX; else if (dz < -half) this.snowPosition[p + 2] += SNOW_BOX; if (dy < -20) this.snowPosition[p + 1] += SNOW_BOX * 0.8; else if (dy > SNOW_BOX * 0.7) this.snowPosition[p + 1] -= SNOW_BOX * 0.8; } this.snowGeometry.getAttribute(this.centreAttr).needsUpdate = true; }
  private updateTracks(state: SimulationState) {
    if (!state.onGround || state.crash > 0 || state.liftRide > 0) { this.trackHasPrevious = false; return; }
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
    this.trackPosition[offset + 1] = this.terrain.height(x, z) + 0.025;
    this.trackPosition[offset + 2] = z;
    this.terrain.normal(x, z, this.trackNormal);
    this.trackNormals[offset] = this.trackNormal.x;
    this.trackNormals[offset + 1] = this.trackNormal.y;
    this.trackNormals[offset + 2] = this.trackNormal.z;
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
    this.trackGeometry.getAttribute("normal").needsUpdate = true;
  }
  private clearTracks() {
    this.trackHead = 0; this.trackUsed = 0; this.trackHasPrevious = false;
    this.trackGeometry.setDrawRange(0, 0);
  }
}
