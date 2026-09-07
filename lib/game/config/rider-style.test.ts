import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_RIDER_STYLE, normalizeRiderStyle, readRiderStyle, saveRiderStyle, RIDER_STYLE_STORAGE_KEY } from "./rider-style";

test("saved rider style rejects corrupt or unknown values independently", () => {
  for (const value of [null, false, 17, "yeti", [], { outfit: "toString", board: "__proto__" }]) assert.deepEqual(normalizeRiderStyle(value), DEFAULT_RIDER_STYLE);
  assert.deepEqual(normalizeRiderStyle({ character: "human", outfit: "future-outfit", board: "nightfall", skis: "ridgeline" }), { ...DEFAULT_RIDER_STYLE, character: "human", board: "nightfall", skis: "ridgeline" });
  assert.deepEqual(readRiderStyle({ getItem() { return "broken json"; } }), DEFAULT_RIDER_STYLE);
  assert.deepEqual(readRiderStyle({ getItem() { throw new Error("denied"); } }), DEFAULT_RIDER_STYLE);
});

test("outfit and separate board/ski graphics survive a new visit", () => {
  let saved = "";
  const expected = { character: "yeti", outfit: "timberline", board: "nightfall", skis: "ridgeline" } as const;
  saveRiderStyle({ setItem(key, value) { assert.equal(key, RIDER_STYLE_STORAGE_KEY); saved = value; } }, expected);
  assert.deepEqual(readRiderStyle({ getItem() { return saved; } }), expected);
  assert.doesNotThrow(() => saveRiderStyle({ setItem() { throw new Error("quota"); } }, expected));
});
