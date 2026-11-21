import { test } from "node:test";
import assert from "node:assert/strict";
import { createMcpHandler } from "mcp-handler";
import { withoutLegacyEnvelopeClaim } from "./legacy-envelope";

// Regression for modelcontextprotocol/typescript-sdk#3159 as seen in
// production on /api/mcp: a client that negotiated 2025-06-18 on
// `initialize` then sends each request with a `_meta` envelope naming
// 2025-06-18, and the SDK answers -32022 with supported ["2026-07-28"].

const handler = createMcpHandler((server) => {
  server.registerTool("ping", { description: "ping" }, async () => ({ content: [{ type: "text", text: "pong" }] }));
}, { serverInfo: { name: "peakcam-test", version: "0.0.0" } });

function envelope(version: string) {
  return {
    "io.modelcontextprotocol/protocolVersion": version,
    "io.modelcontextprotocol/clientInfo": { name: "peakcam-test-client", version: "0.0.0" },
    "io.modelcontextprotocol/clientCapabilities": {},
  };
}

function post(body: unknown, version: string, extraHeaders: Record<string, string> = {}): Request {
  return new Request("http://peakcam.test/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": version,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

const legacyToolsList = { jsonrpc: "2.0", id: 9, method: "tools/list", params: { _meta: envelope("2025-06-18") } };

test("the SDK alone rejects a 2025-06-18 envelope claim on tools/list (the bug this works around)", async () => {
  const response = await handler(post(legacyToolsList, "2025-06-18"));
  assert.equal(response.status, 400);
  assert.match(await response.text(), /-32022/);
});

test("tools/list with a 2025-06-18 envelope claim is served once the claim is stripped", async () => {
  const response = await handler(await withoutLegacyEnvelopeClaim(post(legacyToolsList, "2025-06-18")));
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /"name":"ping"/);
  assert.doesNotMatch(text, /-32022/);
});

test("notifications/initialized with a 2025-06-18 envelope claim is accepted once the claim is stripped", async () => {
  const notification = { jsonrpc: "2.0", method: "notifications/initialized", params: { _meta: envelope("2025-06-18") } };
  const response = await handler(await withoutLegacyEnvelopeClaim(post(notification, "2025-06-18")));
  assert.equal(response.status, 202);
});

test("only the version key is removed; the rest of the body is kept", async () => {
  const stripped = await withoutLegacyEnvelopeClaim(post(legacyToolsList, "2025-06-18"));
  const body = (await stripped.json()) as { id: number; method: string; params: { _meta: Record<string, unknown> } };
  assert.equal(body.id, 9);
  assert.equal(body.method, "tools/list");
  assert.deepEqual(Object.keys(body.params._meta).sort(), ["io.modelcontextprotocol/clientCapabilities", "io.modelcontextprotocol/clientInfo"]);
  assert.equal(stripped.headers.get("mcp-protocol-version"), "2025-06-18");
});

test("modern, unknown and absent claims, initialize and non-JSON bodies pass through untouched", async () => {
  const cases: Request[] = [
    post({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: envelope("2026-07-28") } }, "2026-07-28", { "mcp-method": "tools/list" }),
    post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: { _meta: envelope("1999-01-01") } }, "1999-01-01"),
    post({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} }, "2025-06-18"),
    post({ jsonrpc: "2.0", id: 4, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "c", version: "1" }, _meta: envelope("2025-06-18") } }, "2025-06-18"),
    new Request("http://peakcam.test/api/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "not json" }),
    new Request("http://peakcam.test/api/mcp", { method: "GET" }),
  ];
  for (const request of cases) assert.equal(await withoutLegacyEnvelopeClaim(request), request);
});

test("a modern 2026-07-28 request is still served after passing through", async () => {
  const modern = { jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: envelope("2026-07-28") } };
  const response = await handler(await withoutLegacyEnvelopeClaim(post(modern, "2026-07-28", { "mcp-method": "tools/list" })));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /"name":"ping"/);
});

test("legacy claims inside a batch are stripped too", async () => {
  const batch = [legacyToolsList, { jsonrpc: "2.0", method: "notifications/initialized", params: { _meta: envelope("2025-11-25") } }];
  const stripped = await withoutLegacyEnvelopeClaim(post(batch, "2025-06-18"));
  const body = (await stripped.json()) as Array<{ params: { _meta: Record<string, unknown> } }>;
  for (const message of body) assert.equal("io.modelcontextprotocol/protocolVersion" in message.params._meta, false);
});
