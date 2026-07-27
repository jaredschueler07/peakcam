import { test } from "node:test";
import assert from "node:assert";
import { readFile } from "node:fs/promises";

const engine = await readFile(
  new URL("../public/drop-in/engine.html", import.meta.url),
  "utf8",
);

test("the embedded engine includes touch controls for mobile map users", () => {
  assert.match(engine, /id="touch-controls"/);
  assert.match(engine, /data-key="a"/);
  assert.match(engine, /data-key="d"/);
  assert.match(engine, /data-key="w"/);
  assert.match(engine, /data-key="s"/);
  assert.match(engine, /data-key=" "/);
  assert.match(engine, /pointerdown/);
  assert.match(engine, /pointerup/);
});
