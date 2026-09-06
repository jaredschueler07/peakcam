import assert from "node:assert/strict";
import test from "node:test";
import { PerspectiveCamera, Vector3 } from "three";
import { InputManager } from "./InputManager";
import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import { simulationConfig } from "../core/config";
import { createSimulation } from "../core/simulation";
import { createProceduralWorld } from "../terrain/obstacles";
import { integrateSkierV2 } from "../physics/integrator-v2";
import { CameraController } from "../rendering/CameraController";
import { FIXED_DT } from "../core/clock";

// Assert the visible turn against the actual chase camera, not a yaw-sign convention.
for (const source of ["keyboard", "touch", "pointer", "gamepad"] as const) {
  for (const direction of [-1, 1]) {
    test(`${source}: ${direction < 0 ? "left" : "right"} input turns toward that side of the chase view at every heading`, () => {
      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7]) {
        const profile = DROP_IN_GAME_PROFILES.breckenridge;
        const world = createProceduralWorld(profile, profile.seed, simulationConfig("packed", "v2"));
        const state = createSimulation(profile, profile.seed, world.terrain);
        state.yaw = yaw; state.onGround = false; state.pos.y += 100; state.crash = 0;
        const camera = new PerspectiveCamera(60, 1, 0.1, 1000);
        new CameraController(camera, state, true);
        const screenRight = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        const before = new Vector3(Math.sin(state.yaw), 0, Math.cos(state.yaw));
        const input = new InputManager();
        if (source === "keyboard") input.setDigitalSteer(source, direction);
        else input.setAnalog(source, direction);
        integrateSkierV2(state, input.nextFrame(), FIXED_DT, world);
        const turn = new Vector3(Math.sin(state.yaw), 0, Math.cos(state.yaw)).sub(before).dot(screenRight);
        assert.ok(turn * direction > 0, `yaw=${yaw}: visible turn ${turn} must match input ${direction}`);
      }
    });
  }
}
