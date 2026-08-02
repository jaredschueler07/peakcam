import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  CAMERA_PRESETS, DEFAULT_CAMERA_PRESET, resolveCameraPresetName,
  type CameraPreset, type CameraPresetName,
} from "./camera-presets";
import { cameraPresetName } from "./debugFlags";
import { CameraController } from "./CameraController";
import { createSimulation } from "../core/simulation";
import { createProceduralWorld } from "../terrain/obstacles";
import { DROP_IN_GAME_PROFILES } from "../config/profiles";

const profile = DROP_IN_GAME_PROFILES["ski-portillo"];
const classic = CAMERA_PRESETS.classic;

test("the classic preset is exactly the geometry the chase camera shipped with", () => {
  assert.deepEqual({ ...classic }, {
    backBase: 8.6, backSpeedGain: 5.2,
    heightBase: 3.5, heightSpeedGain: 1.4, airLift: 1,
    lookAheadM: 8, lookHeightM: 1.6,
    fovBase: 65, fovSpeedGain: 17,
    floorClearance: 1.8,
  } satisfies CameraPreset);
});

test("each alternative preset differs from classic on the axis it claims", () => {
  const { wide, high, cinematic } = CAMERA_PRESETS;

  // wide — further back and a bit higher, look-ahead pushed out to keep the framing, modest FOV bump.
  assert.ok(wide.backBase / classic.backBase >= 1.6 && wide.backBase / classic.backBase <= 1.8);
  assert.ok(wide.backSpeedGain > classic.backSpeedGain, "and stays pulled back at speed");
  assert.ok(wide.heightBase / classic.heightBase >= 1.3);
  assert.ok(wide.lookAheadM > classic.lookAheadM);
  assert.ok(wide.fovBase > classic.fovBase && wide.fovBase < 75);

  // high — the pitch changes: camera well up, look-at point down, FOV near classic.
  assert.ok(high.heightBase > wide.heightBase * 1.5, "notably higher than merely wide");
  assert.ok(high.backBase > classic.backBase && high.backBase < wide.backBase, "only slightly further back");
  assert.ok(high.lookHeightM < 0, "looks below the skier, so the camera pitches down the slope");
  assert.ok(Math.abs(high.fovBase - classic.fovBase) <= 2, "FOV stays near classic");
  assert.ok(high.floorClearance > classic.floorClearance);

  // cinematic — the furthest and the widest of the four.
  const others: CameraPreset[] = [classic, wide, high];
  assert.ok(others.every((p) => cinematic.backBase > p.backBase * 1.35), "furthest back by a clear margin");
  assert.ok(others.every((p) => cinematic.fovBase > p.fovBase), "and the widest lens");
  assert.ok(cinematic.lookAheadM > wide.lookAheadM);
});

test("preset resolution defaults to classic for absent and unknown names", () => {
  assert.equal(DEFAULT_CAMERA_PRESET, "classic");
  assert.equal(resolveCameraPresetName(undefined), "classic");
  assert.equal(resolveCameraPresetName(null), "classic");
  assert.equal(resolveCameraPresetName(""), "classic");
  assert.equal(resolveCameraPresetName("banana"), "classic");
  // Not reachable through the prototype chain, which `in` alone would allow.
  assert.equal(resolveCameraPresetName("toString"), "classic");
  assert.equal(resolveCameraPresetName("constructor"), "classic");
  for (const name of Object.keys(CAMERA_PRESETS) as CameraPresetName[]) {
    assert.equal(resolveCameraPresetName(name), name);
  }
});

test("?cam= selects a preset from the query string", () => {
  assert.equal(cameraPresetName(""), "classic");
  assert.equal(cameraPresetName("?cam=wide"), "wide");
  assert.equal(cameraPresetName("?cam=high"), "high");
  assert.equal(cameraPresetName("?cam=cinematic"), "cinematic");
  assert.equal(cameraPresetName("?cam=CINEMATIC"), "classic", "exact names only");
  assert.equal(cameraPresetName("?cam="), "classic");
  assert.equal(cameraPresetName("?cam=banana"), "classic");
  assert.equal(cameraPresetName("?nopost"), "classic");
});

/** Settle a controller under the given preset at a fixed speed, and report where it ended up. */
function settle(preset: CameraPreset, speed: number) {
  const world = createProceduralWorld(profile, profile.seed);
  const state = createSimulation(profile, profile.seed);
  state.vel.x = speed;
  const camera = new THREE.PerspectiveCamera(65, 1, 0.5, 1000);
  const controller = new CameraController(camera, state, true, preset);
  for (let i = 0; i < 400; i += 1) controller.update(state, world.terrain, 1 / 120, 0);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  return {
    camera,
    /** Metres the camera sits above the skier. */
    height: camera.position.y - state.pos.y,
    /** Horizontal distance from the skier. */
    distance: Math.hypot(camera.position.x - state.pos.x, camera.position.z - state.pos.z),
    /** Radians below horizontal the camera is pointing. Bigger means steeper. */
    pitchDown: Math.asin(THREE.MathUtils.clamp(-forward.y, -1, 1)),
  };
}

test("the presets are visibly different in the frame they produce", () => {
  const speed = 40;
  const c = settle(CAMERA_PRESETS.classic, speed);
  const wide = settle(CAMERA_PRESETS.wide, speed);
  const high = settle(CAMERA_PRESETS.high, speed);
  const cinematic = settle(CAMERA_PRESETS.cinematic, speed);

  assert.ok(wide.distance > c.distance + 4, "wide sits clearly further back");
  assert.ok(wide.height > c.height + 1, "and higher");
  assert.ok(high.height > wide.height + 2, "high is higher still");
  assert.ok(high.pitchDown > c.pitchDown + 0.15, "and looks down noticeably harder");
  // Height per metre of chase distance is what separates "above the skier" from "behind and up":
  // on a slope this steep the terrain clamp lifts every framing, but only `high` rises faster
  // than it falls back.
  const overhead = (s: { height: number; distance: number }) => s.height / s.distance;
  for (const other of [c, wide, cinematic]) assert.ok(overhead(high) > overhead(other) * 1.4);
  assert.ok(cinematic.distance > wide.distance + 4, "cinematic is the furthest");
  assert.ok(cinematic.camera.fov > wide.camera.fov + 6, "and the widest");
});

test("classic still produces the shipped framing when no preset is passed", () => {
  const speed = 40;
  const world = createProceduralWorld(profile, profile.seed);
  const state = createSimulation(profile, profile.seed);
  state.vel.x = speed;
  const implicit = new THREE.PerspectiveCamera(65, 1, 0.5, 1000);
  const explicit = new THREE.PerspectiveCamera(65, 1, 0.5, 1000);
  const a = new CameraController(implicit, state, true);
  const b = new CameraController(explicit, state, true, CAMERA_PRESETS.classic);
  for (let i = 0; i < 200; i += 1) {
    a.update(state, world.terrain, 1 / 120, 0);
    b.update(state, world.terrain, 1 / 120, 0);
  }
  assert.deepEqual(implicit.position.toArray(), explicit.position.toArray());
  assert.equal(implicit.fov, explicit.fov);
  // The shipped back distance at 40 m/s: 8.6 + (40/55) * 5.2.
  const expected = 8.6 + (40 / 55) * 5.2;
  const settled = settle(CAMERA_PRESETS.classic, speed);
  assert.ok(Math.abs(settled.distance - expected) < 0.5, `${settled.distance} ≈ ${expected}`);
});

test("the terrain floor clamp uses the preset's clearance", () => {
  const world = createProceduralWorld(profile, profile.seed);
  const state = createSimulation(profile, profile.seed);
  for (const [name, preset] of Object.entries(CAMERA_PRESETS) as [CameraPresetName, CameraPreset][]) {
    const camera = new THREE.PerspectiveCamera(65, 1, 0.5, 1000);
    const controller = new CameraController(camera, state, true, preset);
    for (let i = 0; i < 240; i += 1) controller.update(state, world.terrain, 1 / 120, 0);
    const floor = world.terrain.height(camera.position.x, camera.position.z);
    assert.ok(camera.position.y >= floor + preset.floorClearance - 1e-6, `${name} stays above its floor`);
  }
});
