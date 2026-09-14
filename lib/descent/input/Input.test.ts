import { test } from "node:test";
import assert from "node:assert";
import { createInput, type HotKey } from "./Input";

function clock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

test("keyboard steer ramps up over ~120 ms and back down over ~80 ms", () => {
  const c = clock();
  const input = createInput(c.now);
  input.poll();
  input.handleKey("KeyD", true);
  c.advance(60); input.poll();
  assert.ok(input.state.steer > 0.4 && input.state.steer < 0.6, `half ramp: ${input.state.steer}`);
  c.advance(80); input.poll();
  assert.strictEqual(input.state.steer, 1);
  input.handleKey("KeyD", false);
  c.advance(40); input.poll();
  assert.ok(input.state.steer > 0.4 && input.state.steer < 0.6, `half decay: ${input.state.steer}`);
  c.advance(60); input.poll();
  assert.strictEqual(input.state.steer, 0);
  assert.strictEqual(input.scheme, "keyboard");
});

test("arrow left reads as negative steer and opposite keys reset the ramp", () => {
  const c = clock();
  const input = createInput(c.now);
  input.poll();
  input.handleKey("ArrowLeft", true);
  c.advance(100); input.poll(); c.advance(100); input.poll();
  assert.strictEqual(input.state.steer, -1);
  input.handleKey("ArrowLeft", false);
  input.handleKey("ArrowRight", true);
  c.advance(10); input.poll();
  assert.ok(input.state.steer >= 0, "opposite key restarts from zero");
});

test("edge flags are set on the key event and cleared by endStep", () => {
  const input = createInput(clock().now);
  input.handleKey("Space", true);
  assert.strictEqual(input.state.jumpHeld, true);
  assert.strictEqual(input.state.jumpReleased, false);
  input.handleKey("Space", false);
  assert.strictEqual(input.state.jumpHeld, false);
  assert.strictEqual(input.state.jumpReleased, true);
  input.handleKey("KeyR", true);
  input.handleKey("KeyE", true);
  assert.strictEqual(input.state.resetPressed, true);
  assert.strictEqual(input.state.liftPressed, true);
  input.endStep();
  assert.strictEqual(input.state.jumpReleased, false);
  assert.strictEqual(input.state.resetPressed, false);
  assert.strictEqual(input.state.liftPressed, false);
});

test("grabs: last pressed wins, releasing falls back, none held → null", () => {
  const input = createInput(clock().now);
  input.handleKey("KeyJ", true);
  assert.strictEqual(input.state.grab, "mute");
  input.handleKey("KeyL", true);
  assert.strictEqual(input.state.grab, "daffy");
  input.handleKey("KeyL", false);
  assert.strictEqual(input.state.grab, "mute");
  input.handleKey("KeyJ", false);
  assert.strictEqual(input.state.grab, null);
});

test("tuck and brake are level-triggered from either key set", () => {
  const input = createInput(clock().now);
  input.handleKey("ArrowUp", true);
  assert.strictEqual(input.state.tuck, true);
  input.handleKey("ArrowUp", false);
  input.handleKey("KeyW", true);
  assert.strictEqual(input.state.tuck, true);
  input.handleKey("KeyS", true);
  assert.strictEqual(input.state.brake, true);
  assert.strictEqual(input.active, true);
});

test("hotkeys dispatch on keydown only and unsubscribe stops delivery", () => {
  const input = createInput(clock().now);
  const seen: HotKey[] = [];
  const off = input.onHotkey((key) => seen.push(key));
  assert.strictEqual(input.handleKey("KeyC", true), true);
  input.handleKey("KeyC", false);
  input.handleKey("Escape", true);
  input.handleKey("KeyH", true);
  assert.deepStrictEqual(seen, ["camera", "pause", "help"]);
  off();
  input.handleKey("KeyN", true);
  assert.deepStrictEqual(seen, ["camera", "pause", "help"]);
});

test("keys typed into a text field are ignored and unknown keys are not consumed", () => {
  const input = createInput(clock().now);
  const textarea = { tagName: "TEXTAREA" } as unknown as EventTarget;
  assert.strictEqual(input.handleKey("KeyW", true, textarea), false);
  assert.strictEqual(input.state.tuck, false);
  assert.strictEqual(input.handleKey("KeyZ", true), false);
});

test("touch steer and buttons blend into the same state", () => {
  const input = createInput(clock().now);
  input.setTouchSteer(0.5);
  assert.strictEqual(input.state.steer, 0.5);
  assert.strictEqual(input.scheme, "touch");
  input.setTouchButton("jump", true);
  assert.strictEqual(input.state.jumpHeld, true);
  input.setTouchButton("jump", false);
  assert.strictEqual(input.state.jumpReleased, true);
  input.setTouchButton("grab", true);
  assert.strictEqual(input.state.grab, "mute");
  input.setTouchButton("lift", true);
  assert.strictEqual(input.state.liftPressed, true);
  input.setTouchSteer(2);
  assert.strictEqual(input.state.steer, 1);
});
