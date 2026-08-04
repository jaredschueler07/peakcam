import assert from "node:assert/strict";
import test from "node:test";
import { PointerLockAdapter } from "./PointerLockAdapter";
import { InputManager } from "./InputManager";

test("pointer lock retries without unadjusted movement and reports denial without throwing", async () => {
  const attempts: unknown[] = [];
  const results: string[] = [];
  const canvas = new EventTarget() as EventTarget & {
    requestPointerLock(options?: unknown): Promise<void>;
  };
  canvas.requestPointerLock = async (options?: unknown) => {
    attempts.push(options ?? "fallback");
    throw new DOMException("denied", "NotAllowedError");
  };
  const doc = new EventTarget() as Document;
  Object.defineProperty(doc, "pointerLockElement", { value: null, configurable: true });
  const adapter = new PointerLockAdapter(canvas as HTMLCanvasElement, new InputManager(), {
    document: doc,
    onResult: (result) => results.push(`${result.status}:${result.errorName ?? ""}`),
  });

  await assert.doesNotReject(adapter.request());
  assert.deepEqual(attempts, [{ unadjustedMovement: true }, "fallback"]);
  assert.deepEqual(results, ["denied:NotAllowedError"]);
  adapter.dispose();
});

