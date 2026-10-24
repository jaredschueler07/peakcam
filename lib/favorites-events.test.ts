import { test } from "node:test";
import assert from "node:assert/strict";
import { FAVORITES_CHANGED_EVENT, notifyFavoritesChanged, subscribeFavoritesChanged } from "./favorites-events";

/** A browser-ish window: EventTarget plus the two methods the module touches. */
function withWindow(fn: () => void) {
  const previous = Object.prototype.hasOwnProperty.call(globalThis, "window") ? (globalThis as { window?: unknown }).window : undefined;
  const had = Object.prototype.hasOwnProperty.call(globalThis, "window");
  const target = new EventTarget();
  (globalThis as { window?: unknown }).window = target;
  try {
    fn();
  } finally {
    if (had) (globalThis as { window?: unknown }).window = previous;
    else Reflect.deleteProperty(globalThis, "window");
  }
}

test("notifyFavoritesChanged reaches a mounted consumer in the same tab", () => {
  withWindow(() => {
    let calls = 0;
    const unsubscribe = subscribeFavoritesChanged(() => {
      calls += 1;
    });
    notifyFavoritesChanged();
    assert.equal(calls, 1);
    unsubscribe();
    notifyFavoritesChanged();
    assert.equal(calls, 1, "unsubscribed consumers are not called");
    // The event name is part of the seam; keep it stable for other consumers.
    assert.equal(FAVORITES_CHANGED_EVENT, "peakcam:favorites-changed");
  });
});

test("notifyFavoritesChanged is a no-op on the server", () => {
  assert.doesNotThrow(() => notifyFavoritesChanged());
  assert.doesNotThrow(() => subscribeFavoritesChanged(() => {})());
});
