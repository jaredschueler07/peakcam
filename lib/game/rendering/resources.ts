import * as THREE from "three";

export interface ResourceCounts { geometries: number; materials: number; textures: number }
export interface DisposalAudit { geometry?(): void; material?(): void; texture?(): void }

export function collectResources(root: THREE.Object3D): { geometries: Set<THREE.BufferGeometry>; materials: Set<THREE.Material>; textures: Set<THREE.Texture> } {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    const renderable = object as THREE.Mesh;
    if (renderable.geometry) geometries.add(renderable.geometry);
    const list = Array.isArray(renderable.material) ? renderable.material : renderable.material ? [renderable.material] : [];
    for (const material of list) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      if (material instanceof THREE.ShaderMaterial) {
        for (const uniform of Object.values(material.uniforms)) if (uniform.value instanceof THREE.Texture) textures.add(uniform.value);
      }
    }
  });
  return { geometries, materials, textures };
}

export function resourceCounts(root: THREE.Object3D): ResourceCounts {
  const r = collectResources(root);
  return { geometries: r.geometries.size, materials: r.materials.size, textures: r.textures.size };
}

export function disposeObjectTree(root: THREE.Object3D, audit?: DisposalAudit): void {
  const resources = collectResources(root);
  for (const texture of resources.textures) { texture.dispose(); audit?.texture?.(); }
  for (const geometry of resources.geometries) { geometry.dispose(); audit?.geometry?.(); }
  for (const material of resources.materials) { material.dispose(); audit?.material?.(); }
  root.clear();
}
