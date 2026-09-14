/**
 * lib/descent/render/Lifts.ts
 * ───────────────────────────
 * Every mapped lift at the resort: towers under each cable support, a dark
 * terminal shed at either end, the cable as a single line, and — for chairs
 * and gondolas — chairs riding the cable at the lift's real speed. Towers,
 * terminals and cables are static and merged into one mesh each; the chairs
 * are one `InstancedMesh` whose matrices are the only per-frame write.
 */

import * as THREE from "three";
import { prepareLiftPath, sampleLiftPath, type LiftPath, type LiftSample } from "@/lib/game/core/lifts";
import type { World } from "../types";
import type { RenderFrame, RenderModule } from "./frame";

const CHAIR_SPACING_M = 60;
const MAX_CHAIRS = 400;
const TOWER_COLOR = 0x3b3f45;
const TERMINAL_COLOR = 0x4a4f57;
const TERMINAL_ROOF_COLOR = 0x8f96a0;
const CABLE_COLOR = 0x22262b;
const CHAIR_COLOR = 0x3d5a80;
const HANGER_COLOR = 0x2a2d33;

interface ChairLane {
  path: LiftPath;
  speedMps: number;
  /** Chair index range in the instanced mesh. */
  first: number;
  count: number;
  /** Initial offset along the cable for each chair (spread evenly). */
  offsetM: number;
}

function isCarrier(type: string): boolean {
  return /chair_lift|gondola|cable_car|mixed_lift/.test(type);
}

/** Append a transformed box to the merged position/color arrays. */
function appendBox(
  positions: number[], colors: number[], box: THREE.BoxGeometry,
  matrix: THREE.Matrix4, color: THREE.Color, scratch: THREE.Vector3,
): void {
  const source = box.getAttribute("position");
  const index = box.getIndex();
  const push = (i: number) => {
    scratch.fromBufferAttribute(source, i).applyMatrix4(matrix);
    positions.push(scratch.x, scratch.y, scratch.z);
    colors.push(color.r, color.g, color.b);
  };
  if (index) for (let i = 0; i < index.count; i++) push(index.getX(i));
  else for (let i = 0; i < source.count; i++) push(i);
}

export class Lifts implements RenderModule {
  private readonly group = new THREE.Group();
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly lanes: ChairLane[] = [];
  private chairs: THREE.InstancedMesh | null = null;
  private readonly dummy = new THREE.Object3D();
  private readonly sample: LiftSample = { x: 0, y: 0, z: 0, heading: 0 };

  constructor(private readonly scene: THREE.Scene, world: World) {
    const height = (x: number, z: number) => world.terrain.height(x, z);
    const positions: number[] = [];
    const colors: number[] = [];
    const cablePositions: number[] = [];
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const scratch = new THREE.Vector3();
    const towerColor = new THREE.Color(TOWER_COLOR);
    const terminalColor = new THREE.Color(TERMINAL_COLOR);
    const roofColor = new THREE.Color(TERMINAL_ROOF_COLOR);
    const yAxis = new THREE.Vector3(0, 1, 0);

    const place = (x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, color: THREE.Color) => {
      position.set(x, y, z);
      quaternion.setFromAxisAngle(yAxis, yaw);
      scale.set(sx, sy, sz);
      matrix.compose(position, quaternion, scale);
      appendBox(positions, colors, unitBox, matrix, color, scratch);
    };

    let chairTotal = 0;
    for (const entry of world.lifts) {
      const lift = entry.lift;
      if (lift.points.length < 2) continue;
      const path = prepareLiftPath(lift, height);
      const carrier = isCarrier(lift.type);
      const supports = path.supports;

      for (let i = 0; i < supports.length; i++) {
        const s = supports[i];
        const ground = height(s.x, s.z);
        const next = supports[Math.min(i + 1, supports.length - 1)];
        const prev = supports[Math.max(i - 1, 0)];
        const yaw = Math.atan2(next.x - prev.x, next.z - prev.z);
        const terminal = !path.surface && (i === 0 || i === supports.length - 1);
        if (terminal) {
          // A squat shed straddling the cable, sitting on the ground.
          place(s.x, ground + 2, s.z, 6, 4, 4, yaw, terminalColor);
          place(s.x, ground + 4.25, s.z, 7, 0.5, 5, yaw, roofColor);
          continue;
        }
        const top = s.y;
        if (top - ground < 0.5) continue;
        const towerW = path.surface ? 0.5 : 0.9;
        place(s.x, (ground + top) / 2, s.z, towerW, top - ground, towerW, yaw, towerColor);
        // Crossarm at the top, perpendicular to the cable.
        place(s.x, top, s.z, path.surface ? 1.8 : 3, 0.5, 0.5, yaw, towerColor);
      }

      for (let i = 0; i < path.points.length; i++) {
        const p = path.points[i];
        if (i > 0) cablePositions.push(p.x, p.y, p.z);
        if (i < path.points.length - 1) cablePositions.push(p.x, p.y, p.z);
      }

      if (carrier && path.lengthM > CHAIR_SPACING_M && chairTotal < MAX_CHAIRS) {
        const count = Math.min(MAX_CHAIRS - chairTotal, Math.max(1, Math.floor(path.lengthM / CHAIR_SPACING_M)));
        this.lanes.push({ path, speedMps: entry.speedMps, first: chairTotal, count, offsetM: path.lengthM / count });
        chairTotal += count;
      }
    }

    if (positions.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geometry.computeVertexNormals();
      const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      this.group.add(mesh);
      this.disposables.push(geometry, material);
    }

    if (cablePositions.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(cablePositions, 3));
      const material = new THREE.LineBasicMaterial({ color: CABLE_COLOR });
      const cable = new THREE.LineSegments(geometry, material);
      this.group.add(cable);
      this.disposables.push(geometry, material);
    }

    if (chairTotal > 0) {
      // Seat + hanger merged into one geometry with vertex colours.
      const chairPositions: number[] = [];
      const chairColors: number[] = [];
      const seat = new THREE.Color(CHAIR_COLOR), hanger = new THREE.Color(HANGER_COLOR);
      const build = (x: number, y: number, z: number, sx: number, sy: number, sz: number, color: THREE.Color) => {
        position.set(x, y, z); quaternion.identity(); scale.set(sx, sy, sz);
        matrix.compose(position, quaternion, scale);
        appendBox(chairPositions, chairColors, unitBox, matrix, color, scratch);
      };
      // Origin is the cable grip; the chair hangs below it.
      build(0, -1.4, 0, 0.12, 2.8, 0.12, hanger);   // hanger bar
      build(0, -2.9, 0, 1.8, 0.16, 0.7, seat);       // seat
      build(0, -2.5, -0.35, 1.8, 0.8, 0.1, seat);    // backrest
      build(0, -2.4, 0.3, 1.9, 0.08, 0.08, hanger);  // safety bar
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(chairPositions, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(chairColors, 3));
      geometry.computeVertexNormals();
      const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
      const mesh = new THREE.InstancedMesh(geometry, material, chairTotal);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.chairs = mesh;
      this.group.add(mesh);
      this.disposables.push(geometry, material);
      this.updateChairs(0);
    }

    unitBox.dispose();
    this.scene.add(this.group);
  }

  private updateChairs(time: number): void {
    const chairs = this.chairs;
    if (!chairs) return;
    const dummy = this.dummy;
    const sample = this.sample;
    for (const lane of this.lanes) {
      const travelled = time * lane.speedMps;
      for (let i = 0; i < lane.count; i++) {
        let d = (lane.offsetM * i + travelled) % lane.path.lengthM;
        if (d < 0) d += lane.path.lengthM;
        sampleLiftPath(lane.path, d, sample);
        dummy.position.set(sample.x, sample.y, sample.z);
        dummy.rotation.set(0, sample.heading, 0);
        dummy.updateMatrix();
        chairs.setMatrixAt(lane.first + i, dummy.matrix);
      }
    }
    chairs.instanceMatrix.needsUpdate = true;
  }

  update(frame: RenderFrame): void {
    if (frame.quality === 2 && frame.phase === "riding") return;
    this.updateChairs(frame.time);
  }

  dispose(): void {
    this.scene.remove(this.group);
    for (const item of this.disposables) item.dispose();
    this.disposables.length = 0;
    this.lanes.length = 0;
    this.chairs = null;
  }
}
