import { test } from "node:test";
import assert from "node:assert";
import * as THREE from "three";
import type { RealJunction, RealLift, RealRun } from "@/lib/game/core/types";
import type { Course, World } from "../types";
import type { RenderFrame } from "./frame";
import { Trees } from "./Trees";
import { Lifts } from "./Lifts";
import { Signs } from "./Signs";
import { Lake } from "./Lake";
import { Lanes } from "./Lanes";

/** A gentle south-facing slope: z grows → elevation falls. */
function height(x: number, z: number): number {
  return 3000 - z * 0.3 + Math.sin(x * 0.05) * 2;
}

function normal(x: number, z: number, out: { x: number; y: number; z: number }) {
  const dx = (height(x + 0.5, z) - height(x - 0.5, z));
  const dz = (height(x, z + 0.5) - height(x, z - 0.5));
  const len = Math.hypot(dx, 1, dz);
  out.x = -dx / len; out.y = 1 / len; out.z = -dz / len;
  return out;
}

function stubWorld(): World {
  const runPoints = [
    { x: 0, y: height(0, -200), z: -200 },
    { x: 10, y: height(10, -100), z: -100 },
    { x: 0, y: height(0, 0), z: 0 },
  ];
  const run: RealRun = {
    id: "osm:way:1:0", kind: "real", sourceIndex: 0, name: "Test Bowl", difficulty: "expert",
    halfWidthM: 12, points: runPoints, lengthM: 201, finishM: 201,
    gates: [
      { key: 0, distanceM: 60, x: 6, y: height(6, -140), z: -140, heading: 0, halfWidthM: 6 },
      { key: 1, distanceM: 140, x: 5, y: height(5, -60), z: -60, heading: 0, halfWidthM: 6 },
    ],
    ramps: [],
  };
  const course: Course = {
    id: run.id!, name: run.name, difficulty: run.difficulty, run,
    gates: run.gates.map((g) => ({ distanceM: g.distanceM, x: g.x, y: g.y, z: g.z, heading: g.heading, halfWidthM: g.halfWidthM })),
    lengthM: run.lengthM, topElevationM: runPoints[0].y, bottomElevationM: runPoints[2].y,
    start: { ...runPoints[0], yaw: Math.atan2(10, 100) },
    finish: { ...runPoints[2], yaw: Math.atan2(-10, 100) },
  };
  const lift: RealLift = {
    kind: "real", name: "Test Chair", type: "chair_lift", complete: true,
    points: [
      { x: 40, y: height(40, 0), z: 0 },
      { x: 45, y: height(45, -120), z: -120 },
      { x: 50, y: height(50, -250), z: -250 },
    ],
    lengthM: 251,
    stations: [{ x: 40, y: height(40, 0), z: 0, radiusM: 12 }, { x: 50, y: height(50, -250), z: -250, radiusM: 12 }],
  };
  const junction: RealJunction = {
    id: "j1", x: 5, y: height(5, -100), z: -100, heading: 0, halfWidthM: 12,
    choices: [{ id: "a", name: "Test Bowl", difficulty: "expert" }, { id: "b", name: "Cat Track", difficulty: "easy" }],
  };
  const nearestRun = (x: number, z: number, out: { i: number; run: unknown; d: number; x: number; z: number; on: boolean }) => {
    out.i = 0; out.run = run; out.d = Math.hypot(x - 5, 0); out.x = 5; out.z = z; out.on = out.d <= run.halfWidthM;
    return out;
  };
  const drapedRuns = [
    { id: run.id, name: run.name, difficulty: "expert", points: runPoints, halfWidthM: 12 },
    { id: "osm:way:2:0", name: "Cat Track", difficulty: "easy", points: [{ x: 60, y: height(60, -150), z: -150 }, { x: 80, y: height(80, -80), z: -80 }], halfWidthM: 30 },
    { id: "osm:way:3:0", name: "Stub", difficulty: null, points: [{ x: 0, y: 0, z: 0 }], halfWidthM: 8 },
  ];
  const terrain = { height, normal, nearestRun, runs: drapedRuns } as unknown as World["terrain"];
  const profile = {
    slug: "breckenridge", accent: "#3d7fd6", accent2: "#ffd166",
    forest: { treeline: 0.4, rockBias: 0.1, rockKeep: 0.5, treeScale: 1, trunk: 0x4a3628, cone: [0x1d3c28, 0x244a30, 0x2e5a3a], cap: 0xdfeaf5 },
    weather: [{ name: "Bluebird" }],
  } as unknown as World["profile"];
  return {
    profile,
    conditions: { surface: "packed" } as World["conditions"],
    seed: 7,
    terrain,
    sampler: terrain,
    halfSizeM: 500,
    courses: [course],
    lifts: [{ index: 0, lift, name: lift.name, rideable: true, base: { x: 40, y: height(40, 0), z: 0, radiusM: 12 }, top: { x: 50, y: height(50, -250), z: -250, radiusM: 12 }, speedMps: 2.5 }],
    junctions: [junction],
    trees: [
      { x: -30, y: height(-30, -50), z: -50, radiusM: 0.5, heightM: 9, variant: 0.2 },
      { x: 30, y: height(30, -80), z: -80, radiusM: 0.7, heightM: 12, variant: 0.8 },
    ],
    treeCells: new Map(),
    treeCellM: 16,
    farField: null,
    lakes: [{ name: "Test Lake", elevationM: 2800, outer: [{ x: -100, z: 300 }, { x: 100, z: 300 }, { x: 100, z: 450 }, { x: -100, z: 450 }] }],
    treeLineM: 3500,
  };
}

function frame(world: World, overrides: Partial<RenderFrame> = {}): RenderFrame {
  return {
    state: {} as RenderFrame["state"], world, time: 1.5, dt: 1 / 60,
    camera: new THREE.PerspectiveCamera(), cameraPreset: "chase",
    weather: world.profile.weather[0], weatherIndex: 0, phase: "riding", courseIndex: 0, trailHint: false, quality: 0,
    ...overrides,
  };
}

test("Trees tiles sites into near/far instanced pairs and switches by camera distance", () => {
  const base = stubWorld();
  // Sites at x = -30, 30 and 700 fall into three different 512 m tiles.
  const world: World = { ...base, trees: [...base.trees, { x: 700, y: height(700, -50), z: -50, radiusM: 0.5, heightM: 16, variant: 0.5 }] };
  const scene = new THREE.Scene();
  const trees = new Trees(scene, world);
  assert.strictEqual(trees.treeCount, 3);
  assert.strictEqual(trees.tileCount, 3);
  const group = scene.children[0] as THREE.Group;
  const instanced = group.children.filter((c) => c instanceof THREE.InstancedMesh) as THREE.InstancedMesh[];
  assert.strictEqual(instanced.length, 6, "three tiles × near+far, no rocks on the gentle stub slope");
  for (const mesh of instanced) assert.ok(mesh.boundingSphere && mesh.boundingSphere.radius > 0);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, height(0, -50), -50);
  trees.update(frame(world, { camera }));
  const near = instanced.filter((m) => m.visible && m.geometry.getAttribute("position").count > 60);
  const far = instanced.filter((m) => m.visible && m.geometry.getAttribute("position").count <= 60);
  assert.strictEqual(near.length, 2, "the two tiles around the camera draw the detailed conifer");
  assert.strictEqual(far.length, 1, "the distant tile draws the impostor");
  assert.ok(near.every((m) => m.castShadow), "close tiles cast shadows");
  camera.position.set(0, height(0, -50) + 2000, -50);
  trees.update(frame(world, { camera }));
  assert.ok(instanced.every((m) => !m.visible || m.geometry.getAttribute("position").count <= 60), "far from everything: impostors only");
  assert.ok(instanced.every((m) => !m.castShadow));
  trees.dispose();
  assert.strictEqual(scene.children.length, 0);
});

test("Trees creates nothing for a treeless resort", () => {
  const world = { ...stubWorld(), trees: [], treeLineM: 0 };
  const scene = new THREE.Scene();
  const trees = new Trees(scene, world);
  assert.strictEqual(trees.tileCount, 0);
  // Rocks are the only possible child, and the gentle stub slope has no steep ground.
  assert.strictEqual((scene.children[0] as THREE.Group).children.length, 0);
  trees.dispose();
});

test("Lifts builds towers, a cable and moving chairs", () => {
  const world = stubWorld();
  const scene = new THREE.Scene();
  const lifts = new Lifts(scene, world);
  const group = scene.children[0] as THREE.Group;
  assert.ok(group instanceof THREE.Group);
  const chairs = group.children.find((c) => c instanceof THREE.InstancedMesh) as THREE.InstancedMesh;
  assert.ok(chairs, "chairs are instanced");
  assert.ok(chairs.count >= 3 && chairs.count <= 400);
  assert.ok(group.children.some((c) => c instanceof THREE.LineSegments), "cable line present");
  const before = new THREE.Matrix4();
  chairs.getMatrixAt(0, before);
  lifts.update(frame(world, { time: 30 }));
  const after = new THREE.Matrix4();
  chairs.getMatrixAt(0, after);
  assert.ok(!before.equals(after), "chairs move with time");
  lifts.dispose();
  assert.strictEqual(scene.children.length, 0);
});

test("Signs builds junction posts once and course props per course, without a DOM", () => {
  assert.strictEqual(typeof document, "undefined");
  const world = stubWorld();
  const scene = new THREE.Scene();
  const signs = new Signs(scene, world);
  const group = scene.children[0] as THREE.Group;
  const [junctionGroup, courseGroup] = group.children as THREE.Group[];
  // Two choice boards + one merged post mesh.
  assert.strictEqual(junctionGroup.children.length, 3);
  assert.strictEqual(courseGroup.children.length, 0, "course props wait for the first frame");
  signs.update(frame(world));
  // Start board, finish board, merged poles, hint line.
  assert.strictEqual(courseGroup.children.length, 4);
  const hint = courseGroup.children.find((c) => c instanceof THREE.Line) as THREE.Line;
  assert.ok(hint);
  assert.strictEqual(hint.visible, false);
  signs.update(frame(world, { trailHint: true }));
  assert.strictEqual(hint.visible, true);
  const count = courseGroup.children.length;
  signs.update(frame(world));
  assert.strictEqual(courseGroup.children.length, count, "same course is not rebuilt");
  signs.dispose();
  assert.strictEqual(scene.children.length, 0);
});

test("Lake lays the outline flat just above the water level", () => {
  const world = stubWorld();
  const scene = new THREE.Scene();
  const lake = new Lake(scene, world);
  const mesh = scene.children[0] as THREE.Mesh;
  assert.ok(mesh instanceof THREE.Mesh);
  assert.strictEqual(mesh.position.y, 2800.2);
  assert.ok(Math.abs(mesh.rotation.x + Math.PI / 2) < 1e-9);
  mesh.updateMatrixWorld();
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
  assert.ok(Math.abs(box.min.z - 300) < 1e-6 && Math.abs(box.max.z - 450) < 1e-6, "shape y maps to world z");
  lake.update(frame(world));
  lake.dispose();
  assert.strictEqual(scene.children.length, 0);
});

test("Lanes merges every named run into one ribbon mesh and boosts the selected course", () => {
  const world = stubWorld();
  const scene = new THREE.Scene();
  const lanes = new Lanes(scene, world);
  const mesh = scene.children[0] as THREE.Mesh;
  assert.ok(mesh instanceof THREE.Mesh);
  const geometry = mesh.geometry;
  const alpha = geometry.getAttribute("alpha") as THREE.BufferAttribute;
  const position = geometry.getAttribute("position");
  assert.strictEqual(alpha.count, position.count);
  assert.strictEqual(position.count % 3, 0, "three vertices per sample");
  assert.ok(geometry.getIndex()!.count > 0);
  // Centre vertices carry the run opacity, edges are transparent.
  const before = alpha.getX(1);
  assert.ok(Math.abs(before - 0.16) < 1e-6, "expert run centreline is 0.16 before selection");
  assert.strictEqual(alpha.getX(0), 0);
  lanes.update(frame(world));
  assert.ok(alpha.getX(1) > before, "selected course is boosted");
  const material = mesh.material as THREE.ShaderMaterial;
  assert.strictEqual(material.transparent, true);
  assert.strictEqual(material.depthWrite, false);
  assert.strictEqual(material.fog, true);
  lanes.dispose();
  assert.strictEqual(scene.children.length, 0);
});
