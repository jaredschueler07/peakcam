import * as THREE from "three";
import type { TerrainSampler } from "../core/types";
import { clamp01, smoothstep } from "../core/math";
import { fbm, vnoise } from "../terrain/noise";
import { GRID_HALF, GRID_SIZE, TILE_SIZE, Z_TILES_BEHIND } from "./nearFieldReach";

const WIDTH = GRID_SIZE * TILE_SIZE;
const ROW = WIDTH + 1;
const MAX_VERTICES = 40_000;
const MAX_INDICES = 180_000;
const CACHE_SIZE = 65_536;
const sun = new THREE.Vector3(-0.46, 0.62, -0.64).normalize();
const snow = new THREE.Color(0.955, 0.975, 1), shade = new THREE.Color(0.66, 0.76, 0.92);
const rock = new THREE.Color(0.29, 0.30, 0.335), rock2 = new THREE.Color(0.44, 0.43, 0.44);
const groom = new THREE.Color(0.90, 0.945, 1), ice = new THREE.Color(0.74, 0.87, 0.97);
const color = new THREE.Color();
const normal = { x: 0, y: 1, z: 0 };

/** A single, stitched, source-sampled mesh. All storage is reserved before play.
 * The nested 1–32m squares are aligned to the same world lattice. Coarse cells sharing
 * an edge with finer cells add its midpoint, so both sides have identical edges.
 * No skirts, duplicate coplanar sheets, or changes to the physical surface.
 */
export class AdaptiveTerrainMesh {
  readonly geometry = new THREE.BufferGeometry();
  readonly bounds = new THREE.Vector4();
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  private readonly positions = new Float32Array(MAX_VERTICES * 3);
  private readonly normals = new Float32Array(MAX_VERTICES * 3);
  private readonly colors = new Float32Array(MAX_VERTICES * 3);
  private readonly groomed = new Float32Array(MAX_VERTICES);
  private readonly indices = new Uint32Array(MAX_INDICES);
  private readonly vertexMap = new Int32Array(ROW * ROW);
  // A bounded, direct-mapped cache of immutable world samples. Coordinates are
  // checked after hashing; collisions only cause recomputation, never aliasing.
  private readonly cacheX: Float64Array;
  private readonly cacheZ: Float64Array;
  private readonly cache: Float32Array;
  private vertices = 0;
  private indexCount = 0;
  private anchorX = Infinity;
  private anchorZ = Infinity;
  private minX = Infinity;
  private minZ = Infinity;
  private minHeight = Infinity;
  private maxHeight = -Infinity;
  private buildX = 0;
  private buildZ = 0;
  private firstBuildX = 0;
  private buildCpuMs = 0;
  building = false;
  rebuilds = 0;
  lastBuildMs = 0;
  maxBuildMs = 0;

  constructor(private readonly terrain: TerrainSampler, material: THREE.Material, private readonly mobile = false, sharedCache?: AdaptiveTerrainMesh) {
    this.cacheX = sharedCache?.cacheX ?? new Float64Array(CACHE_SIZE).fill(Infinity);
    this.cacheZ = sharedCache?.cacheZ ?? new Float64Array(CACHE_SIZE).fill(Infinity);
    this.cache = sharedCache?.cache ?? new Float32Array(CACHE_SIZE * 8);
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("normal", new THREE.BufferAttribute(this.normals, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("groomed", new THREE.BufferAttribute(this.groomed, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setIndex(new THREE.BufferAttribute(this.indices, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.boundingBox = new THREE.Box3();
    this.geometry.boundingSphere = new THREE.Sphere();
    this.geometry.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.name = "terrain-adaptive";
    this.mesh.receiveShadow = true;
  }

  get triangles(): number { return this.indexCount / 3; }
  get vertexCount(): number { return this.vertices; }
  get bufferBytes(): number {
    return this.positions.byteLength + this.normals.byteLength + this.colors.byteLength + this.groomed.byteLength +
      this.indices.byteLength + this.vertexMap.byteLength + this.cacheX.byteLength + this.cacheZ.byteLength + this.cache.byteLength;
  }

  /** The standalone audit uses synchronous completion; the live renderer slices it. */
  update(x: number, z: number): void {
    this.begin(x, z);
    while (this.building) this.advance(Infinity);
  }

  matches(x: number, z: number): boolean {
    const snap = this.mobile ? 16 : 32;
    return Math.round(x / snap) * snap === this.anchorX && Math.round(z / snap) * snap === this.anchorZ &&
      (Math.floor(x / TILE_SIZE) - GRID_HALF) * TILE_SIZE === this.minX &&
      (Math.floor(z / TILE_SIZE) - Z_TILES_BEHIND) * TILE_SIZE === this.minZ;
  }

  begin(x: number, z: number): void {
    if (this.matches(x, z)) return;
    const started = performance.now(), snap = this.mobile ? 16 : 32;
    this.anchorX = Math.round(x / snap) * snap; this.anchorZ = Math.round(z / snap) * snap;
    this.minX = (Math.floor(x / TILE_SIZE) - GRID_HALF) * TILE_SIZE;
    this.minZ = (Math.floor(z / TILE_SIZE) - Z_TILES_BEHIND) * TILE_SIZE;
    this.vertices = 0; this.indexCount = 0; this.minHeight = Infinity; this.maxHeight = -Infinity;
    this.vertexMap.fill(-1);
    const outer = this.mobile ? 32 : 8;
    this.firstBuildX = Math.floor(this.minX / outer) * outer;
    this.buildX = this.firstBuildX; this.buildZ = Math.floor(this.minZ / outer) * outer;
    this.building = true; this.buildCpuMs = performance.now() - started;
  }

  /** Bounded batches; one coarse cell is the maximum indivisible unit. */
  advance(budgetMs: number): void {
    if (!this.building) return;
    const started = performance.now(), outer = this.mobile ? 32 : 8;
    do {
      this.clippedCell(this.buildX, this.buildZ, outer);
      this.buildX += outer;
      if (this.buildX >= this.minX + WIDTH) { this.buildX = this.firstBuildX; this.buildZ += outer; }
      if (this.buildZ >= this.minZ + WIDTH) { this.building = false; break; }
    } while (performance.now() - started < budgetMs);
    this.buildCpuMs += performance.now() - started;
    if (this.building) return;
    const minX = this.minX, minZ = this.minZ;
    this.geometry.setDrawRange(0, this.indexCount);
    this.geometry.getAttribute("position").needsUpdate = true;
    this.geometry.getAttribute("normal").needsUpdate = true;
    this.geometry.getAttribute("color").needsUpdate = true;
    this.geometry.getAttribute("groomed").needsUpdate = true;
    this.geometry.index!.needsUpdate = true;
    this.geometry.boundingBox!.min.set(minX, this.minHeight, minZ);
    this.geometry.boundingBox!.max.set(minX + WIDTH, this.maxHeight, minZ + WIDTH);
    this.geometry.boundingBox!.getBoundingSphere(this.geometry.boundingSphere!);
    this.bounds.set(minX, minZ, minX + WIDTH, minZ + WIDTH);
    this.rebuilds++;
    this.lastBuildMs = this.buildCpuMs;
    this.maxBuildMs = Math.max(this.maxBuildMs, this.lastBuildMs);
  }

  private minimumSpacing(x: number, z: number, size: number): number {
    // Refine a cell if any of its interior reaches a finer band. The world
    // lattice stays fixed even when a 16m centre moves across a 32m outer cell.
    const dx = Math.max(x - this.anchorX, this.anchorX - x - size, 0);
    const dz = Math.max(z - this.anchorZ, this.anchorZ - z - size, 0);
    const d = Math.max(dx, dz) + 1e-6;
    if (this.mobile) return d < 16 ? 1 : d < 24 ? 2 : d < 40 ? 4 : d < 80 ? 8 : d < 160 ? 16 : 32;
    return d < 32 ? 1 : d < 64 ? 2 : d < 128 ? 4 : 8;
  }

  private clippedCell(x: number, z: number, size: number): void {
    if (x + size <= this.minX || z + size <= this.minZ || x >= this.minX + WIDTH || z >= this.minZ + WIDTH) return;
    if (x < this.minX || z < this.minZ || x + size > this.minX + WIDTH || z + size > this.minZ + WIDTH) {
      const half = size / 2;
      this.clippedCell(x, z, half); this.clippedCell(x + half, z, half);
      this.clippedCell(x, z + half, half); this.clippedCell(x + half, z + half, half); return;
    }
    this.cell(x, z, size);
  }

  private leafSize(x: number, z: number): number {
    let size = this.mobile ? 32 : 8;
    while (size > 1) {
      const cx = Math.floor(x / size) * size, cz = Math.floor(z / size) * size;
      const clipped = cx < this.minX || cz < this.minZ || cx + size > this.minX + WIDTH || cz + size > this.minZ + WIDTH;
      if (!clipped && this.minimumSpacing(cx, cz, size) >= size) break;
      size /= 2;
    }
    return size;
  }

  private cell(x: number, z: number, size: number): void {
    const half = size / 2;
    if (this.minimumSpacing(x, z, size) < size) {
      this.cell(x, z, half); this.cell(x + half, z, half);
      this.cell(x, z + half, half); this.cell(x + half, z + half, half);
      return;
    }
    const a = this.vertex(x, z), b = this.vertex(x + size, z);
    const c = this.vertex(x, z + size), d = this.vertex(x + size, z + size);
    const top = z > this.minZ && this.leafSize(x + half, z - 0.25) < size;
    const right = x + size < this.minX + WIDTH && this.leafSize(x + size + 0.25, z + half) < size;
    const bottom = z + size < this.minZ + WIDTH && this.leafSize(x + half, z + size + 0.25) < size;
    const left = x > this.minX && this.leafSize(x - 0.25, z + half) < size;
    if (!(top || right || bottom || left)) {
      this.triangle(a, c, b); this.triangle(b, c, d); return;
    }
    const middle = this.vertex(x + half, z + half);
    this.fanEdge(middle, x, z, 0, 1, size);
    this.fanEdge(middle, x, z + size, 1, 0, size);
    this.fanEdge(middle, x + size, z + size, 0, -1, size);
    this.fanEdge(middle, x + size, z, -1, 0, size);
  }

  /** Follow the neighbour's actual edge vertices, including 32m-to-8m joins
   * where the 1km outer window clips a cell. A single midpoint is insufficient. */
  private fanEdge(center: number, x: number, z: number, dx: number, dz: number, size: number): void {
    let cursor = 0, previous = this.vertex(x, z);
    const direction = dx || dz;
    while (cursor < size) {
      const px = x + dx * (cursor + 0.25) - dz * 0.25;
      const pz = z + dz * (cursor + 0.25) + dx * 0.25;
      const outside = px < this.minX || px >= this.minX + WIDTH || pz < this.minZ || pz >= this.minZ + WIDTH;
      const spacing = outside ? size : this.leafSize(px, pz);
      const along = dx ? x + dx * cursor : z + dz * cursor;
      const nextLine = direction > 0 ? (Math.floor(along / spacing) + 1) * spacing : (Math.ceil(along / spacing) - 1) * spacing;
      cursor = Math.min(size, cursor + (nextLine - along) * direction);
      const next = this.vertex(x + dx * cursor, z + dz * cursor);
      this.triangle(center, previous, next); previous = next;
    }
  }

  private triangle(a: number, b: number, c: number): void {
    if (this.indexCount + 3 > MAX_INDICES) throw new Error("Adaptive terrain index capacity exceeded");
    this.indices[this.indexCount++] = a; this.indices[this.indexCount++] = b; this.indices[this.indexCount++] = c;
  }

  private vertex(x: number, z: number): number {
    const key = (z - this.minZ) * ROW + x - this.minX;
    const found = this.vertexMap[key];
    if (found >= 0) return found;
    const index = this.vertices++;
    if (index >= MAX_VERTICES) throw new Error("Adaptive terrain vertex capacity exceeded");
    this.vertexMap[key] = index;
    let hash = Math.imul(x, 73856093) ^ Math.imul(z, 19349663);
    hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
    const slot = (hash ^ (hash >>> 16)) & (CACHE_SIZE - 1), at = slot * 8;
    if (this.cacheX[slot] !== x || this.cacheZ[slot] !== z) {
      this.cacheX[slot] = x; this.cacheZ[slot] = z;
      this.cache[at] = this.terrain.height(x, z);
      this.terrain.normal(x, z, normal);
      this.cache[at + 1] = normal.x; this.cache[at + 2] = normal.y; this.cache[at + 3] = normal.z;
      const mask = this.terrain.trailField(x, z);
      const grain = fbm(x * 0.021, z * 0.021, 2), sparkle = vnoise(x * 0.55, z * 0.55);
      const steep = clamp01((1 - normal.y) * 2.55);
      const aspect = clamp01(normal.x * sun.x + normal.z * sun.z + 0.5);
      color.copy(snow).lerp(shade, (1 - aspect) * 0.34 + (1 - normal.y) * 0.16);
      color.lerp(ice, clamp01((grain - 0.62) * 2.2) * 0.35);
      color.r += (sparkle - 0.5) * 0.035; color.g += (sparkle - 0.5) * 0.035; color.b += (sparkle - 0.5) * 0.02;
      if (steep > 0.30) color.lerp(grain > 0.5 ? rock2 : rock, smoothstep((steep - 0.30) / 0.42) * 0.94);
      if (mask > 0.02) {
        color.lerp(groom, mask * 0.85);
        color.multiplyScalar(1 + Math.sin(z * 1.15 + x * 0.06) * 0.5 * 0.045 * mask);
      }
      this.cache[at + 4] = color.r; this.cache[at + 5] = color.g; this.cache[at + 6] = color.b; this.cache[at + 7] = mask;
    }
    const p = index * 3, height = this.cache[at];
    this.positions[p] = x; this.positions[p + 1] = height; this.positions[p + 2] = z;
    this.normals[p] = this.cache[at + 1]; this.normals[p + 1] = this.cache[at + 2]; this.normals[p + 2] = this.cache[at + 3];
    this.colors[p] = this.cache[at + 4]; this.colors[p + 1] = this.cache[at + 5]; this.colors[p + 2] = this.cache[at + 6];
    this.groomed[index] = this.cache[at + 7];
    this.minHeight = Math.min(this.minHeight, height); this.maxHeight = Math.max(this.maxHeight, height);
    return index;
  }

  /** Locate the active leaf, then interpolate its actual fan or diagonal. */
  sampleRenderedHeight(x: number, z: number): number {
    if (x < this.minX || x >= this.minX + WIDTH || z < this.minZ || z >= this.minZ + WIDTH) return this.terrain.height(x, z);
    const size = this.leafSize(x, z);
    const cx = Math.floor(x / size) * size, cz = Math.floor(z / size) * size;
    const half = size / 2;
    const center = this.vertexMap[(cz + half - this.minZ) * ROW + cx + half - this.minX];
    const a = this.vertexMap[(cz - this.minZ) * ROW + cx - this.minX];
    const b = this.vertexMap[(cz - this.minZ) * ROW + cx + size - this.minX];
    const c = this.vertexMap[(cz + size - this.minZ) * ROW + cx - this.minX];
    const d = this.vertexMap[(cz + size - this.minZ) * ROW + cx + size - this.minX];
    const u = (x - cx) / size, v = (z - cz) / size;
    const ha = this.positions[a * 3 + 1], hb = this.positions[b * 3 + 1];
    const hc = this.positions[c * 3 + 1], hd = this.positions[d * 3 + 1];
    if (size === 1 || center === undefined || center < 0) return u + v <= 1 ? ha + (hb - ha) * u + (hc - ha) * v : hd + (hc - hd) * (1 - u) + (hb - hd) * (1 - v);
    // Each fan triangle joins the centre to one edge segment. Interpolate the
    // edge first, then the radial line from centre (valid barycentric weights).
    const du = u - 0.5, dv = v - 0.5, radius = Math.max(Math.abs(du), Math.abs(dv));
    const hm = this.positions[center * 3 + 1];
    if (radius === 0) return hm;
    let edgeX: number, edgeZ: number, horizontal: boolean, t: number;
    if (Math.abs(du) > Math.abs(dv)) {
      edgeX = du < 0 ? cx : cx + size; edgeZ = cz; horizontal = false;
      t = 0.5 + dv / (2 * radius);
    } else {
      edgeX = cx; edgeZ = dv < 0 ? cz : cz + size; horizontal = true;
      t = 0.5 + du / (2 * radius);
    }
    return hm + (this.edgeHeight(edgeX, edgeZ, size, horizontal, t) - hm) * radius * 2;
  }

  private edgeHeight(x: number, z: number, size: number, horizontal: boolean, t: number): number {
    const key = (z - this.minZ) * ROW + x - this.minX, stride = horizontal ? 1 : ROW;
    const at = t * size;
    let lo = Math.max(0, Math.floor(at)), hi = Math.min(size, Math.ceil(at));
    while (lo > 0 && this.vertexMap[key + lo * stride] < 0) lo--;
    while (hi < size && this.vertexMap[key + hi * stride] < 0) hi++;
    const a = this.positions[this.vertexMap[key + lo * stride] * 3 + 1];
    if (lo === hi) return a;
    const b = this.positions[this.vertexMap[key + hi * stride] * 3 + 1];
    return a + (b - a) * (at - lo) / (hi - lo);
  }

}


/** Double buffering prevents partially built geometry or holes reaching a frame.
 * Only the visible buffer answers contact queries. Inactive data is assembled
 * in <=2ms slices (plus one indivisible coarse cell), then switched atomically.
 */
export class AdaptiveTerrainStream {
  private front: AdaptiveTerrainMesh;
  private back: AdaptiveTerrainMesh;
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  private initialized = false;
  private pending = false;
  private inactiveDisposed = false;
  swaps = 0;
  lastWorkMs = 0;
  maxWorkMs = 0;

  constructor(terrain: TerrainSampler, material: THREE.Material, mobile: boolean) {
    this.front = new AdaptiveTerrainMesh(terrain, material, mobile);
    this.back = new AdaptiveTerrainMesh(terrain, material, mobile, this.front);
    this.mesh = this.front.mesh;
  }
  get geometry(): THREE.BufferGeometry { return this.front.geometry; }
  get bounds(): THREE.Vector4 { return this.front.bounds; }
  get triangles(): number { return this.front.triangles; }
  get vertexCount(): number { return this.front.vertexCount; }
  get bufferBytes(): number { return this.front.bufferBytes + this.back.bufferBytes - CACHE_SIZE * 48; }
  get rebuilds(): number { return this.swaps + (this.initialized ? 1 : 0); }
  get lastBuildMs(): number { return this.front.lastBuildMs; }
  get maxBuildMs(): number { return Math.max(this.front.maxBuildMs, this.back.maxBuildMs); }
  get rebuilding(): boolean { return this.pending; }

  update(x: number, z: number): void {
    if (!this.initialized) {
      this.front.update(x, z); this.initialized = true; return;
    }
    this.lastWorkMs = 0;
    if (!this.pending && this.front.matches(x, z)) return;
    const started = performance.now();
    if (!this.pending) { this.back.begin(x, z); this.pending = true; }
    this.back.advance(Math.max(0, 2 - (performance.now() - started)));
    if (!this.back.building) {
      const previous = this.front; this.front = this.back; this.back = previous;
      this.mesh.geometry = this.front.geometry; this.pending = false; this.swaps++;
    }
    this.lastWorkMs = performance.now() - started;
    this.maxWorkMs = Math.max(this.maxWorkMs, this.lastWorkMs);
  }
  sampleRenderedHeight(x: number, z: number): number { return this.front.sampleRenderedHeight(x, z); }
  disposeInactiveGeometry(): void {
    if (this.inactiveDisposed) return;
    this.inactiveDisposed = true; this.back.geometry.dispose();
  }
}
