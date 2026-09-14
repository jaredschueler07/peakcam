/**
 * lib/descent/render/Lanes.ts
 * ───────────────────────────
 * A faint translucent lane draped down every named run, so the trail map is
 * legible on the snow itself: green / blue / black / orange by difficulty,
 * solid on the centreline and fading to nothing at the corridor edge. Every
 * run is one ribbon in a single merged geometry — one draw call for the
 * whole resort. The line being ridden is drawn a little stronger; switching
 * course only rewrites that run's alpha range.
 */

import * as THREE from "three";
import type { DrapedRun } from "@/lib/game/terrain/real-heightfield";
import type { World } from "../types";
import type { RenderFrame, RenderModule } from "./frame";

const SAMPLE_M = 5;
const LIFT_M = 0.3;
const MIN_HALF_WIDTH = 4;
const MAX_HALF_WIDTH = 11;
const OPACITY_DARK = 0.09;
const OPACITY_COLOUR = 0.12;
const SELECTED_BOOST = 1.6;

const GRADE_COLOURS: Record<string, number> = {
  easy: 0x5fd89a, novice: 0x5fd89a,
  intermediate: 0x6fb4ff,
  advanced: 0x1b2230, expert: 0x1b2230,
  extreme: 0xffb35c, freeride: 0xffb35c,
};
const UNKNOWN_COLOUR = 0x9aa8bd;

function laneColour(difficulty: string | null): { hex: number; opacity: number } {
  const key = difficulty?.toLowerCase() ?? "";
  const hex = GRADE_COLOURS[key] ?? UNKNOWN_COLOUR;
  const dark = hex === 0x1b2230;
  return { hex, opacity: dark ? OPACITY_DARK : OPACITY_COLOUR };
}

const VERTEX = /* glsl */ `
  attribute float alpha;
  varying vec3 vColor;
  varying float vAlpha;
  #include <fog_pars_vertex>
  void main() {
    vColor = color;
    vAlpha = alpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vAlpha;
  #include <fog_pars_fragment>
  void main() {
    gl_FragColor = vec4(vColor, vAlpha * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

interface RibbonRange {
  runId: string | undefined;
  /** Vertex range [start, end) in the merged geometry. */
  start: number;
  end: number;
  opacity: number;
}

export class Lanes implements RenderModule {
  private readonly mesh: THREE.Mesh | null = null;
  private readonly geometry: THREE.BufferGeometry | null = null;
  private readonly material: THREE.ShaderMaterial | null = null;
  private readonly ranges: RibbonRange[] = [];
  /** Centre-weight (1 at centreline → 0 at edge) per vertex, before opacity. */
  private readonly weights: Float32Array;
  private selectedIndex = -1;

  constructor(private readonly scene: THREE.Scene, private readonly world: World) {
    const positions: number[] = [];
    const colors: number[] = [];
    const alphas: number[] = [];
    const indices: number[] = [];
    const colour = new THREE.Color();

    for (const run of world.terrain.runs) {
      if (run.points.length < 2) continue;
      const { hex, opacity } = laneColour(run.difficulty);
      colour.setHex(hex);
      const start = positions.length / 3;
      this.appendRibbon(run, colour, opacity, positions, colors, alphas, indices);
      const end = positions.length / 3;
      if (end > start) this.ranges.push({ runId: run.id, start, end, opacity });
    }

    this.weights = new Float32Array(alphas.length);
    for (let i = 0; i < alphas.length; i++) this.weights[i] = alphas[i];
    for (const range of this.ranges) {
      for (let i = range.start; i < range.end; i++) alphas[i] = this.weights[i] * range.opacity;
    }
    if (positions.length === 0) return;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute("alpha", new THREE.Float32BufferAttribute(alphas, 1));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();

    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uOpacity: { value: 1 } }]),
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
      fog: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 1;
    mesh.frustumCulled = true;
    this.mesh = mesh;
    this.geometry = geometry;
    this.material = material;
    this.scene.add(mesh);
  }

  /** Three vertices (left edge, centre, right edge) per sample; four triangles per step. */
  private appendRibbon(
    run: DrapedRun, colour: THREE.Color, _opacity: number,
    positions: number[], colors: number[], alphas: number[], indices: number[],
  ): void {
    const halfWidth = Math.min(MAX_HALF_WIDTH, Math.max(MIN_HALF_WIDTH, run.halfWidthM));
    const height = (x: number, z: number) => this.world.terrain.height(x, z) + LIFT_M;
    const pts = run.points;
    let sampleCount = 0;
    const base = positions.length / 3;

    const emit = (x: number, z: number, hx: number, hz: number) => {
      // hx/hz: unit heading; perpendicular is (cos, -sin) in the (x, z) plane.
      const px = hz, pz = -hx;
      const lx = x - px * halfWidth, lz = z - pz * halfWidth;
      const rx = x + px * halfWidth, rz = z + pz * halfWidth;
      positions.push(lx, height(lx, lz), lz, x, height(x, z), z, rx, height(rx, rz), rz);
      for (let i = 0; i < 3; i++) colors.push(colour.r, colour.g, colour.b);
      alphas.push(0, 1, 0);
      sampleCount += 1;
    };

    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const dx = b.x - a.x, dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      if (length < 1e-3) continue;
      const hx = dx / length, hz = dz / length;
      const steps = Math.max(1, Math.ceil(length / SAMPLE_M));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        emit(a.x + dx * t, a.z + dz * t, hx, hz);
      }
      if (i === pts.length - 1) emit(b.x, b.z, hx, hz);
    }

    for (let s = 1; s < sampleCount; s++) {
      const p = base + (s - 1) * 3, q = base + s * 3;
      // left strip
      indices.push(p, q, p + 1, q, q + 1, p + 1);
      // right strip
      indices.push(p + 1, q + 1, p + 2, q + 1, q + 2, p + 2);
    }
  }

  private applySelection(courseIndex: number): void {
    if (!this.geometry) return;
    const alpha = this.geometry.getAttribute("alpha") as THREE.BufferAttribute;
    const array = alpha.array as Float32Array;
    const selectedId = this.world.courses[courseIndex]?.id;
    const previousId = this.world.courses[this.selectedIndex]?.id;
    let touched = false;
    for (const range of this.ranges) {
      const isSelected = range.runId !== undefined && range.runId === selectedId;
      const wasSelected = range.runId !== undefined && range.runId === previousId;
      if (!isSelected && !wasSelected) continue;
      const opacity = Math.min(0.3, range.opacity * (isSelected ? SELECTED_BOOST : 1));
      for (let i = range.start; i < range.end; i++) array[i] = this.weights[i] * opacity;
      touched = true;
    }
    if (touched) alpha.needsUpdate = true;
    this.selectedIndex = courseIndex;
  }

  update(frame: RenderFrame): void {
    if (frame.courseIndex !== this.selectedIndex) this.applySelection(frame.courseIndex);
  }

  dispose(): void {
    if (this.mesh) this.scene.remove(this.mesh);
    this.geometry?.dispose();
    this.material?.dispose();
    this.ranges.length = 0;
  }
}
