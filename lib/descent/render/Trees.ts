/**
 * lib/descent/render/Trees.ts
 * ───────────────────────────
 * The forest: one low-poly conifer geometry (trunk + three stacked cones with
 * snow-capped upper faces, all vertex-coloured) drawn once as an
 * `InstancedMesh` over every `TreeSite`, plus a scattering of rocks on the
 * steep ground above the tree line. Two draw calls, nothing per frame.
 */

import * as THREE from "three";
import { mulberry32 } from "@/lib/game/core/rng";
import { createNearestRun } from "@/lib/game/terrain/real-heightfield";
import type { World } from "../types";
import type { RenderFrame, RenderModule } from "./frame";

const ROCK_COUNT = 200;
const MAX_TREE_INSTANCES = 20_000;
/** Canopy width as a fraction of tree height: a 10 m tree is ~4 m across. */
const WIDTH_PER_HEIGHT = 0.42;
const ROCK_MIN_GRADE = 0.9;

/** Push one triangle with a flat colour. */
function tri(
  positions: number[], colors: number[],
  ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number,
  color: THREE.Color,
): void {
  positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b);
}

/**
 * A unit-height conifer, apex at y = 1, base at y = 0. Sides carry the cone
 * tier colour; the upper faces of each tier (the "shelf" where the tier
 * meets the one above) carry the snow-cap colour.
 */
function buildTreeGeometry(cone: readonly [number, number, number], trunk: number, cap: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const trunkColor = new THREE.Color(trunk);
  const capColor = new THREE.Color(cap);
  const segments = 6;

  // Trunk: a hexagonal prism from 0 to 0.28.
  const trunkR = 0.08, trunkTop = 0.3;
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
    const x0 = Math.cos(a0) * trunkR, z0 = Math.sin(a0) * trunkR;
    const x1 = Math.cos(a1) * trunkR, z1 = Math.sin(a1) * trunkR;
    tri(positions, colors, x0, 0, z0, x1, 0, z1, x1, trunkTop, z1, trunkColor);
    tri(positions, colors, x0, 0, z0, x1, trunkTop, z1, x0, trunkTop, z0, trunkColor);
  }

  // Three tiers, widest at the bottom. Each tier is a cone whose base sits
  // slightly below the previous tier's top so they overlap.
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
      // Side face: base ring → apex.
      tri(positions, colors,
        x0 * tier.radius, tier.base, z0 * tier.radius,
        x1 * tier.radius, tier.base, z1 * tier.radius,
        0, tier.top, 0, tier.color);
      // Snow cap: a shallow upward-facing ring just above the base, sitting on the branches.
      tri(positions, colors,
        x1 * shelfR, shelf, z1 * shelfR,
        x0 * shelfR, shelf, z0 * shelfR,
        0, shelf + (tier.top - shelf) * 0.55, 0, capColor);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export class Trees implements RenderModule {
  private readonly meshes: THREE.Mesh[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  constructor(private readonly scene: THREE.Scene, world: World) {
    this.buildTrees(world);
    this.buildRocks(world);
  }

  private buildTrees(world: World): void {
    const sites = world.trees;
    if (sites.length === 0) return;
    // Densify: one companion tree beside every mapped site, unless it would
    // land on a run. The sites are inside mapped forests, so this doubles the
    // canopy without inventing forest where the survey has none.
    const random = mulberry32(world.seed ^ 0x7ee5);
    const nearest = createNearestRun();
    const trees = sites.slice();
    for (let i = 0; i < sites.length && trees.length < MAX_TREE_INSTANCES; i++) {
      const site = sites[i];
      const angle = random() * Math.PI * 2, distance = 2 + random() * 3;
      const x = site.x + Math.cos(angle) * distance, z = site.z + Math.sin(angle) * distance;
      const hit = world.terrain.nearestRun(x, z, nearest);
      if (hit.run && hit.d < hit.run.halfWidthM + 1.5) continue;
      const variant = random();
      trees.push({ x, y: world.terrain.height(x, z), z, radiusM: site.radiusM, heightM: 4.5 + variant * 8.5, variant });
    }

    const forest = world.profile.forest;
    const geometry = buildTreeGeometry(forest.cone, forest.trunk, forest.cap);
    // `color` stays white: vertex colours are multiplied by it.
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const mesh = new THREE.InstancedMesh(geometry, material, trees.length);
    mesh.castShadow = true;
    mesh.receiveShadow = false;

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
      bounds.expandByPoint(point.set(tree.x, tree.y, tree.z));
      bounds.expandByPoint(point.set(tree.x, tree.y + height, tree.z));
    }
    mesh.instanceMatrix.needsUpdate = true;
    const sphere = new THREE.Sphere();
    bounds.getBoundingSphere(sphere);
    mesh.boundingSphere = sphere;
    mesh.boundingBox = bounds;
    mesh.frustumCulled = true;

    this.scene.add(mesh);
    this.meshes.push(mesh);
    this.geometries.push(geometry);
    this.materials.push(material);
  }

  private buildRocks(world: World): void {
    const random = mulberry32(world.seed ^ 0x0c0c5);
    const normal = { x: 0, y: 1, z: 0 };
    const half = world.halfSizeM * 0.9;
    const placed: Array<{ x: number; y: number; z: number; s: number; r: number }> = [];
    // Bounded search so a resort with no steep ground doesn't spin.
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

    this.scene.add(mesh);
    this.meshes.push(mesh);
    this.geometries.push(geometry);
    this.materials.push(material);
  }

  update(_frame: RenderFrame): void {
    // Static: the forest never moves.
  }

  dispose(): void {
    for (const mesh of this.meshes) this.scene.remove(mesh);
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.meshes.length = 0;
    this.geometries.length = 0;
    this.materials.length = 0;
  }
}
