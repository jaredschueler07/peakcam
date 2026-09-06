import assert from "node:assert/strict";
import test from "node:test";
import { TouchAdapter } from "./TouchAdapter";
import { InputManager } from "./InputManager";

function fixture() {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { value: { innerWidth: 390 }, configurable: true });
  const parent = new EventTarget();
  const captured = new Set<number>();
  const captures: number[] = [];
  Object.assign(parent, {
    setPointerCapture(id: number) { captured.add(id); captures.push(id); },
    hasPointerCapture(id: number) { return captured.has(id); },
    releasePointerCapture(id: number) { captured.delete(id); },
  });
  const input = new InputManager();
  const adapter = new TouchAdapter(parent as HTMLElement, input);
  adapter.setActive(true);
  function event(type: string, id: number, x: number, interactive = false) {
    const event = new Event(type);
    Object.defineProperties(event, {
      pointerType: { value: "touch" }, pointerId: { value: id }, clientX: { value: x },
      // A nested button label delegates closest() to its interactive ancestor.
      target: { value: { closest(selector: string) {
        assert.ok(selector.includes("button") && selector.includes("[role=button]"));
        return interactive ? { tagName: "BUTTON" } : null;
      } } },
    });
    parent.dispatchEvent(event);
  }
  return { input, adapter, event, captured, captures, dispose() {
    adapter.dispose();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  } };
}

for (const order of ["tuck-first", "steer-first"] as const) {
  test(`delegated mobile touches preserve both actions: ${order}`, () => {
    const f = fixture();
    try {
      const tuck = () => { f.adapter.setAction("tuck", true); f.event("pointerdown", 2, 199, true); };
      if (order === "tuck-first") tuck();
      f.event("pointerdown", 1, 100);
      if (order === "steer-first") tuck();
      f.event("pointermove", 1, 132);
      const frame = f.input.nextFrame();
      assert.equal(frame.tuck, 1);
      assert.ok(Math.abs(frame.steer + (0.5 - 0.12) / 0.88) < 1e-12);
      assert.deepEqual(f.captures, [1], "parent never takes the button's pointer capture");
      f.event("pointermove", 2, 180, true);
      f.event("pointerup", 2, 180, true);
      assert.equal(f.input.nextFrame().steer, frame.steer);
      f.adapter.setAction("tuck", false);
      f.event("pointermove", 1, 36);
      assert.equal(f.input.nextFrame().steer, 1);
      f.event("pointerup", 1, 36);
      assert.equal(f.input.nextFrame().steer, 0);
      assert.equal(f.captured.size, 0);
    } finally { f.dispose(); }
  });
}

test("additional steering pointers cannot steal capture; cancel, clear and dispose release it", () => {
  const f = fixture();
  try {
    f.event("pointerdown", 1, 100);
    f.event("pointerdown", 3, 80);
    f.event("pointermove", 3, 144);
    assert.equal(f.input.nextFrame().steer, 0);
    f.event("pointermove", 1, 164);
    assert.equal(f.input.nextFrame().steer, -1);
    f.event("pointercancel", 1, 164);
    assert.equal(f.input.nextFrame().steer, 0);
    assert.equal(f.captured.size, 0);
    f.event("pointerdown", 3, 80);
    f.adapter.clear();
    assert.equal(f.captured.size, 0);
    f.event("pointerdown", 4, 80);
    f.event("lostpointercapture", 4, 80);
    assert.equal(f.captured.size, 0);
    f.event("pointerdown", 5, 80);
    f.adapter.dispose();
    assert.equal(f.captured.size, 0);
    f.event("pointerdown", 6, 80);
    assert.deepEqual(f.captures, [1, 3, 4, 5]);
  } finally { f.dispose(); }
});

test("steering starts on the right side and release preserves a held action", () => {
  const f = fixture();
  try {
    f.event("pointerdown", 1, 300);
    f.adapter.setAction("brake", true);
    f.event("pointermove", 1, 364);
    assert.equal(f.input.nextFrame().steer, -1, "screen-right input keeps the simulation convention");
    f.event("pointerup", 1, 364);
    const frame = f.input.nextFrame();
    assert.equal(frame.steer, 0);
    assert.equal(frame.brake, 1);
  } finally { f.dispose(); }
});

test("button steering ignores canvas drags and disabling touch releases all held controls", () => {
  const f = fixture();
  try {
    f.adapter.setDragEnabled(false);
    f.event("pointerdown", 1, 300);
    f.event("pointermove", 1, 364);
    assert.equal(f.input.nextFrame().steer, 0);
    assert.equal(f.captured.size, 0);
    f.adapter.setSteer(-1);
    f.adapter.setAction("tuck", true);
    assert.equal(f.input.nextFrame().steer, 1);
    f.adapter.setActive(false);
    f.adapter.setSteer(1);
    f.adapter.setAction("tuck", true);
    const frame = f.input.nextFrame();
    assert.equal(frame.steer, 0);
    assert.equal(frame.tuck, 0);
    f.adapter.setActive(true);
    f.adapter.setDragEnabled(true);
    f.event("pointerdown", 2, 300);
    f.event("pointermove", 2, 236);
    assert.equal(f.input.nextFrame().steer, 1);
  } finally { f.dispose(); }
});
