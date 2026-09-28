import { test } from "node:test";
import assert from "node:assert/strict";
import { inList, isTimeoutError, SERVICE_TIMEOUT } from "./service-fetch";

test("inList quotes and URL-encodes each value so none can escape the filter", () => {
  assert.equal(inList(["a", "b"]), "%22a%22,%22b%22");
  // A `)` or `&` inside a value stays encoded inside its own quoted operand.
  assert.equal(inList([`x")&select=*`]), encodeURIComponent(`"x)&select=*"`));
  assert.equal(inList([]), "");
});

test("isTimeoutError recognises only the TimeoutError AbortSignal.timeout raises", () => {
  assert.equal(isTimeoutError(new DOMException("The operation was aborted due to timeout", "TimeoutError")), true);
  assert.equal(isTimeoutError(new DOMException("aborted", "AbortError")), false);
  assert.equal(isTimeoutError(new Error("TimeoutError")), false);
  assert.equal(isTimeoutError(null), false);
  assert.equal(isTimeoutError("TimeoutError"), false);
});

test("the shared timeout response is a 504 with a JSON error", () => {
  assert.equal(SERVICE_TIMEOUT.status, 504);
  assert.equal(typeof SERVICE_TIMEOUT.body.error, "string");
});
