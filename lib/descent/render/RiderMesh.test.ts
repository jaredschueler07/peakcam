import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { RiderMesh } from "./RiderMesh";
import { createRiderState } from "../sim/rider";
import { DEFAULT_RIDER_STYLE } from "@/lib/game/config/rider-style";
import type { RiderState, World } from "../types";
import type { RenderFrame } from "./frame";

const stubWorld = {
  terrain: {
    height: (_x: number, _z: number) => 100,
    normal: (_x: number, _z: number, out: { x: number; y: number; z: number }) => { out.x = 0; out.y = 1; out.z = 0; return out; },
  },
  profile: { weather: [{}] },
} as unknown as World;

function frame(state: RiderState, dt = 1 / 60): RenderFrame {
  return {
    state, world: stubWorld, time: 0, dt, camera: new THREE.PerspectiveCamera(), cameraPreset: "chase",
    weather: {} as RenderFrame["weather"], weatherIndex: 0, phase: "riding", courseIndex: 0, trailHint: false, quality: 0,
  };
}

test("rider rig poses through ground, air, crash and lift without throwing", () => {
  const scene = new THREE.Scene();
  const rider = new RiderMesh(scene, stubWorld, DEFAULT_RIDER_STYLE);
  const s = createRiderState();
  s.x = 12; s.y = 100; s.z = -40; s.yaw = 0.7; s.edge = 0.6; s.crouch = 0.8; s.vx = 8; s.vz = 8;
  for (let i = 0; i < 30; i++) rider.update(frame(s));
  assert.equal(rider.root.position.x, 12);
  assert.equal(rider.root.position.y, 100);
  assert.equal(rider.root.position.z, -40);

  s.held = true; s.vx = 0; s.vz = 0;
  for (let i = 0; i < 30; i++) rider.update(frame(s));
  s.held = false; s.braking = true; s.vx = 1; s.vz = 1;
  for (let i = 0; i < 30; i++) rider.update(frame(s));
  s.vx = 9; s.vz = 9; s.travelYaw = s.yaw + 1.0;
  for (let i = 0; i < 30; i++) rider.update(frame(s));
  s.braking = false;

  s.onGround = false; s.grab = "eagle"; s.spin = 1.2; s.flip = 0.4; s.y = 104;
  for (let i = 0; i < 30; i++) rider.update(frame(s));
  assert.equal(rider.root.position.y, 104);

  s.onGround = true; s.grab = null; s.crash = 1.2; s.y = 100;
  for (let i = 0; i < 30; i++) rider.update(frame(s));
  s.crash = 0;
  for (let i = 0; i < 30; i++) rider.update(frame(s));

  s.liftIndex = 2; s.liftSeat.heading = 1.1; s.x = 50; s.z = 60; s.y = 130;
  for (let i = 0; i < 30; i++) rider.update(frame(s));
  assert.equal(rider.root.position.x, 50);
  assert.equal(rider.root.position.z, 60);
  assert.ok(Number.isFinite(rider.root.quaternion.w));
  rider.dispose();
  assert.equal(scene.children.length, 0);
});

test("ghost rig is driven by setGhostPose and ignores update", () => {
  const scene = new THREE.Scene();
  const ghost = new RiderMesh(scene, stubWorld, DEFAULT_RIDER_STYLE, { ghost: true });
  assert.equal(ghost.root.visible, false);
  ghost.update(frame(createRiderState()));
  ghost.setGhostPose({ x: 1, y: 2, z: 3, yaw: 0.5, airborne: true, tucked: false, crashed: false, visible: true });
  assert.equal(ghost.root.visible, true);
  assert.equal(ghost.root.position.y, 2);
  ghost.setGhostPose({ x: 0, y: 0, z: 0, yaw: 0, airborne: false, tucked: true, crashed: false, visible: false });
  assert.equal(ghost.root.visible, false);
  ghost.dispose();
});
