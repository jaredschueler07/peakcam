import * as THREE from "three";
import type { SimulationWorld } from "../core/types";

const TILE_SIZE = 120;
const RESOLUTION = 20;
const GRID_RADIUS = 2;

interface Tile { mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>; x: number; z: number }

function makeGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE, RESOLUTION, RESOLUTION);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

export class TerrainRenderer {
  private readonly tiles: Tile[] = [];
  private centerX = Infinity;
  private centerZ = Infinity;

  constructor(private readonly scene: THREE.Scene, private readonly world: SimulationWorld) {
    for (let z = -GRID_RADIUS; z <= GRID_RADIUS; z += 1) {
      for (let x = -GRID_RADIUS; x <= GRID_RADIUS; x += 1) {
        const material = new THREE.MeshStandardMaterial({
          color: 0xeaf2f4, roughness: 0.92, metalness: 0.02, flatShading: false,
        });
        const mesh = new THREE.Mesh(makeGeometry(), material);
        mesh.receiveShadow = true;
        scene.add(mesh);
        this.tiles.push({ mesh, x: Infinity, z: Infinity });
      }
    }
  }

  update(playerX: number, playerZ: number): void {
    const cx = Math.floor(playerX / TILE_SIZE), cz = Math.floor(playerZ / TILE_SIZE);
    if (cx === this.centerX && cz === this.centerZ) return;
    this.centerX = cx; this.centerZ = cz;
    let index = 0;
    for (let dz = -1; dz <= GRID_RADIUS + 1; dz += 1) {
      for (let dx = -GRID_RADIUS; dx <= GRID_RADIUS; dx += 1) {
        const tile = this.tiles[index++];
        this.rebuild(tile, cx + dx, cz + dz);
      }
    }
  }

  private rebuild(tile: Tile, ix: number, iz: number): void {
    tile.x = ix; tile.z = iz;
    const originX = ix * TILE_SIZE, originZ = iz * TILE_SIZE;
    const positions = tile.mesh.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < positions.count; i += 1) {
      const worldX = originX + positions.getX(i) + TILE_SIZE / 2;
      const worldZ = originZ + positions.getZ(i) + TILE_SIZE / 2;
      positions.setY(i, this.world.terrain.height(worldX, worldZ));
    }
    positions.needsUpdate = true;
    tile.mesh.geometry.computeVertexNormals();
    tile.mesh.geometry.computeBoundingSphere();
    tile.mesh.position.set(originX + TILE_SIZE / 2, 0, originZ + TILE_SIZE / 2);
  }

  dispose(): void {
    for (const { mesh } of this.tiles) {
      this.scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose();
    }
    this.tiles.length = 0;
  }
}

