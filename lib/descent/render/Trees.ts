/**
 * lib/descent/render/Trees.ts
 * ───────────────────────────
 * The forest at scale. `world.trees` may hold ~150k sites, so they are tiled
 * into 512 m cells and every tile owns two `InstancedMesh`es sharing two
 * geometries: a **near** conifer (trunk + three snow-capped tiers) and a
 * **far** impostor (a six-sided cone on a stub trunk, 16 triangles). Per
 * frame the only work is flipping `.visible` / `.castShadow` per tile by
 * distance to the camera; nothing is rebuilt. Rocks above the tree line are a
 * single extra instanced mesh.
 */

import * as THREE from "three";
import { mulberry32 } from "@/lib/game/core/rng";
import type { TreeSite, World } from "../types";
import type { RenderFrame, RenderModule } from "./frame";

const ROCK_COUNT = 200;
const ROCK_MIN_GRADE = 0.9;
/** Canopy width as a fraction of tree height: a 10 m tree is ~4 m across. */
const WIDTH_PER_HEIGHT = 0.42;
export const TREE_TILE_M = 512;
/** Tiles closer than this (to their centre) draw the detailed conifer. */
export const NEAR_DISTANCE_M = 650;
export const NEAR_DISTANCE_LOW_M = 450;
/** Only tiles this close cast shadows. */
export const SHADOW_DISTANCE_M = 260;

/** Push one triangle with a flat colour. */
function tri(
  positions: number[], colors: number[],
  ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number,
  color: THREE.Color,
): void {
  positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b);
}

function finish(positions: number[], colors: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A unit-height conifer, apex at y = 1, base at y = 0. Sides carry the cone
 * tier colour; the upper faces of each tier (the "shelf" where the tier
 * meets the one above) carry the snow-cap colour.
 */
function buildNearGeometry(cone: readonly [number, number, number], trunk: number, cap: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const trunkColor = new THREE.Color(trunk);
  const capColor = new THREE.Color(cap);
  const segments = 6;

  const trunkR = 0.08, trunkTop = 0.3;
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
    const x0 = Math.cos(a0) * trunkR, z0 = Math.sin(a0) * trunkR;
    const x1 = Math.cos(a1) * trunkR, z1 = Math.sin(a1) * trunkR;
    tri(positions, colors, x0, 0, z0, x1, 0, z1, x1, trunkTop, z1, trunkColor);
    tri(positions, colors, x0, 0, z0, x1, trunkTop, z1, x0, trunkTop, z0, trunkColor);
  }

  const tiers: Array<{ base: number; top: number; radius: number; color: THREE.Color }> = [
    { base: 0.2, top: 0.55, radius: 0.48, color: new THREE.Color(cone[0]) },
    { base: 0.42, top: 0.8, radius: 0.36, color: new THREE.Color(cone[1]) },
    { base: 0.66, top: 1.0, radius: 0.24, color: new THREE.Color(cone[2]) },
  ];
  for (const tier of tiers) {
    const shelf = tier.base + (tier.top - tier.base) * 0.12;
    const shelfR = tier.radius * 0.88;
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
      const x0 = Math.cos(a0), z0 = Math.sin(a0);
      const x1 = Math.cos(a1), z1 = Math.sin(a1);
      tri(positions, colors,
        x0 * tier.radius, tier.base, z0 * tier.radius,
        x1 * tier.radius, tier.base, z1 * tier.radius,
        0, tier.top, 0, tier.color);
      tri(positions, colors,
        x1 * shelfR, shelf, z1 * shelfR,
        x0 * shelfR, shelf, z0 * shelfR,
        0, shelf + (tier.top - shelf) * 0.55, 0, capColor);
    }
  }
  return finish(positions, colors);
}

/** The distant impostor: a six-sided cone on a four-sided stub trunk (16 triangles). */
function buildFarGeometry(cone: readonly [number, number, number], trunk: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const trunkColor = new THREE.Color(trunk);
  const coneColor = new THREE.Color(cone[1]);
  const trunkR = 0.07, trunkTop = 0.22;
  for (let i = 0; i < 4; i++) {
    const a0 = (i / 4) * Math.PI * 2, a1 = ((i + 1) / 4) * Math.PI * 2;
    const x0 = Math.cos(a0) * trunkR, z0 = Math.sin(a0) * trunkR;
    const x1 = Math.cos(a1) * trunkR, z1 = Math.sin(a1) * trunkR;
    tri(positions, colors, x0, 0, z0, x1, 0, z1, x1, trunkTop, z1, trunkColor);
    tri(positions, colors, x0, 0, z0, x1, trunkTop, z1, x0, trunkTop, z0, trunkColor);
  }
  const base = 0.18, radius = 0.42;
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2, a1 = ((i + 1) / 6) * Math.PI * 2;
    tri(positions, colors,
      Math.cos(a0) * radius, base, Math.sin(a0) * radius,
      Math.cos(a1) * radius, base, Math.sin(a1) * radius,
      0, 1, 0, coneColor);
  }
  // Underside disc so the cone is closed when seen from below on a ridge.
  for (let i = 0; i < 2; i++) {
    const a0 = (i * 3 / 6) * Math.PI * 2, a1 = ((i * 3 + 1) / 6) * Math.PI * 2, a2 = ((i * 3 + 2) / 6) * Math.PI * 2;
    tri(positions, colors,
      Math.cos(a0) * radius, base, Math.sin(a0) * radius,
      Math.cos(a2) * radius, base, Math.sin(a2) * radius,
      Math.cos(a1) * radius, base, Math.sin(a1) * radius, coneColor);
  }
  return finish(positions, colors);
}

interface Tile {
  cx: number;
  cy: number;
  cz: number;
  near: THREE.InstancedMesh;
  far: THREE.InstancedMesh;
}

function fillInstances(mesh: THREE.InstancedMesh, trees: readonly TreeSite[]): void {
  const dummy = new THREE.Object3D();
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  for (let i = 0; i < trees.length; i++) {
    const tree = trees[i];
    const height = tree.heightM;
    const width = height * WIDTH_PER_HEIGHT * (0.9 + tree.variant * 0.25);
    dummy.position.set(tree.x, tree.y - 0.2, tree.z);
    dummy.rotation.set((tree.variant - 0.5) * 0.06, tree.variant * Math.PI * 2, ((tree.variant * 7.3) % 1 - 0.5) * 0.06);
    dummy.scale.set(width, height, width);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    bounds.expandByPoint(point.set(tree.x - width, tree.y, tree.z - width));
    bounds.expandByPoint(point.set(tree.x + width, tree.y + height, tree.z + width));
  }
  mesh.instanceMatrix.needsUpdate = true;
  const sphere = new THREE.Sphere();
  bounds.getBoundingSphere(sphere);
  mesh.boundingSphere = sphere;
  mesh.boundingBox = bounds;
  mesh.frustumCulled = true;
}

export class Trees implements RenderModule {
  private readonly group = new THREE.Group();
  private readonly tiles: Tile[] = [];
  private readonly disposables: Array<{ dispose(): void }> = [];
  /** Total instanced trees, for diagnostics. */
  readonly treeCount: number;

  constructor(private readonly scene: THREE.Scene, world: World) {
    this.treeCount = world.trees.length;
    this.buildTiles(world);
    this.buildRocks(world);
    this.scene.add(this.group);
  }

  get tileCount(): number { return this.tiles.length; }

  private buildTiles(world: World): void {
    const sites = world.trees;
    if (sites.length === 0) return;
    const forest = world.profile.forest;
    const nearGeometry = buildNearGeometry(forest.cone, forest.trunk, forest.cap);
    const farGeometry = buildFarGeometry(forest.cone, forest.trunk);
    // `color` stays white: vertex colours are multiplied by it.
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.disposables.push(nearGeometry, farGeometry, material);

    const buckets = new Map<string, TreeSite[]>();
    for (const site of sites) {
      const key = `${Math.floor(site.x / TREE_TILE_M)},${Math.floor(site.z / TREE_TILE_M)}`;
      let list = buckets.get(key);
      if (!list) { list = []; buckets.set(key, list); }
      list.push(site);
    }

    for (const trees of buckets.values()) {
      const near = new THREE.InstancedMesh(nearGeometry, material, trees.length);
      const far = new THREE.InstancedMesh(farGeometry, material, trees.length);
      fillInstances(near, trees);
      fillInstances(far, trees);
      near.castShadow = false;
      near.receiveShadow = false;
      far.castShadow = false;
      far.receiveShadow = false;
      near.visible = false;
      far.visible = true;
      const centre = near.boundingSphere!.center;
      this.tiles.push({ cx: centre.x, cy: centre.y, cz: centre.z, near, far });
      this.group.add(near, far);
    }
  }

  private buildRocks(world: World): void {
    const random = mulberry32(world.seed ^ 0x0c0c5);
    const normal = { x: 0, y: 1, z: 0 };
    const half = world.halfSizeM * 0.9;
    const placed: Array<{ x: number; y: number; z: number; s: number; r: number }> = [];
    for (let attempt = 0; attempt < ROCK_COUNT * 12 && placed.length < ROCK_COUNT; attempt++) {
      const x = (random() * 2 - 1) * half, z = (random() * 2 - 1) * half;
      const y = world.terrain.height(x, z);
      if (world.treeLineM > 0 && y < world.treeLineM) continue;
      const n = world.terrain.normal(x, z, normal);
      const grade = Math.hypot(n.x, n.z) / Math.max(1e-4, n.y);
      if (grade < ROCK_MIN_GRADE) continue;
      placed.push({ x, y, z, s: 1.2 + random() * 3.5, r: random() * Math.PI * 2 });
    }
    if (placed.length === 0) return;

    const geometry = new THREE.DodecahedronGeometry(1, 0);
    const material = new THREE.MeshLambertMaterial({ color: 0x6c6f6a, flatShading: true });
    const mesh = new THREE.InstancedMesh(geometry, material, placed.length);
    mesh.castShadow = true;
    const dummy = new THREE.Object3D();
    const bounds = new THREE.Box3();
    const point = new THREE.Vector3();
    for (let i = 0; i < placed.length; i++) {
      const rock = placed[i];
      dummy.position.set(rock.x, rock.y - rock.s * 0.35, rock.z);
      dummy.rotation.set(rock.r * 0.3, rock.r, rock.r * 0.7);
      dummy.scale.set(rock.s, rock.s * 0.7, rock.s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      bounds.expandByPoint(point.set(rock.x, rock.y, rock.z));
    }
    mesh.instanceMatrix.needsUpdate = true;
    bounds.expandByScalar(5);
    const sphere = new THREE.Sphere();
    bounds.getBoundingSphere(sphere);
    mesh.boundingSphere = sphere;
    mesh.boundingBox = bounds;
    this.group.add(mesh);
    this.disposables.push(geometry, material);
  }

  update(frame: RenderFrame): void {
    const cam = frame.camera.position;
    const nearLimit = frame.quality === 2 ? NEAR_DISTANCE_LOW_M : NEAR_DISTANCE_M;
    const nearSq = nearLimit * nearLimit;
    const shadowSq = SHADOW_DISTANCE_M * SHADOW_DISTANCE_M;
    for (let i = 0; i < this.tiles.length; i++) {
      const tile = this.tiles[i];
      const dx = cam.x - tile.cx, dy = cam.y - tile.cy, dz = cam.z - tile.cz;
      const distSq = dx * dx + dy * dy + dz * dz;
      const near = distSq <= nearSq;
      tile.near.visible = near;
      tile.far.visible = !near;
      tile.near.castShadow = near && distSq <= shadowSq;
    }
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.group.clear();
    for (const item of this.disposables) item.dispose();
    this.disposables.length = 0;
    this.tiles.length = 0;
  }
}
