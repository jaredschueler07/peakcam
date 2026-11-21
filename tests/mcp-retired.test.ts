import { test } from "node:test";
import assert from "node:assert/strict";
import { DELETE, GET, OPTIONS, POST } from "@/app/api/mcp/route";

// /api/mcp was the public MCP server until 2026-11-21. The route stays as a
// 410 so a client that still holds the URL gets a reason and somewhere to go.

test("/api/mcp answers GET, POST and DELETE with 410, a JSON pointer, open CORS and an hour of caching", async () => {
  for (const [method, handler] of [["GET", GET], ["POST", POST], ["DELETE", DELETE]] as const) {
    const res = handler();
    assert.equal(res.status, 410, method);
    assert.match(res.headers.get("content-type") ?? "", /^application\/json/, method);
    assert.equal(res.headers.get("access-control-allow-origin"), "*", method);
    assert.equal(res.headers.get("cache-control"), "public, max-age=3600", method);
    const body = (await res.json()) as Record<string, string>;
    assert.equal(body.error, "gone", method);
    assert.match(body.message, /MCP server was retired on 2026-11-21/, method);
    assert.equal(body.openapi, "https://www.peakcam.io/api/v1/openapi.json", method);
    assert.equal(body.docs, "https://www.peakcam.io/llms.txt", method);
  }
});

test("/api/mcp OPTIONS stays a 204 preflight with open CORS", async () => {
  const res = OPTIONS();
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.match(res.headers.get("access-control-allow-methods") ?? "", /GET, POST, DELETE, OPTIONS/);
  assert.equal(await res.text(), "");
});
