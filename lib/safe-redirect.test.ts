import { test } from "node:test";
import assert from "node:assert";
import { safeNext } from "./safe-redirect";

test("accepts same-origin relative paths", () => {
  assert.strictEqual(safeNext("/dashboard"), "/dashboard");
  assert.strictEqual(safeNext("/"), "/");
  assert.strictEqual(safeNext("/resorts/breckenridge"), "/resorts/breckenridge");
});

test("preserves query strings and fragments", () => {
  assert.strictEqual(safeNext("/auth?x=//ok"), "/auth?x=//ok");
  assert.strictEqual(safeNext("/favorites?a=1&b=2#top"), "/favorites?a=1&b=2#top");
});

test("rejects absolute URLs", () => {
  assert.strictEqual(safeNext("https://evil.tld"), "/");
  assert.strictEqual(safeNext("http://evil.tld/path"), "/");
  assert.strictEqual(safeNext("javascript:alert(1)"), "/");
});

test("rejects protocol-relative URLs and backslash variants", () => {
  assert.strictEqual(safeNext("//evil.tld"), "/");
  assert.strictEqual(safeNext("/\\evil.tld"), "/");
  assert.strictEqual(safeNext("\\\\evil.tld"), "/");
  assert.strictEqual(safeNext("\\/evil.tld"), "/");
});

test("rejects empty and non-string input", () => {
  assert.strictEqual(safeNext(null), "/");
  assert.strictEqual(safeNext(undefined), "/");
  assert.strictEqual(safeNext(""), "/");
});

test("rejects paths that do not start with a slash", () => {
  assert.strictEqual(safeNext("dashboard"), "/");
  assert.strictEqual(safeNext(" /dashboard"), "/");
});

// The WHATWG URL parser strips tab/LF/CR from anywhere in the input, so a
// control character in position 2 survives a positional check and then
// vanishes, turning "/\t/evil.tld" into "//evil.tld" at resolution time.
test("rejects control characters the URL parser would strip", () => {
  assert.strictEqual(safeNext("/\t/evil.tld"), "/");
  assert.strictEqual(safeNext("/\n/evil.tld"), "/");
  assert.strictEqual(safeNext("/\r/evil.tld"), "/");
  assert.strictEqual(safeNext("/\r\n/evil.tld"), "/");
  assert.strictEqual(safeNext("/\t\\evil.tld"), "/");
  assert.strictEqual(safeNext("/\u0000/evil.tld"), "/");
  assert.strictEqual(safeNext("/ /evil.tld"), "/");
});

// Property test: whatever safeNext returns must resolve on-origin. This holds
// the security invariant even if the implementation is rewritten.
test("output always resolves to the same origin", () => {
  const origin = "https://www.peakcam.io";
  const payloads = [
    "/\t/evil.tld",
    "/\n/evil.tld",
    "/\r\n/evil.tld",
    "/\t\\evil.tld",
    "//evil.tld",
    "/\\evil.tld",
    "/..//evil.tld",
    "https://evil.tld",
    "javascript:alert(1)",
    "",
    "/dashboard",
  ];
  for (const raw of payloads) {
    assert.strictEqual(
      new URL(safeNext(raw), origin).origin,
      origin,
      `payload escaped origin: ${JSON.stringify(raw)}`
    );
  }
});
