import * as THREE from "three";

/** Static world attributes, bounded index compaction when wedge visibility changes.
 * One mobile draw retains the exact selected source LOD triangles and culling. */
export class FarFieldBatch {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  private readonly source: Uint32Array;
  private readonly active: Uint32Array;
  private readonly offsets: Uint32Array;
  private readonly previous: Uint8Array;

  constructor(geometries: readonly THREE.BufferGeometry[], material: THREE.Material) {
    let vertexCount = 0, indexCount = 0;
    for (const geometry of geometries) { vertexCount += geometry.getAttribute("position").count; indexCount += geometry.index!.count; }
    const position = new Float32Array(vertexCount * 3), normal = new Float32Array(vertexCount * 3);
    this.source = new Uint32Array(indexCount); this.active = new Uint32Array(indexCount);
    this.offsets = new Uint32Array(geometries.length + 1);
    this.previous = new Uint8Array(geometries.length).fill(255);
    let vertex = 0, index = 0;
    for (let w = 0; w < geometries.length; w++) {
      const geometry = geometries[w], p = geometry.getAttribute("position"), n = geometry.getAttribute("normal"), idx = geometry.index!;
      position.set(p.array, vertex * 3); normal.set(n.array, vertex * 3);
      this.offsets[w] = index;
      for (let i = 0; i < idx.count; i++) this.source[index++] = idx.getX(i) + vertex;
      vertex += p.count;
    }
    this.offsets[geometries.length] = index;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    geometry.setIndex(new THREE.BufferAttribute(this.active, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = "far-field-mobile-batch";
    this.mesh.castShadow = false; this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false; this.mesh.matrixAutoUpdate = false; this.mesh.visible = false;
  }

  update(visibility: Uint8Array): void {
    let changed = false;
    for (let w = 0; w < visibility.length; w++) if (visibility[w] !== this.previous[w]) changed = true;
    if (!changed) return;
    this.previous.set(visibility);
    let index = 0;
    for (let w = 0; w < visibility.length; w++) {
      if (!visibility[w]) continue;
      for (let i = this.offsets[w]; i < this.offsets[w + 1]; i++) this.active[index++] = this.source[i];
    }
    this.mesh.geometry.setDrawRange(0, index);
    this.mesh.geometry.index!.needsUpdate = true;
    this.mesh.visible = index > 0;
  }
}
