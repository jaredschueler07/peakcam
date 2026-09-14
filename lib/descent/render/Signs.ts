/**
 * lib/descent/render/Signs.ts
 * ───────────────────────────
 * Everything written on the mountain: the start gate and finish banner of the
 * line being ridden, its checkpoint poles, a signpost at every mapped
 * junction naming the runs that leave it, and the optional trail-hint line.
 *
 * Text is rasterised once into `CanvasTexture`s. Without a DOM (tests, SSR)
 * boards fall back to plain untextured planes. Course props are rebuilt only
 * when `frame.courseIndex` changes; junction posts are built once.
 */

import * as THREE from "three";
import type { Course, RealJunction, World } from "../types";
import type { RenderFrame, RenderModule } from "./frame";

const POST_COLOR = 0x23262b;
const BOARD_COLOR = 0xe8ebe6;
const BOARD_INK = "#23262b";
const BAND_COLOR = 0x1c1e22;
const HINT_HEIGHT_M = 0.3;

const GRADE_COLORS: Record<string, string> = {
  easy: "#3ad686", novice: "#3ad686",
  intermediate: "#3ea0ff",
  advanced: "#1b1f27", expert: "#1b1f27",
  extreme: "#ff9f43", freeride: "#ff9f43",
};

function gradeColor(difficulty: string | null): string {
  return (difficulty && GRADE_COLORS[difficulty.toLowerCase()]) || "#8a8f99";
}

interface Board {
  mesh: THREE.Mesh;
  disposables: Array<{ dispose(): void }>;
}

/**
 * A text board: a lit plane with the label rasterised onto it. `dot` paints a
 * difficulty marker in front of the text. Returns an untextured plane when
 * there is no DOM to draw with.
 */
function makeBoard(text: string, widthM: number, heightM: number, options: { dot?: string; fontPx?: number } = {}): Board {
  const geometry = new THREE.PlaneGeometry(widthM, heightM);
  const disposables: Array<{ dispose(): void }> = [geometry];
  let material: THREE.Material;
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = Math.max(64, Math.round((1024 * heightM) / widthM));
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#e8ebe6";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = BOARD_INK;
      context.lineWidth = Math.max(6, canvas.height * 0.06);
      context.strokeRect(context.lineWidth / 2, context.lineWidth / 2, canvas.width - context.lineWidth, canvas.height - context.lineWidth);
      const fontPx = options.fontPx ?? Math.round(canvas.height * 0.48);
      context.font = `bold ${fontPx}px ui-monospace, Menlo, Consolas, monospace`;
      context.textBaseline = "middle";
      context.fillStyle = BOARD_INK;
      let textX = canvas.width / 2;
      context.textAlign = "center";
      if (options.dot) {
        const r = canvas.height * 0.2;
        context.fillStyle = options.dot;
        context.beginPath();
        context.arc(r * 2.2, canvas.height / 2, r, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = BOARD_INK;
        context.textAlign = "left";
        textX = r * 4.2;
      }
      // Shrink to fit.
      let size = fontPx;
      const maxWidth = options.dot ? canvas.width - textX - 40 : canvas.width - 80;
      while (size > 18 && context.measureText(text).width > maxWidth) {
        size -= 4;
        context.font = `bold ${size}px ui-monospace, Menlo, Consolas, monospace`;
      }
      context.fillText(text, textX, canvas.height / 2 + size * 0.05);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    material = new THREE.MeshLambertMaterial({ map: texture, side: THREE.DoubleSide });
    disposables.push(texture);
  } else {
    material = new THREE.MeshLambertMaterial({ color: BOARD_COLOR, side: THREE.DoubleSide });
  }
  disposables.push(material);
  const mesh = new THREE.Mesh(geometry, material);
  return { mesh, disposables };
}

/** Append a unit box, transformed, into merged arrays. */
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

class BoxBatch {
  readonly positions: number[] = [];
  readonly colors: number[] = [];
  private readonly box = new THREE.BoxGeometry(1, 1, 1);
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);

  add(x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, color: THREE.Color): void {
    this.position.set(x, y, z);
    this.quaternion.setFromAxisAngle(this.yAxis, yaw);
    this.scale.set(sx, sy, sz);
    this.matrix.compose(this.position, this.quaternion, this.scale);
    appendBox(this.positions, this.colors, this.box, this.matrix, color, this.scratch);
  }

  /** Bake into a flat-shaded mesh; returns null when nothing was added. */
  build(): { mesh: THREE.Mesh; disposables: Array<{ dispose(): void }> } | null {
    this.box.dispose();
    if (this.positions.length === 0) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.computeVertexNormals();
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    return { mesh, disposables: [geometry, material] };
  }
}

export class Signs implements RenderModule {
  private readonly group = new THREE.Group();
  private readonly junctionGroup = new THREE.Group();
  private readonly courseGroup = new THREE.Group();
  private readonly junctionDisposables: Array<{ dispose(): void }> = [];
  private courseDisposables: Array<{ dispose(): void }> = [];
  private builtCourseIndex = -1;
  private hintLine: THREE.Line | null = null;
  private readonly accent: THREE.Color;
  private readonly accent2: number;

  constructor(private readonly scene: THREE.Scene, private readonly world: World) {
    this.accent = new THREE.Color(world.profile.accent);
    this.accent2 = new THREE.Color(world.profile.accent2).getHex();
    this.group.add(this.junctionGroup, this.courseGroup);
    this.buildJunctions(world.junctions);
    this.scene.add(this.group);
  }

  // ─── Junctions ─────────────────────────────────────────────

  private buildJunctions(junctions: readonly RealJunction[]): void {
    const posts = new BoxBatch();
    const postColor = new THREE.Color(POST_COLOR);
    for (const junction of junctions) {
      // Post at the edge of the corridor so it never sits in the line.
      const side = Math.min(junction.halfWidthM, 12) + 1.5;
      const sx = Math.cos(junction.heading), sz = -Math.sin(junction.heading);
      const px = junction.x + sx * side, pz = junction.z + sz * side;
      const py = this.world.terrain.height(px, pz);
      const postH = 2.2;
      posts.add(px, py + postH / 2, pz, 0.14, postH, 0.14, junction.heading, postColor);
      // Boards face uphill: a rider descending along `heading` reads them.
      const facing = junction.heading + Math.PI;
      const choices = junction.choices.slice(0, 4);
      choices.forEach((choice, i) => {
        const board = makeBoard(choice.name.toUpperCase(), 1.6, 0.4, { dot: gradeColor(choice.difficulty), fontPx: 120 });
        board.mesh.position.set(px, py + postH - 0.26 - i * 0.46, pz);
        board.mesh.rotation.y = facing;
        this.junctionGroup.add(board.mesh);
        this.junctionDisposables.push(...board.disposables);
      });
    }
    const built = posts.build();
    if (built) {
      this.junctionGroup.add(built.mesh);
      this.junctionDisposables.push(...built.disposables);
    }
  }

  // ─── Course props ──────────────────────────────────────────

  private buildCourse(course: Course): void {
    this.clearCourse();
    const run = course.run;
    const span = Math.min(14, Math.max(8, run.halfWidthM * 2));
    const batch = new BoxBatch();
    const postColor = new THREE.Color(POST_COLOR);
    const bandColor = new THREE.Color(BAND_COLOR);

    const gate = (at: { x: number; y: number; z: number; yaw: number }, label: string) => {
      const sx = Math.cos(at.yaw), sz = -Math.sin(at.yaw);
      const half = span / 2;
      const boardH = 2.0, boardBottom = 4.6, postH = boardBottom + boardH;
      for (const dir of [-1, 1]) {
        const px = at.x + sx * half * dir, pz = at.z + sz * half * dir;
        const py = this.world.terrain.height(px, pz);
        batch.add(px, py + postH / 2, pz, 0.3, postH, 0.3, at.yaw, postColor);
      }
      const board = makeBoard(label, span, boardH, { fontPx: 110 });
      board.mesh.position.set(at.x, at.y + boardBottom + boardH / 2, at.z);
      board.mesh.rotation.y = at.yaw + Math.PI;
      this.courseGroup.add(board.mesh);
      this.courseDisposables.push(...board.disposables);
    };
    gate(course.start, `${course.name.toUpperCase()} // DROP IN`);
    gate(course.finish, `FINISH // ${course.name.toUpperCase()}`);

    // Checkpoint poles either side of the centreline.
    for (const cp of course.gates) {
      const sx = Math.cos(cp.heading), sz = -Math.sin(cp.heading);
      for (const dir of [-1, 1]) {
        const px = cp.x + sx * cp.halfWidthM * dir, pz = cp.z + sz * cp.halfWidthM * dir;
        const py = this.world.terrain.height(px, pz);
        batch.add(px, py + 0.8, pz, 0.12, 1.6, 0.12, cp.heading, this.accent);
        batch.add(px, py + 1.25, pz, 0.14, 0.2, 0.14, cp.heading, bandColor);
      }
    }
    const built = batch.build();
    if (built) {
      this.courseGroup.add(built.mesh);
      this.courseDisposables.push(...built.disposables);
    }

    // Trail hint: the centreline, resampled every few metres and lifted above the snow.
    const points: number[] = [];
    const pts = run.points;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.max(1, Math.ceil(length / 6));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        points.push(x, this.world.terrain.height(x, z) + HINT_HEIGHT_M, z);
      }
    }
    const last = pts[pts.length - 1];
    points.push(last.x, this.world.terrain.height(last.x, last.z) + HINT_HEIGHT_M, last.z);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    const material = new THREE.LineDashedMaterial({ color: this.accent2, dashSize: 3, gapSize: 2, linewidth: 2 });
    const line = new THREE.Line(geometry, material);
    line.computeLineDistances();
    line.visible = false;
    this.hintLine = line;
    this.courseGroup.add(line);
    this.courseDisposables.push(geometry, material);
  }

  private clearCourse(): void {
    this.courseGroup.clear();
    for (const item of this.courseDisposables) item.dispose();
    this.courseDisposables = [];
    this.hintLine = null;
  }

  update(frame: RenderFrame): void {
    if (frame.courseIndex !== this.builtCourseIndex) {
      const course = this.world.courses[frame.courseIndex];
      if (course) {
        this.buildCourse(course);
        this.builtCourseIndex = frame.courseIndex;
      }
    }
    if (this.hintLine) this.hintLine.visible = frame.trailHint;
  }

  dispose(): void {
    this.clearCourse();
    this.junctionGroup.clear();
    for (const item of this.junctionDisposables) item.dispose();
    this.junctionDisposables.length = 0;
    this.scene.remove(this.group);
    this.builtCourseIndex = -1;
  }
}
