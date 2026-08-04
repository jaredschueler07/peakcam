import assert from "node:assert/strict";
import test from "node:test";
import { InputManager } from "./InputManager";

test("analog steering applies a 0.12 dead zone and rescales the remainder", () => {
  const input = new InputManager();
  input.setAnalog("gamepad", 0.12);
  assert.equal(input.nextFrame().steer, 0);
  input.setAnalog("gamepad", 0.56);
  assert.ok(Math.abs(input.nextFrame().steer - 0.5) < 1e-12);
});

test("the most recently active analog source wins", () => {
  const input = new InputManager();
  input.setAnalog("pointer", -0.7);
  input.setAnalog("gamepad", 0.7);
  assert.ok(input.nextFrame().steer > 0);
  input.setAnalog("pointer", -0.8);
  assert.ok(input.nextFrame().steer < 0);
});

test("keyboard steering overrides analog only while held", () => {
  const input = new InputManager();
  input.setAnalog("gamepad", 0.8);
  input.setDigitalSteer("keyboard", -1);
  assert.equal(input.nextFrame().steer, -1);
  input.setDigitalSteer("keyboard", 0);
  assert.ok(input.nextFrame().steer > 0);
});

test("actions emit once on a rising edge and clearHeld releases everything", () => {
  const input = new InputManager();
  input.setAction("jump", true);
  assert.deepEqual(input.nextFrame(), {
    steer: 0, tuck: 0, brake: 0, jumpHeld: true, jumpPressed: true,
    restartPressed: false, trailPressed: false,
  });
  assert.equal(input.nextFrame().jumpPressed, false);
  input.clearHeld();
  assert.equal(input.nextFrame().jumpHeld, false);
  input.setAction("jump", true);
  assert.equal(input.nextFrame().jumpPressed, true);
});

