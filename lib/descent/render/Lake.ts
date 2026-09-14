/**
 * lib/descent/render/Lake.ts
 * ──────────────────────────
 * Flat water for each mapped lake (Laguna del Inca at Portillo, Tahoe below
 * Heavenly): the OSM outline as a `ShapeGeometry`, laid in the XZ plane just
 * above the lake's elevation. Static.
 */

import * as THREE from "three";
import type { World } from "../types";
import type { RenderFrame, RenderModule } from "./frame";

const WATER_COLOR = 0x2f5f7a;

export class Lake implements RenderModule {
  private readonly meshes: THREE.Mesh[] = [];
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(private readonly scene: THREE.Scene, world: World) {
    for (const lake of world.lakes) {
      if (lake.outer.length < 3) continue;
      // Shape space is (x, y); after rotating -90° about X, shape y maps to -z.
      const shape = new THREE.Shape();
      const first = lake.outer[0];
      shape.moveTo(first.x, -first.z);
      for (let i = 1; i < lake.outer.length; i++) shape.lineTo(lake.outer[i].x, -lake.outer[i].z);
      shape.closePath();
      const geometry = new THREE.ShapeGeometry(shape);
      const material = new THREE.MeshStandardMaterial({
        color: WATER_COLOR, metalness: 0.2, roughness: 0.35,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = lake.elevationM + 0.2;
      mesh.name = lake.name;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.meshes.push(mesh);
      this.disposables.push(geometry, material);
    }
  }

  update(_frame: RenderFrame): void {
    // Still water.
  }

  dispose(): void {
    for (const mesh of this.meshes) this.scene.remove(mesh);
    for (const item of this.disposables) item.dispose();
    this.meshes.length = 0;
    this.disposables.length = 0;
  }
}
