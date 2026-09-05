import * as THREE from "three";
import { LiftRenderer } from "./LiftRenderer";
import type { ResortGameProfile } from "../config/schema";
import type { SimulationState, SimulationWorld } from "../core/types";
import { GATE_SPACING, LIFT_OFFSET } from "../physics/constants";
import { CHUNK_SIZE, getChunk } from "../terrain/obstacles";
import { RAMP_LEN, RAMP_SPACING, RAMP_W } from "../terrain/heightfield";
import { hash2 } from "../terrain/noise";
import { trailCenter } from "../terrain/trails";
import { pointAtArcLength } from "../terrain/real-course";
import { createStoneTexture } from "./StoneTexture";
import { createForestGeometry, createForestMaterial } from "./ForestImpostor";
import { treeDebugEnabled } from "./debugFlags";
import { createLandmarks } from "./LandmarkRenderer";
import { TrailSigns } from "./TrailSigns";
import { TILE_SIZE } from "./TerrainRenderer";
import { GRID_HALF, GRID_SIZE, Z_TILES_BEHIND } from "./nearFieldReach";

const TOWER_SPACING = 108;
const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), position = new THREE.Vector3(), scale = new THREE.Vector3();
const axisY = new THREE.Vector3(0, 1, 0), axisZ = new THREE.Vector3(0, 0, 1);
/** Shared arc-sample target for lift/marker updates — never retained across frames. */
const arcScratch = { x: 0, y: 0, z: 0, heading: 0 };

type Part = { geometry: THREE.BufferGeometry; color: THREE.ColorRepresentation; matrix: THREE.Matrix4 };
const transform = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));

export function mergeParts(parts: Part[]): THREE.BufferGeometry {
  const positions: number[] = [], normals: number[] = [], colors: number[] = [], uvs: number[] = [];
  for (const part of parts) {
    const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
    geometry.applyMatrix4(part.matrix); geometry.computeVertexNormals();
    const uv = geometry.getAttribute("uv");
    const p = geometry.getAttribute("position"), n = geometry.getAttribute("normal"), color = new THREE.Color(part.color);
    for (let i = 0; i < p.count; i += 1) {
      uvs.push(uv?.getX(i) ?? p.getX(i), uv?.getY(i) ?? p.getZ(i));
      positions.push(p.getX(i), p.getY(i), p.getZ(i)); normals.push(n.getX(i), n.getY(i), n.getZ(i)); colors.push(color.r, color.g, color.b);
    }
    geometry.dispose(); part.geometry.dispose();
  }
  const output = new THREE.BufferGeometry();
  output.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  output.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  output.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  output.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3)); output.computeBoundingSphere(); return output;
}

/**
 * Ceiling on how far a ramp's rail may rise or fall across its 22m run.
 *
 * A real course is a simplified polyline, so one tail segment can cut straight across a cliff
 * band. Sampling 22m further along such a segment reports a drop of tens of metres, and the rail
 * — pitched by `atan2(h, RAMP_LEN)` and centred at `h * 0.5` — then renders as a giant beam
 * hanging in the air above terrain that never falls that fast. 0.6 x RAMP_LEN caps the pitch at
 * ~31 degrees, steeper than any groomed jump and still unmistakably a ramp.
 */
export const RAMP_MAX_RISE = RAMP_LEN * 0.6;

/** How far a ramp group floats above the sampled deck, so the rails rest on the snow rather than in it. */
export const RAMP_DECK_CLEARANCE = 0.2;

/** Lateral offset of the two rails from the ramp's centreline. The deck itself runs to ±RAMP_W. */
export const RAMP_RAIL_OFFSET = RAMP_W * 0.86;

/**
 * Height of the banner panel. Was 1.5 in v1 and 2.2 in the gate rebuild; 1.6 is the projected-area
 * budget talking. Panel area is the whole complaint — see RAMP_BANNER_MAX_AREA.
 */
export const RAMP_BANNER_H = 1.6;
/**
 * Half-span of the panel and of the uprights that carry it, derived from what it has to clear
 * rather than from a fudge factor on RAMP_W.
 *
 * Note RAMP_W is the ramp's *half*-width — `heightfield.ts` rejects `|x - centre| > RAMP_W` — so
 * the deck is 21m across and the rails sit 18.06m apart. A gate that spans this feature is ~19m
 * wide and there is no honest way to make it much narrower: clearing the rails' outer edges
 * (±9.28) is already 18.6m. Span was never where the bulk came from.
 */
export const RAMP_BANNER_HALF_SPAN = RAMP_RAIL_OFFSET + 0.55;
/**
 * Ceiling on the panel's face area, in square metres. Stated as a budget because span is pinned by
 * the feature and height is the only free geometric term — this is the number that stops the panel
 * quietly growing back into a billboard.
 */
export const RAMP_BANNER_MAX_AREA = 32;
/**
 * Clear air under the panel. A skier passes beneath the gate on the run-in, so this cannot go much
 * below 2.5m; it is also what keeps the panel legibly overhead rather than sitting on the snow.
 */
const RAMP_BANNER_UNDER_CLEARANCE = 2.6;
/** Gap between the top edge of the panel and the top of the uprights. */
const RAMP_BANNER_HEADROOM = 0.3;
/** Down-slope offset of the whole gate: it stands just uphill of the ramp's entry. */
const RAMP_BANNER_Z = -1.5;
/**
 * Panel centre, in group-local space where y=0 is the ramp deck at the entry.
 *
 * This has now been wrong three times. It began at 4.2 with nothing holding the panel up, so a 23m
 * plane read as a bar floating in the sky; dropping it to ~1.0 turned it into a ribbon lying on the
 * snow; adding uprights and hanging it at 4.6 fixed the structure but put a 20m x 2.2m near-opaque
 * face across the horizon line at the ~30m viewing distance, which read as a billboard wall.
 *
 * So it is derived from the one thing that is actually a constraint — the clear air a skier needs
 * under it — and everything else follows. Sitting the panel low keeps it against the snow rather
 * than across the skyline, which is most of what stops it reading as a wall.
 */
export const RAMP_BANNER_Y = RAMP_BANNER_UNDER_CLEARANCE + RAMP_BANNER_H / 2;
/** Upright height: the panel's top edge, plus a little mast above it. */
export const RAMP_BANNER_POST_H = RAMP_BANNER_Y + RAMP_BANNER_H / 2 + RAMP_BANNER_HEADROOM;

/** The rise a ramp's rails are actually built to, clamped to a rail-shaped range. */
export function rampRise(startY: number, endY: number): number {
  return Math.max(-RAMP_MAX_RISE, Math.min(RAMP_MAX_RISE, endY - startY));
}

export function sagAt(z: number, zStart: number): number {
  const u = ((z - zStart) % TOWER_SPACING) / TOWER_SPACING;
  return Math.sin(u * Math.PI) * 2.2;
}

export class WorldRenderer {
  private readonly tree: THREE.InstancedMesh; private readonly rock: THREE.InstancedMesh; private readonly markers: THREE.InstancedMesh;
  private readonly gates: THREE.Group[] = []; private readonly ramps: THREE.Group[] = [];
  private readonly lift = new THREE.Group(); private readonly towers: THREE.Group[] = []; private readonly chairs: THREE.Group[] = [];
  private readonly realLiftRenderer: LiftRenderer | null;
  private readonly cableGeometry = new THREE.BufferGeometry();
  private readonly landmarks: THREE.Group | null;
  private readonly trailSigns: TrailSigns | null;
  private propX = Infinity; private propZ = Infinity; private furnitureZ = Infinity; private furnitureTimer = 0;

  constructor(private readonly scene: THREE.Scene, private readonly profile: ResortGameProfile, private readonly world: SimulationWorld) {
    const treeGeometry = createForestGeometry(profile.slug === "heavenly");
    const rockBase = new THREE.IcosahedronGeometry(1, 1);
    const rockPositions = rockBase.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < rockPositions.count; i += 1) {
      const radius = 0.72 + hash2(i * 13, i * 7) * 0.62;
      rockPositions.setXYZ(i, rockPositions.getX(i) * radius, rockPositions.getY(i) * radius * 0.78, rockPositions.getZ(i) * radius);
    }
    rockBase.computeVertexNormals();
    const rockGeometry = mergeParts([
      { geometry: rockBase, color: 0x50535b, matrix: transform(0, 0.55, 0) },
      { geometry: new THREE.SphereGeometry(0.82, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.42), color: 0xeef5ff, matrix: transform(0, 1.05, 0, 1.05, 0.7, 1.05) },
    ]);
    // ?treedbg=1 drops the vertex-colour multiply so a shot can tell "colours lost" from "never applied".
    const propColors = !treeDebugEnabled();
    this.tree = new THREE.InstancedMesh(treeGeometry, createForestMaterial(), 2600);
    this.rock = new THREE.InstancedMesh(rockGeometry, new THREE.MeshStandardMaterial({ map: createStoneTexture(), vertexColors: propColors, roughness: 0.95, metalness: 0.03 }), 900);
    this.tree.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.rock.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tree.frustumCulled = this.rock.frustumCulled = false; this.tree.castShadow = this.rock.castShadow = true;
    const markerGeometry = mergeParts([
      { geometry: new THREE.CylinderGeometry(0.075, 0.075, 2.1, 5), color: 0xff7a1a, matrix: transform(0, 1.05, 0) },
      { geometry: new THREE.CylinderGeometry(0.085, 0.085, 0.35, 5), color: 0x1a1a1e, matrix: transform(0, 1.45, 0) },
    ]);
    this.markers = new THREE.InstancedMesh(markerGeometry, new THREE.MeshStandardMaterial({ vertexColors: propColors, roughness: 0.7 }), 460);
    this.markers.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.markers.frustumCulled = false; this.markers.castShadow = true;
    scene.add(this.tree, this.rock, this.markers);
    this.landmarks = world.terrain.kind === "real" ? createLandmarks(profile, world.terrain) : null;
    if (this.landmarks) scene.add(this.landmarks);
    this.realLiftRenderer = world.terrain.kind === "real" ? new LiftRenderer(scene, world.terrain) : null;
    this.trailSigns = world.terrain.kind === "real" ? new TrailSigns(world.terrain) : null;
    if (this.trailSigns) scene.add(this.trailSigns.group);
    this.buildGates(); this.buildRamps(); if (!this.realLiftRenderer) this.buildLift();
  }

  private buildGates() {
    const poleGeometry = new THREE.CylinderGeometry(0.09, 0.09, 3, 6);
    for (let i = 0; i < 42; i += 1) {
      const group = new THREE.Group(), color = i % 2 ? 0x2f7de0 : 0xe63a4a;
      const poleMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.55, emissive: color, emissiveIntensity: 0.16 });
      const left = new THREE.Mesh(poleGeometry, poleMaterial), right = new THREE.Mesh(poleGeometry, poleMaterial);
      left.position.y = right.position.y = 1.5;
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.9, 6, 2), new THREE.MeshStandardMaterial({ color, roughness: 0.62, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
      panel.position.y = 2.35; group.add(left, right, panel); group.visible = false; group.userData = { left, right, panel, poleMaterial, key: 0 };
      this.gates.push(group); this.scene.add(group);
    }
  }

  private buildRamps() {
    // Shared across all 12 groups: unlike the gates' poles, nothing here is recoloured per ramp.
    const postGeometry = new THREE.CylinderGeometry(0.16, 0.22, RAMP_BANNER_POST_H, 6);
    const postMaterial = new THREE.MeshStandardMaterial({ color: 0x1b2434, roughness: 0.6, metalness: 0.35 });
    for (let i = 0; i < 12; i += 1) {
      const group = new THREE.Group(), railMaterial = new THREE.MeshStandardMaterial({ color: 0xffe08a, roughness: 0.5, emissive: 0xffb020, emissiveIntensity: 0.22 });
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, RAMP_LEN), railMaterial), rail2 = rail.clone();
      rail.position.set(-RAMP_RAIL_OFFSET, 0, RAMP_LEN * 0.5); rail2.position.set(RAMP_RAIL_OFFSET, 0, RAMP_LEN * 0.5);
      // Fabric, not sheet metal. A 19m face is unavoidably large, so it earns its size by being
      // see-through: the run line and the terrain behind the gate stay readable. The old near-black
      // 0x0d1524 at opacity 0.9 with a hot emissive was a saturated block at any size. Transparency
      // matches the gates' panels, which use the same idiom.
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(RAMP_BANNER_HALF_SPAN * 2, RAMP_BANNER_H), new THREE.MeshStandardMaterial({ color: 0x27508f, side: THREE.DoubleSide, emissive: 0x2e6bd0, emissiveIntensity: 0.18, transparent: true, opacity: 0.62 }));
      const postL = new THREE.Mesh(postGeometry, postMaterial), postR = postL.clone();
      postL.position.set(-RAMP_BANNER_HALF_SPAN, RAMP_BANNER_POST_H / 2, RAMP_BANNER_Z);
      postR.position.set(RAMP_BANNER_HALF_SPAN, RAMP_BANNER_POST_H / 2, RAMP_BANNER_Z);
      postL.castShadow = postR.castShadow = true;
      // The gate stands at the ramp's entry, which is the group origin for any rise: the rails are
      // boxes centred at (h/2, RAMP_LEN/2) and pitched about their own centres, so their uphill
      // ends always land back on y=0, z=0. Panel and posts therefore need no rise-dependent
      // transform, only a deck the group is honestly anchored to — see `updateRamps`.
      banner.position.set(0, RAMP_BANNER_Y, RAMP_BANNER_Z);
      group.add(rail, rail2, postL, postR, banner);
      group.userData = { rail, rail2, banner, postL, postR }; group.visible = false;
      this.ramps.push(group); this.scene.add(group);
    }
  }

  private liftX(z: number) { return trailCenter(this.profile.trails[0], z) + LIFT_OFFSET; }
  private cableY(z: number) { return this.world.terrain.height(this.liftX(z), z) + 15.5; }

  private buildLift() {
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa6b5, roughness: 0.55, metalness: 0.55 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b3340, roughness: 0.7, metalness: 0.3 });
    for (let i = 0; i < 9; i += 1) {
      const group = new THREE.Group(), mast = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.62, 15, 8), metal), arm = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.32, 0.32), dark);
      mast.position.y = 7.5; mast.castShadow = true; arm.position.y = 15.2;
      const sheaveL = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.3, 8), dark); sheaveL.rotation.z = Math.PI / 2; sheaveL.position.set(-2, 15.5, 0);
      const sheaveR = sheaveL.clone(); sheaveR.position.x = 2;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.9, 1.1, 8), dark); base.position.y = 0.3;
      group.add(mast, arm, sheaveL, sheaveR, base); group.userData = { sheaveL, sheaveR }; this.towers.push(group); this.lift.add(group);
    }
    this.cableGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(64 * 3 * 2), 3));
    this.lift.add(new THREE.LineSegments(this.cableGeometry, new THREE.LineBasicMaterial({ color: 0x2b3340, transparent: true, opacity: 0.9 })));
    const chairMaterial = new THREE.MeshStandardMaterial({ color: 0xe0463c, roughness: 0.5, metalness: 0.15 });
    for (let i = 0; i < 16; i += 1) {
      const group = new THREE.Group(), hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 5), dark), seat = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.16, 0.75), chairMaterial), back = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.9, 0.14), chairMaterial), bar = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 0.1), dark);
      hanger.position.y = -1.3; seat.position.y = -2.6; seat.castShadow = true; back.position.set(0, -2.2, -0.35); bar.position.set(0, -2.05, 0.45); group.add(hanger, seat, back, bar); this.chairs.push(group); this.lift.add(group);
    }
    this.scene.add(this.lift);
  }

  update(state: SimulationState, dt: number): void {
    this.trailSigns?.update(state);
    this.updateLandmarks(state.pos.x, state.pos.z);
    this.updateProps(state.pos.x, state.pos.z);
    this.furnitureTimer -= dt;
    if (this.furnitureTimer <= 0 || Math.abs(state.pos.z - this.furnitureZ) > 60) {
      this.furnitureTimer = 0.25; this.furnitureZ = state.pos.z;
      this.updateMarkers(state.pos.z); this.updateGates(state); this.updateRamps(state);
    }
    if (this.realLiftRenderer) this.realLiftRenderer.update(state);
    else this.updateLift(state.pos.z, state.time);
  }

  private updateLandmarks(playerX: number, playerZ: number): void {
    if (!this.landmarks) return;
    const cx = Math.floor(playerX / TILE_SIZE), cz = Math.floor(playerZ / TILE_SIZE);
    // Derived from the grid, not transcribed: these must track TerrainRenderer's tile window or
    // landmarks cull against a box the terrain no longer draws.
    const minimumX = (cx - GRID_HALF) * TILE_SIZE, maximumX = (cx + GRID_HALF + 1) * TILE_SIZE;
    const minimumZ = (cz - Z_TILES_BEHIND) * TILE_SIZE, maximumZ = (cz + GRID_SIZE - Z_TILES_BEHIND) * TILE_SIZE;
    for (const landmark of this.landmarks.children) {
      const footprint = landmark.userData.terrainFootprint as { halfX: number; halfZ: number } | undefined;
      if (!footprint) continue;
      landmark.visible = landmark.position.x - footprint.halfX >= minimumX &&
        landmark.position.x + footprint.halfX <= maximumX &&
        landmark.position.z - footprint.halfZ >= minimumZ &&
        landmark.position.z + footprint.halfZ <= maximumZ;
    }
  }

  private updateProps(x: number, z: number) {
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    if (cx === this.propX && cz === this.propZ) return; this.propX = cx; this.propZ = cz;
    let trees = 0, rocks = 0;
    for (let dz = -4; dz <= 4; dz += 1) for (let dx = -4; dx <= 4; dx += 1) for (const item of getChunk(this.world, cx + dx, cz + dz)) {
      quaternion.setFromAxisAngle(axisY, item.rot);
      if (item.type === "tree" && trees < 2600) {
        matrix.compose(position.set(item.x, item.y - 0.25, item.z), quaternion, scale.set(item.s, item.s * (0.9 + item.rot % 0.4), item.s)); this.tree.setMatrixAt(trees++, matrix);
      } else if (item.type === "rock" && rocks < 900) {
        matrix.compose(position.set(item.x, item.y - 0.28 * item.s, item.z), quaternion, scale.set(item.s, item.s * 0.85, item.s)); this.rock.setMatrixAt(rocks++, matrix);
      }
    }
    this.tree.count = trees; this.rock.count = rocks; this.tree.instanceMatrix.needsUpdate = this.rock.instanceMatrix.needsUpdate = true;
  }

  private updateMarkers(playerZ: number) {
    if (this.world.terrain.kind === "real" && this.world.terrain.realRuns) {
      let count = 0;
      const total = this.world.terrain.realRuns.reduce((sum, run) => sum + run.lengthM, 0);
      const spacing = Math.max(20, total / 220);
      for (const run of this.world.terrain.realRuns) {
        for (let distanceM = 0; distanceM <= run.lengthM && count + 1 < 460; distanceM += spacing) {
          const point = pointAtArcLength(run.points, distanceM, arcScratch);
          for (const side of [-1, 1]) {
            const x = point.x + Math.cos(point.heading) * side * run.halfWidthM;
            const z = point.z - Math.sin(point.heading) * side * run.halfWidthM;
            quaternion.setFromAxisAngle(axisZ, Math.sin(distanceM * 0.3) * 0.09);
            matrix.compose(position.set(x, this.world.terrain.height(x, z), z), quaternion, scale.set(1, 1, 1));
            this.markers.setMatrixAt(count++, matrix);
          }
        }
      }
      this.markers.count = count; this.markers.instanceMatrix.needsUpdate = true;
      return;
    }
    let count = 0;
    const z0 = Math.floor((playerZ - 90) / 20) * 20;
    for (const trail of this.profile.trails) for (let z = z0; z < playerZ + 620 && count < 460; z += 20) for (const side of [-1, 1]) {
      const x = trailCenter(trail, z) + side * trail.half; quaternion.setFromAxisAngle(axisZ, Math.sin(z * 0.3) * 0.09);
      matrix.compose(position.set(x, this.world.terrain.height(x, z), z), quaternion, scale.set(1, 1, 1)); this.markers.setMatrixAt(count++, matrix);
    }
    this.markers.count = count; this.markers.instanceMatrix.needsUpdate = true;
  }

  private updateGates(state: SimulationState) {
    if (this.world.terrain.kind === "real" && this.world.terrain.realRuns) {
      const run = this.world.terrain.realRuns[state.selectedTrail]; let count = 0;
      for (const gate of run?.gates ?? []) {
        if (count >= this.gates.length) break;
        const group = this.gates[count++]; group.visible = true;
        // Terrain, not `gate.y`, for the same reason the ramps use it: the chord between polyline
        // vertices measured up to 17.5m off the drawn heightfield on Roca Jack.
        group.position.set(gate.x, this.world.terrain.height(gate.x, gate.z), gate.z); group.rotation.y = gate.heading;
        group.userData.left.position.x = -gate.halfWidthM; group.userData.right.position.x = gate.halfWidthM;
        group.userData.panel.scale.x = gate.halfWidthM * 2;
        const done = state.passedGates.has(state.selectedTrail * 100003 + gate.key);
        group.userData.panel.material.opacity = done ? 0.22 : 0.9;
        group.userData.poleMaterial.emissiveIntensity = done ? 0.02 : 0.16;
      }
      for (let i = count; i < this.gates.length; i += 1) this.gates[i].visible = false;
      return;
    }
    let count = 0;
    for (let ti = 0; ti < this.profile.trails.length; ti += 1) {
      const trail = this.profile.trails[ti], start = Math.floor((state.pos.z - 40) / GATE_SPACING);
      for (let k = start; k < start + 7 && count < this.gates.length; k += 1) {
        if (k < 1) continue; const z = k * GATE_SPACING + ti * 31, x = trailCenter(trail, z), half = trail.half * 0.52, group = this.gates[count++];
        group.visible = true; group.position.set(x, this.world.terrain.height(x, z), z); group.userData.left.position.x = -half; group.userData.right.position.x = half; group.userData.panel.scale.x = half * 2;
        const done = state.passedGates.has(ti * 100003 + k); group.userData.panel.material.opacity = done ? 0.22 : 0.9; group.userData.poleMaterial.emissiveIntensity = done ? 0.02 : 0.16;
      }
    }
    for (let i = count; i < this.gates.length; i += 1) this.gates[i].visible = false;
  }

  private updateRamps(state: SimulationState) {
    if (this.world.terrain.kind === "real" && this.world.terrain.realRuns) {
      const run = this.world.terrain.realRuns[state.selectedTrail] ?? this.world.terrain.realRuns[0];
      let count = 0;
      for (const ramp of run?.ramps ?? []) {
        if (count >= this.ramps.length) break;
        const end = pointAtArcLength(run.points, Math.min(run.lengthM, ramp.distanceM + RAMP_LEN), arcScratch);
        const group = this.ramps[count++]; group.visible = true;
        // Deck height comes from the heightfield, never from `ramp.y`. A run polyline is a chord
        // between simplified vertices, so on Portillo's Roca Jack it runs 5.5-9.9m above the snow
        // that is actually drawn — which floated the whole ramp, banner included, into the sky.
        // The procedural branch below has always sampled the terrain; this now matches it.
        const deckY = this.world.terrain.height(ramp.x, ramp.z);
        group.position.set(ramp.x, deckY + RAMP_DECK_CLEARANCE, ramp.z); group.rotation.y = ramp.heading;
        const h = rampRise(deckY, this.world.terrain.height(end.x, end.z));
        group.userData.rail.rotation.x = group.userData.rail2.rotation.x = -Math.atan2(h, RAMP_LEN);
        group.userData.rail.position.y = group.userData.rail2.position.y = h * 0.5;
      }
      for (let i = count; i < this.ramps.length; i += 1) this.ramps[i].visible = false;
      return;
    }
    const playerZ = state.pos.z;
    let count = 0;
    for (const trail of this.profile.trails) {
      const first = Math.max(0, Math.floor((playerZ - 60 - trail.ramp) / RAMP_SPACING));
      for (let k = first; k < first + 2 && count < this.ramps.length; k += 1) {
        const z = trail.ramp + k * RAMP_SPACING; if (z < -200 || z > playerZ + 620) continue;
        const x = trailCenter(trail, z + RAMP_LEN * 0.5), group = this.ramps[count++], h = rampRise(this.world.terrain.height(x, z), this.world.terrain.height(x, z + RAMP_LEN));
        group.visible = true; group.position.set(x, this.world.terrain.height(x, z) + RAMP_DECK_CLEARANCE, z); group.userData.rail.rotation.x = group.userData.rail2.rotation.x = -Math.atan2(h, RAMP_LEN); group.userData.rail.position.y = group.userData.rail2.position.y = h * 0.5;
      }
    }
    for (let i = count; i < this.ramps.length; i += 1) this.ramps[i].visible = false;
  }

  private updateLift(playerZ: number, time: number) {
    const realLift = this.world.terrain.kind === "real" ? this.world.terrain.mainLift : null;
    if (realLift) {
      for (let i = 0; i < this.towers.length; i += 1) {
        const point = pointAtArcLength(realLift.points, realLift.lengthM * i / (this.towers.length - 1), arcScratch);
        const tower = this.towers[i]; tower.position.set(point.x, point.y, point.z); tower.rotation.y = point.heading;
        tower.userData.sheaveL.rotation.y = time * 3.1; tower.userData.sheaveR.rotation.y = -time * 3.1;
      }
      const cable = this.cableGeometry.getAttribute("position") as THREE.BufferAttribute; let at = 0;
      for (const side of [-2, 2]) for (let i = 0; i < 31; i += 1) {
        for (const index of [i * 2, i * 2 + 2]) {
          const distanceM = realLift.lengthM * index / 63;
          const point = pointAtArcLength(realLift.points, distanceM, arcScratch);
          cable.setXYZ(at++, point.x + Math.cos(point.heading) * side, point.y + 15.5 - sagAt(distanceM, 0), point.z - Math.sin(point.heading) * side);
        }
      }
      cable.needsUpdate = true;
      for (let i = 0; i < this.chairs.length; i += 1) {
        const side = i % 2, t = (((time * (side ? -1 : 1) * 4.6) / realLift.lengthM + i * 0.62) % 1 + 1) % 1;
        const point = pointAtArcLength(realLift.points, realLift.lengthM * t, arcScratch), chair = this.chairs[i];
        chair.position.set(point.x + Math.cos(point.heading) * (side ? 2 : -2), point.y + 15.5 - sagAt(realLift.lengthM * t, 0), point.z - Math.sin(point.heading) * (side ? 2 : -2));
        chair.rotation.set(0, point.heading + (side ? Math.PI : 0), Math.sin(time * 1.7 + i) * 0.05);
      }
      return;
    }
    const k0 = Math.floor((playerZ - 140) / TOWER_SPACING), zStart = k0 * TOWER_SPACING, zEnd = (k0 + 8) * TOWER_SPACING;
    for (let i = 0; i < this.towers.length; i += 1) { const z = (k0 + i) * TOWER_SPACING, tower = this.towers[i]; tower.position.set(this.liftX(z), this.world.terrain.height(this.liftX(z), z), z); tower.userData.sheaveL.rotation.y = time * 3.1; tower.userData.sheaveR.rotation.y = -time * 3.1; }
    const cable = this.cableGeometry.getAttribute("position") as THREE.BufferAttribute;
    const step = (zEnd - zStart) / 63;
    let at = 0;
    for (const side of [-2, 2]) for (let i = 0; i < 31; i += 1) { const za = zStart + i * step * 2, zb = za + step * 2; cable.setXYZ(at++, this.liftX(za) + side, this.cableY(za) - sagAt(za, zStart), za); cable.setXYZ(at++, this.liftX(zb) + side, this.cableY(zb) - sagAt(zb, zStart), zb); }
    cable.needsUpdate = true;
    for (let i = 0; i < this.chairs.length; i += 1) { const side = i % 2, t = (((time * (side ? -1 : 1) * 4.6) / TOWER_SPACING + i * 0.62) % 1 + 1) % 1, z = zStart + t * (zEnd - zStart), chair = this.chairs[i]; chair.position.set(this.liftX(z) + (side ? 2 : -2), this.cableY(z) - sagAt(z, zStart), z); chair.rotation.set(0, side ? Math.PI : 0, Math.sin(time * 1.7 + i) * 0.05); }
  }
}
