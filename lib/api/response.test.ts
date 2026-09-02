import { test } from "node:test";
import assert from "node:assert";
import { jsonError, parseJsonBody, parseJsonBodyOrNull } from "./response";

test("jsonError keeps the { error } shape clients read", async () => {
  const resp = jsonError("token is required", 400);
  assert.strictEqual(resp.status, 400);
  assert.deepStrictEqual(await resp.json(), { error: "token is required" });
});

test("parseJsonBody returns the decoded value", async () => {
  const parsed = await parseJsonBody<{ a: number }>({ json: async () => ({ a: 1 }) });
  assert.deepStrictEqual(parsed, { ok: true, value: { a: 1 } });
});

test("parseJsonBody distinguishes malformed JSON from a literal null body", async () => {
  const bad = await parseJsonBody({
    json: async () => {
      throw new SyntaxError("Unexpected token");
    },
  });
  assert.deepStrictEqual(bad, { ok: false });

  // `{"body": null}` is valid JSON and must not be reported as invalid.
  assert.deepStrictEqual(await parseJsonBody({ json: async () => null }), {
    ok: true,
    value: null,
  });
});

test("parseJsonBodyOrNull collapses malformed JSON to null", async () => {
  assert.strictEqual(
    await parseJsonBodyOrNull({
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    }),
    null
  );
  assert.deepStrictEqual(await parseJsonBodyOrNull({ json: async () => ({ token: "t" }) }), {
    token: "t",
  });
});
