import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import { createSimulation } from "../core/simulation";
import { createProceduralWorld } from "../terrain/obstacles";
import { CameraController } from "./CameraController";

test("the first camera frame starts behind arbitrary run headings without startup lerp", () => {
  const profile = DROP_IN_GAME_PROFILES.breckenridge;
  const world = createProceduralWorld(profile, profile.seed);
  for (const yaw of [0, Math.PI / 2, Math.PI, -2.4]) {
    const state = createSimulation(profile, profile.seed);
    state.yaw = yaw;
    // Isolate framing from the terrain floor clamp.
    state.pos.y += 100;
    const camera = new THREE.PerspectiveCamera();
    const controller = new CameraController(camera, state, true);
    const initial = camera.position.clone();
    const behind = new THREE.Vector3(state.pos.x - initial.x, 0, state.pos.z - initial.z).normalize();
    assert.ok(behind.dot(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))) > 0.999999);
    controller.update(state, world.terrain, 1 / 120, 0);
    assert.ok(camera.position.distanceTo(initial) < 1e-9, "a stationary pose needs no initial settling frames");
  }
});

test("landing impulse distinguishes hard contact and honors reduced motion", () => {
  const profile = DROP_IN_GAME_PROFILES.breckenridge, world = createProceduralWorld(profile, profile.seed);
  const state = createSimulation(profile, profile.seed);
  const hard = new CameraController(new THREE.PerspectiveCamera(), state, false);
  const soft = new CameraController(new THREE.PerspectiveCamera(), state, false);
  const reduced = new CameraController(new THREE.PerspectiveCamera(), state, true);
  hard.noteLanding("hard"); soft.noteLanding("soft"); reduced.noteLanding("hard");
  for (let i = 0; i < 10; i++) for (const controller of [hard, soft, reduced]) controller.update(state, world.terrain, 1 / 120, 0);
  assert.ok(hard.motionAmplitude > soft.motionAmplitude);
  assert.equal(reduced.motionAmplitude, 0);
});
