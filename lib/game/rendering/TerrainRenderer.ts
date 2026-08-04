import * as THREE from "three";
import { clamp01, smoothstep } from "../core/math";
import type { SimulationWorld, TerrainSampler } from "../core/types";
import { fbm, vnoise } from "../terrain/noise";
import { GRID_HALF, GRID_SIZE, TILE_SIZE, Z_TILES_BEHIND } from "./nearFieldReach";
import { buildSnowDetailNormal, polishSnowMaterial, type SnowUniforms } from "./SnowMaterial";
import type { SnowNodeUniforms } from "./SnowNodeMaterial";
import type { NodeFactories } from "./nodeFactories";
import type { QualityRung } from "./QualityController";
import type { SurfaceTextures } from "./surfaceTextures";

// The grid's dimensions live in `nearFieldReach.ts`, which also derives how far a near-field
// pixel can be from the player — a number `fogCurve.ts` needs to place its long-range envelope
// outside the near field, and which must therefore not exist as a second copy here.
export { TILE_SIZE, GRID_SIZE, Z_TILES_BEHIND } from "./nearFieldReach";
export const TILE_RESOLUTION = 50;
const CELL_SIZE = TILE_SIZE / TILE_RESOLUTION;
const SUN_DIR = new THREE.Vector3(-0.46, 0.62, -0.64).normalize();
const C_SNOW = new THREE.Color(0.955, 0.975, 1);
const C_SHADE = new THREE.Color(0.66, 0.76, 0.92);
const C_ROCK = new THREE.Color(0.29, 0.30, 0.335);
const C_ROCK2 = new THREE.Color(0.44, 0.43, 0.44);
const C_GROOM = new THREE.Color(0.90, 0.945, 1);
const C_ICE = new THREE.Color(0.74, 0.87, 0.97);
const colorScratch = new THREE.Color();

interface Tile { mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>; x: number; z: number }

export function buildTileGeometry(terrain: TerrainSampler, ix: number, iz: number): THREE.BufferGeometry {
  const n = TILE_RESOLUTION + 1;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(n * n * 3);
  const normals = new Float32Array(n * n * 3);
  const colors = new Float32Array(n * n * 3);
  const indices = new Uint32Array(TILE_RESOLUTION * TILE_RESOLUTION * 6);
  const ox = ix * TILE_SIZE, oz = iz * TILE_SIZE;
  const paddedSize = TILE_RESOLUTION + 3;
  const paddedHeights = new Float32Array(paddedSize * paddedSize);
  for (let j = 0; j < paddedSize; j += 1) {
    for (let i = 0; i < paddedSize; i += 1) {
      paddedHeights[j * paddedSize + i] = terrain.height(ox + (i - 1) * CELL_SIZE, oz + (j - 1) * CELL_SIZE);
    }
  }
  let at = 0;
  for (let j = 0; j < n; j += 1) {
    const worldZ = oz + j * CELL_SIZE;
    for (let i = 0; i < n; i += 1) {
      const worldX = ox + i * CELL_SIZE;
      const p = (j * n + i) * 3;
      const sample = (j + 1) * paddedSize + i + 1;
      const height = paddedHeights[sample];
      let nx = (paddedHeights[sample - 1] - paddedHeights[sample + 1]) / (2 * CELL_SIZE);
      let ny = 1;
      let nz = (paddedHeights[sample - paddedSize] - paddedHeights[sample + paddedSize]) / (2 * CELL_SIZE);
      const inverseLength = 1 / Math.hypot(nx, ny, nz);
      nx *= inverseLength; ny *= inverseLength; nz *= inverseLength;
      positions[p] = i * CELL_SIZE; positions[p + 1] = height; positions[p + 2] = j * CELL_SIZE;
      normals[p] = nx; normals[p + 1] = ny; normals[p + 2] = nz;

      const steep = clamp01((1 - ny) * 2.55);
      const groomed = terrain.trailField(worldX, worldZ);
      const grain = fbm(worldX * 0.021, worldZ * 0.021, 2);
      const sparkle = vnoise(worldX * 0.55, worldZ * 0.55);
      colorScratch.copy(C_SNOW);
      const aspect = clamp01(nx * SUN_DIR.x + nz * SUN_DIR.z + 0.5);
      colorScratch.lerp(C_SHADE, (1 - aspect) * 0.34 + (1 - ny) * 0.16);
      colorScratch.lerp(C_ICE, clamp01((grain - 0.62) * 2.2) * 0.35);
      colorScratch.r += (sparkle - 0.5) * 0.035;
      colorScratch.g += (sparkle - 0.5) * 0.035;
      colorScratch.b += (sparkle - 0.5) * 0.02;
      if (steep > 0.30) colorScratch.lerp(grain > 0.5 ? C_ROCK2 : C_ROCK, smoothstep((steep - 0.30) / 0.42) * 0.94);
      if (groomed > 0.02) {
        const cord = 0.5 + 0.5 * Math.sin(worldZ * 1.15 + worldX * 0.06);
        colorScratch.lerp(C_GROOM, groomed * 0.85);
        colorScratch.multiplyScalar(1 + (cord - 0.5) * 0.045 * groomed);
      }
      colors[p] = colorScratch.r; colors[p + 1] = colorScratch.g; colors[p + 2] = colorScratch.b;
    }
  }
  for (let j = 0; j < TILE_RESOLUTION; j += 1) {
    for (let i = 0; i < TILE_RESOLUTION; i += 1) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      indices[at++] = a; indices[at++] = c; indices[at++] = b;
      indices[at++] = b; indices[at++] = c; indices[at++] = d;
    }
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

export class TerrainRenderer {
  private readonly tiles: Tile[] = [];
  private centerX = Infinity;
  private centerZ = Infinity;
  private readonly detailNormal: THREE.Texture;
  private material: THREE.Material;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: SimulationWorld,
    private readonly snowUniforms?: SnowUniforms | SnowNodeUniforms,
    /** Present exactly on the WebGPU path; see `nodeFactories`. */
    private readonly nodes: NodeFactories | null = null,
    private readonly snowDebug = 0,
    /** Seeded once at renderer construction; see `attachSurfaceTextures`. */
    private readonly rung: QualityRung = 0,
  ) {
    this.detailNormal = buildSnowDetailNormal(world.seed);
    // The node material is built from the same constants; only the shading language differs.
    const material: THREE.Material = snowUniforms && nodes
      ? nodes.snow.createSnowNodeMaterial(this.detailNormal, snowUniforms as SnowNodeUniforms, snowDebug, null, rung)
      : new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.86, metalness: 0.02, flatShading: false, dithering: true,
      });
    if (snowUniforms && !nodes) {
      material.userData.snowDetail = this.detailNormal;
      polishSnowMaterial(material as THREE.MeshStandardMaterial, this.detailNormal, snowUniforms as SnowUniforms);
    }
    this.material = material;
    for (let index = 0; index < GRID_SIZE * GRID_SIZE; index += 1) {
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
        mesh.receiveShadow = true;
        scene.add(mesh);
        this.tiles.push({ mesh, x: Infinity, z: Infinity });
    }
  }

  /**
   * Swap the procedural detail normal for the real KTX2 pair once `loadSurfaceTextures` resolves.
   * WebGPU-only, and one-shot: this rebuilds the shared tile material exactly once, the moment the
   * async texture load lands — never on a later governor rung change, matching how every other
   * rung-gated setting (`GameRenderer.applyQuality`) tweaks uniforms in place rather than rebuilding
   * a material. `rung` was captured once at construction for the same reason `createSnowNodeMaterial`
   * treats it as fixed: below rung 3 the real surface is never wired in, so there is nothing to swap.
   */
  attachSurfaceTextures(surfaces: SurfaceTextures): void {
    if (!this.nodes || !this.snowUniforms || this.rung < 3) return;
    const next = this.nodes.snow.createSnowNodeMaterial(
      this.detailNormal, this.snowUniforms as SnowNodeUniforms, this.snowDebug, surfaces, this.rung,
    );
    const previous = this.material;
    this.material = next;
    for (const tile of this.tiles) tile.mesh.material = next;
    previous.dispose();
    // The procedural detail normal is orphaned by the swap — nothing in the new material's graph
    // references it, and disposeObjectTree only walks materials still attached to the scene, so
    // without this it would sit on the GPU for the rest of the session.
    this.detailNormal.dispose();
  }

  update(playerX: number, playerZ: number): void {
    const cx = Math.floor(playerX / TILE_SIZE), cz = Math.floor(playerZ / TILE_SIZE);
    if (cx === this.centerX && cz === this.centerZ) return;
    this.centerX = cx; this.centerZ = cz;
    const wanted: Array<[number, number]> = [];
    for (let dz = -Z_TILES_BEHIND; dz <= GRID_SIZE - 1 - Z_TILES_BEHIND; dz += 1) {
      for (let dx = -GRID_HALF; dx <= GRID_HALF; dx += 1) wanted.push([cx + dx, cz + dz]);
    }
    const keep = new Set<number>();
    const stale: Tile[] = [];
    for (const tile of this.tiles) {
      const hit = wanted.findIndex(([x, z]) => x === tile.x && z === tile.z);
      if (hit >= 0 && !keep.has(hit)) keep.add(hit); else stale.push(tile);
    }
    for (const tile of stale) {
      for (let i = 0; i < wanted.length; i += 1) {
        if (keep.has(i)) continue;
        keep.add(i); this.rebuild(tile, wanted[i][0], wanted[i][1]); break;
      }
    }
  }

  private rebuild(tile: Tile, ix: number, iz: number): void {
    tile.x = ix; tile.z = iz;
    tile.mesh.geometry.dispose();
    tile.mesh.geometry = buildTileGeometry(this.world.terrain, ix, iz);
    tile.mesh.position.set(ix * TILE_SIZE, 0, iz * TILE_SIZE);
  }

  dispose(): void {
    for (const { mesh } of this.tiles) {
      this.scene.remove(mesh); mesh.geometry.dispose();
    }
    this.material.dispose();
    this.tiles.length = 0;
  }
}
