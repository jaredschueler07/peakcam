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
