/**
 * lib/descent/render/TerrainMesh.ts
 * ─────────────────────────────────
 * The mountain, as chunked flat-shaded geometry sampled from the real DEM.
 *
 * The bake box is cut into 256 m chunks. Every chunk is built once at the
 * coarsest level at load (so the whole box is always drawn), and the chunks
 * near the rider are rebuilt at finer levels on demand — nearest first, a
 * couple per frame so a fast descent never hitches. Each chunk carries a
 * skirt (a strip of vertices dropped below the surface along its edge) so a
 * fine chunk beside a coarse one shows no crack.
 *
 * Vertex colours carry the look: snow (with a faint cool tint in the shade
 * of steep faces), a warmer, brighter tone on groomed corridors, and rock on
 * faces too steep to hold snow. Lighting and the flat-shaded normals do the
 * rest; there are no textures.
 */

import * as THREE from "three";
import { createGridSample, sampleGridBicubic, type GridSample } from "@/lib/game/terrain/bicubic";
import type { World } from "../types";
import type { RenderFrame, RenderModule } from "./frame";

export const CHUNK_M = 256;
/** Vertex spacing per level of detail, metres. */
const LOD_STEP = [2, 4, 8, 16, 32] as const;
/** A chunk closer than this (metres, to its nearest edge) gets at least that level. */
const LOD_RADIUS = [200, 520, 1100, 2400] as const;
const SKIRT_DEPTH_M = 8;
const BUILDS_PER_FRAME = 2;

const SNOW = new THREE.Color(0xeef2f7);
const SNOW_SHADE = new THREE.Color(0xd3dfee);
const CORRIDOR = new THREE.Color(0xf8f9fc);
const ROCK = new THREE.Color(0x6f6c68);
const ROCK_DARK = new THREE.Color(0x4a4744);
const SCREE = new THREE.Color(0x9a948d);

function hash2(x: number, z: number): number {
  const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

interface Chunk {
  cx: number;
  cz: number;
  lod: number;
  mesh: THREE.Mesh | null;
  /** Distance from the focus point to the chunk's nearest edge, metres. */
  distance: number;
  /** The level this chunk should be at, given the current focus. */
  wanted: number;
}

export class TerrainMesh implements RenderModule {
  readonly group = new THREE.Group();
  private readonly material: THREE.MeshStandardMaterial;
  private readonly chunks: Chunk[] = [];
  private readonly perSide: number;
  private readonly sample: GridSample = createGridSample();
  private readonly color = new THREE.Color();
  private focusX = NaN;
  private focusZ = NaN;
  private queue: Chunk[] = [];

  constructor(private readonly scene: THREE.Scene, private readonly world: World) {
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.9,
      metalness: 0,
    });
    this.perSide = Math.ceil((world.halfSizeM * 2) / CHUNK_M);
    for (let cz = 0; cz < this.perSide; cz++) {
      for (let cx = 0; cx < this.perSide; cx++) {
        this.chunks.push({ cx, cz, lod: -1, mesh: null, distance: Infinity, wanted: LOD_STEP.length - 1 });
      }
    }
    // The whole box at the coarsest level, synchronously: ~80 vertices a chunk.
    for (const chunk of this.chunks) this.build(chunk, LOD_STEP.length - 1);
    scene.add(this.group);
  }

  /** Move the level-of-detail focus (normally the rider, or the menu camera target). */
  private refocus(x: number, z: number): void {
    if (Math.abs(x - this.focusX) < 24 && Math.abs(z - this.focusZ) < 24) return;
    this.focusX = x; this.focusZ = z;
    const half = this.world.halfSizeM;
    const queue: Chunk[] = [];
    for (const chunk of this.chunks) {
      const x0 = -half + chunk.cx * CHUNK_M, z0 = -half + chunk.cz * CHUNK_M;
      const dx = Math.max(x0 - x, 0, x - (x0 + CHUNK_M));
      const dz = Math.max(z0 - z, 0, z - (z0 + CHUNK_M));
      chunk.distance = Math.hypot(dx, dz);
      let wanted = LOD_STEP.length - 1;
      for (let level = 0; level < LOD_RADIUS.length; level++) {
        if (chunk.distance < LOD_RADIUS[level]) { wanted = level; break; }
      }
      chunk.wanted = wanted;
      if (chunk.lod !== wanted) queue.push(chunk);
    }
    // Finer, nearer work first; coarsening far chunks can wait.
    queue.sort((a, b) => (a.wanted - b.wanted) || (a.distance - b.distance));
    this.queue = queue;
  }

  update(frame: RenderFrame): void {
    const s = frame.state;
    this.refocus(s.x, s.z);
    let budget = frame.quality === 2 ? 1 : BUILDS_PER_FRAME;
    while (budget > 0 && this.queue.length > 0) {
      const chunk = this.queue.shift()!;
      if (chunk.lod === chunk.wanted) continue;
      this.build(chunk, chunk.wanted);
      budget -= 1;
    }
  }

  /** Force every queued rebuild now (used once before the first frame). */
  flush(x: number, z: number): void {
    this.focusX = NaN;
    this.refocus(x, z);
    while (this.queue.length > 0) {
      const chunk = this.queue.shift()!;
      if (chunk.lod !== chunk.wanted) this.build(chunk, chunk.wanted);
    }
  }

  private build(chunk: Chunk, lod: number): void {
    const step = LOD_STEP[lod];
    const segments = CHUNK_M / step;
    const half = this.world.halfSizeM;
    const x0 = -half + chunk.cx * CHUNK_M;
    const z0 = -half + chunk.cz * CHUNK_M;
    const field = this.world.terrain.field;
    const cell = field.cellSizeM;
    const trailField = this.world.terrain.trailField;
    const n = segments + 1;
    // Interior grid plus a skirt ring: the skirt duplicates the edge vertices dropped by SKIRT_DEPTH_M.
    const interior = n * n;
    const skirtCount = 4 * segments;
    const vertexCount = interior + skirtCount;
    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    const sample = this.sample;
    const color = this.color;

    let v = 0;
    for (let j = 0; j < n; j++) {
      const z = z0 + j * step;
      for (let i = 0; i < n; i++) {
        const x = x0 + i * step;
        sampleGridBicubic(field, (x + half) / cell, (z + half) / cell, sample);
        const y = sample.value;
        positions[v * 3] = x; positions[v * 3 + 1] = y; positions[v * 3 + 2] = z;
        // Slope grade from the bicubic gradient; corridor membership from the run index.
        const grade = Math.hypot(sample.dCol, sample.dRow) / cell;
        const corridor = lod <= 2 ? trailField(x, z) : 0;
        this.shade(color, grade, corridor, y);
        // A whisper of per-vertex grain so speed reads on open snow (facets shimmer as they pass).
        const grain = lod <= 1 ? 0.97 + 0.05 * hash2(x, z) : 1;
        colors[v * 3] = color.r * grain; colors[v * 3 + 1] = color.g * grain; colors[v * 3 + 2] = color.b * grain;
        v += 1;
      }
    }
    // Skirt vertices: walk the four edges, copying the edge vertex and dropping it.
    const edgeIndex: number[] = [];
    for (let i = 0; i < segments; i++) edgeIndex.push(i);                       // north edge, west→east
    for (let j = 0; j < segments; j++) edgeIndex.push(j * n + (n - 1));         // east edge, north→south
    for (let i = segments; i > 0; i--) edgeIndex.push((n - 1) * n + i);         // south edge, east→west
    for (let j = segments; j > 0; j--) edgeIndex.push(j * n);                   // west edge, south→north
    for (let k = 0; k < skirtCount; k++) {
      const src = edgeIndex[k];
      positions[v * 3] = positions[src * 3];
      positions[v * 3 + 1] = positions[src * 3 + 1] - SKIRT_DEPTH_M;
      positions[v * 3 + 2] = positions[src * 3 + 2];
      colors[v * 3] = colors[src * 3] * 0.85; colors[v * 3 + 1] = colors[src * 3 + 1] * 0.85; colors[v * 3 + 2] = colors[src * 3 + 2] * 0.85;
      v += 1;
    }

    const indexCount = segments * segments * 6 + skirtCount * 6;
    const indices = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
    let t = 0;
    for (let j = 0; j < segments; j++) {
      for (let i = 0; i < segments; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        // Alternate the diagonal so flat shading reads as facets, not stripes.
        if ((i + j) & 1) { indices[t++] = a; indices[t++] = c; indices[t++] = b; indices[t++] = b; indices[t++] = c; indices[t++] = d; }
        else { indices[t++] = a; indices[t++] = c; indices[t++] = d; indices[t++] = a; indices[t++] = d; indices[t++] = b; }
      }
    }
    for (let k = 0; k < skirtCount; k++) {
      const next = (k + 1) % skirtCount;
      const top0 = edgeIndex[k], top1 = edgeIndex[next];
      const bottom0 = interior + k, bottom1 = interior + next;
      indices[t++] = top0; indices[t++] = bottom0; indices[t++] = top1;
      indices[t++] = top1; indices[t++] = bottom0; indices[t++] = bottom1;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeBoundingSphere();

    if (chunk.mesh) {
      chunk.mesh.geometry.dispose();
      chunk.mesh.geometry = geometry;
    } else {
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = true;
      chunk.mesh = mesh;
      this.group.add(mesh);
    }
    chunk.mesh.receiveShadow = lod <= 1;
    chunk.lod = lod;
  }

  private shade(out: THREE.Color, grade: number, corridor: number, elevation: number): void {
    // Snow, cooled a touch on steep faces (they read as shaded even in flat light).
    const steep = Math.min(1, Math.max(0, (grade - 0.35) / 0.6));
    out.copy(SNOW).lerp(SNOW_SHADE, steep * 0.6);
    if (corridor > 0) out.lerp(CORRIDOR, corridor);
    // Rock where snow can't hold: grade ≳ 1.0 (45°), fully rock by ≈ 1.5 (56°).
    const rock = Math.min(1, Math.max(0, (grade - 0.95) / 0.55));
    if (rock > 0) {
      const aboveTreeline = this.world.treeLineM > 0 && elevation > this.world.treeLineM;
      out.lerp(aboveTreeline ? ROCK : ROCK_DARK, rock);
      if (rock > 0.5 && ((elevation * 7.31) % 1) > 0.6) out.lerp(SCREE, 0.25);
    }
  }

  dispose(): void {
    for (const chunk of this.chunks) chunk.mesh?.geometry.dispose();
    this.material.dispose();
    this.scene.remove(this.group);
  }
}
