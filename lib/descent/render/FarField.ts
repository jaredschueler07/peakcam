/**
 * lib/descent/render/FarField.ts
 * ──────────────────────────────
 * The 30 km horizon from the baked PCFF asset, drawn as one flat-shaded mesh
 * per wedge. Triangles that lie wholly inside the near bake box are dropped
 * so the coarse horizon never pokes through the detailed terrain; the fog in
 * `Sky.ts` does the rest of the blending.
 */

import * as THREE from "three";
import type { World } from "../types";
import type { RenderFrame, RenderModule } from "./frame";

const INNER_MARGIN_M = 96;

export class FarField implements RenderModule {
  readonly group = new THREE.Group();
  private readonly material: THREE.MeshStandardMaterial;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly fogColor = new THREE.Color();

  constructor(private readonly scene: THREE.Scene, world: World) {
    this.material = new THREE.MeshStandardMaterial({ color: 0xe6ecf4, flatShading: true, roughness: 0.95, metalness: 0 });
    const asset = world.farField;
    if (asset) {
      const inner = world.halfSizeM - INNER_MARGIN_M;
      asset.wedges.forEach((wedge, w) => {
        const source = asset.lodIndices?.[w] ?? wedge.indices;
        const kept = new Uint32Array(source.length);
        let k = 0;
        const p = wedge.positions;
        for (let i = 0; i < source.length; i += 3) {
          const a = source[i], b = source[i + 1], c = source[i + 2];
          const insideA = Math.abs(p[a * 3]) < inner && Math.abs(p[a * 3 + 2]) < inner;
          const insideB = Math.abs(p[b * 3]) < inner && Math.abs(p[b * 3 + 2]) < inner;
          const insideC = Math.abs(p[c * 3]) < inner && Math.abs(p[c * 3 + 2]) < inner;
          if (insideA && insideB && insideC) continue;
          kept[k++] = a; kept[k++] = b; kept[k++] = c;
        }
        if (k === 0) return;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(wedge.positions, 3));
        geometry.setIndex(new THREE.BufferAttribute(kept.subarray(0, k), 1));
        geometry.computeBoundingSphere();
        this.geometries.push(geometry);
        const mesh = new THREE.Mesh(geometry, this.material);
        mesh.matrixAutoUpdate = false;
        // Behind everything near: the horizon must never win a depth test against the snow.
        mesh.renderOrder = -10;
        this.group.add(mesh);
      });
    }
    scene.add(this.group);
  }

  update(frame: RenderFrame): void {
    // Same snow tone as the near terrain, nudged toward the haze so the seam disappears in fog.
    this.material.color.setHex(0xe4eaf2).lerp(this.fogColor.setHex(frame.weather.fogCol), 0.2);
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    this.material.dispose();
    this.scene.remove(this.group);
  }
}
