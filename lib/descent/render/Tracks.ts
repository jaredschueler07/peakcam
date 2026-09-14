/**
 * lib/descent/render/Tracks.ts
 * ────────────────────────────
 * The snow keeps your tracks. Two thin ribbons — one per ski — are extended
 * behind the rider every few decimetres of travel while the skis are on the
 * snow, in a ring buffer of quads. Powder leaves a wider, brighter wake on
 * top; a skid (brake) widens and darkens the strip. Nothing is allocated
 * after construction: the buffers are sized once and overwritten.
 */

import * as THREE from "three";
import type { World } from "../types";
import type { RenderFrame, RenderModule } from "./frame";

const MAX_SEGMENTS = 9000;
const SPACING_M = 0.45;
const SKI_HALF_GAP = 0.19;
const SKI_HALF_WIDTH = 0.055;
const LIFT_M = 0.035;

class Ribbon {
  readonly mesh: THREE.Mesh;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private head = 0;
  private count = 0;
  private hasLast = false;
  private readonly last = { lx: 0, ly: 0, lz: 0, rx: 0, ry: 0, rz: 0 };

  constructor(scene: THREE.Scene, private readonly maxSegments: number, color: number, opacity: number, renderOrder: number) {
    const vertexCount = maxSegments * 4;
    this.positions = new Float32Array(vertexCount * 3);
    this.colors = new Float32Array(vertexCount * 3);
    const indices = new Uint32Array(maxSegments * 6);
    for (let i = 0; i < maxSegments; i++) {
      const v = i * 4;
      indices[i * 6] = v; indices[i * 6 + 1] = v + 2; indices[i * 6 + 2] = v + 1;
      indices[i * 6 + 3] = v + 1; indices[i * 6 + 4] = v + 2; indices[i * 6 + 5] = v + 3;
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.geometry.setDrawRange(0, 0);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const material = new THREE.MeshBasicMaterial({
      color, vertexColors: true, transparent: true, opacity, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    scene.add(this.mesh);
  }

  break(): void { this.hasLast = false; }

  /** Extend the ribbon to a new left/right edge pair. */
  push(lx: number, ly: number, lz: number, rx: number, ry: number, rz: number, shade: number): void {
    if (!this.hasLast) {
      this.last.lx = lx; this.last.ly = ly; this.last.lz = lz; this.last.rx = rx; this.last.ry = ry; this.last.rz = rz;
      this.hasLast = true;
      return;
    }
    const v = this.head * 4;
    const p = this.positions, c = this.colors;
    const l = this.last;
    p[v * 3] = l.lx; p[v * 3 + 1] = l.ly; p[v * 3 + 2] = l.lz;
    p[v * 3 + 3] = l.rx; p[v * 3 + 4] = l.ry; p[v * 3 + 5] = l.rz;
    p[v * 3 + 6] = lx; p[v * 3 + 7] = ly; p[v * 3 + 8] = lz;
    p[v * 3 + 9] = rx; p[v * 3 + 10] = ry; p[v * 3 + 11] = rz;
    for (let k = 0; k < 4; k++) { c[(v + k) * 3] = shade; c[(v + k) * 3 + 1] = shade; c[(v + k) * 3 + 2] = shade; }
    l.lx = lx; l.ly = ly; l.lz = lz; l.rx = rx; l.ry = ry; l.rz = rz;
    this.head = (this.head + 1) % this.maxSegments;
    this.count = Math.min(this.maxSegments, this.count + 1);
    const position = this.geometry.getAttribute("position") as THREE.BufferAttribute;
    const color = this.geometry.getAttribute("color") as THREE.BufferAttribute;
    position.needsUpdate = true; color.needsUpdate = true;
    this.geometry.setDrawRange(0, this.count * 6);
  }

  clear(): void { this.head = 0; this.count = 0; this.hasLast = false; this.geometry.setDrawRange(0, 0); }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

export class Tracks implements RenderModule {
  private readonly left: Ribbon;
  private readonly right: Ribbon;
  private readonly wake: Ribbon;
  private lastX = NaN;
  private lastZ = NaN;

  constructor(private readonly scene: THREE.Scene, private readonly world: World) {
    this.left = new Ribbon(scene, MAX_SEGMENTS, 0xffffff, 0.55, 2);
    this.right = new Ribbon(scene, MAX_SEGMENTS, 0xffffff, 0.55, 2);
    this.wake = new Ribbon(scene, MAX_SEGMENTS, 0xffffff, 0.35, 1);
  }

  clear(): void { this.left.clear(); this.right.clear(); this.wake.clear(); this.lastX = NaN; }

  update(frame: RenderFrame): void {
    const s = frame.state;
    if (!s.onGround || s.liftIndex >= 0 || s.crash > 0 || s.speed < 0.6) {
      this.left.break(); this.right.break(); this.wake.break();
      this.lastX = NaN;
      return;
    }
    const moved = Number.isNaN(this.lastX) ? Infinity : Math.hypot(s.x - this.lastX, s.z - this.lastZ);
    if (moved < SPACING_M) return;
    if (moved > 12) { this.left.break(); this.right.break(); this.wake.break(); }
    this.lastX = s.x; this.lastZ = s.z;

    // Ski side vector from the ski heading; skid widens the strip.
    const sx = Math.cos(s.yaw), sz = -Math.sin(s.yaw);
    const skid = Math.min(1, Math.abs(Math.atan2(Math.sin(s.travelYaw - s.yaw), Math.cos(s.travelYaw - s.yaw))) / 0.8);
    const halfWidth = SKI_HALF_WIDTH + skid * 0.12 + (s.braking ? 0.05 : 0);
    const powder = s.surface === "powder" ? 1 : s.surface === "slush" ? 0.5 : 0;
    // Darker in a skid (churned snow), faint on groomed.
    const shade = 0.78 - skid * 0.18 - (s.braking ? 0.08 : 0) + powder * 0.1;
    const h = this.world.terrain;

    this.edge(this.left, s, sx, sz, -SKI_HALF_GAP, halfWidth, shade, h);
    this.edge(this.right, s, sx, sz, SKI_HALF_GAP, halfWidth, shade, h);
    if (powder > 0) {
      const w = 0.55 + skid * 0.5;
      const lx = s.x - sx * w, lz = s.z - sz * w, rx = s.x + sx * w, rz = s.z + sz * w;
      this.wake.push(lx, h.height(lx, lz) + LIFT_M * 0.5, lz, rx, h.height(rx, rz) + LIFT_M * 0.5, rz, 0.96);
    } else {
      this.wake.break();
    }
  }

  private edge(ribbon: Ribbon, s: RenderFrame["state"], sx: number, sz: number, offset: number, halfWidth: number, shade: number, h: World["terrain"]): void {
    const cx = s.x + sx * offset, cz = s.z + sz * offset;
    const lx = cx - sx * halfWidth, lz = cz - sz * halfWidth;
    const rx = cx + sx * halfWidth, rz = cz + sz * halfWidth;
    ribbon.push(lx, h.height(lx, lz) + LIFT_M, lz, rx, h.height(rx, rz) + LIFT_M, rz, shade);
  }

  dispose(): void {
    this.left.dispose(this.scene); this.right.dispose(this.scene); this.wake.dispose(this.scene);
  }
}
