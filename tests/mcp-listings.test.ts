import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildServerCard, MCP_DESCRIPTION, SERVER_CARD_SCHEMA } from "@/components/connect/server-card";
import { CONNECT_TOOLS, MCP_ENDPOINT, MCP_NAME, MCP_PROTOCOL_VERSIONS } from "@/components/connect/links";
import { buildTools, PEAKCAM_TOOL_NAMES } from "@/lib/mcp/tools";
import { PEAKCAM_MCP_ENDPOINT, PEAKCAM_MCP_NAME, PEAKCAM_MCP_VERSION } from "@/lib/mcp/server";
import type { McpDataSource } from "@/lib/mcp/types";

// The two listing documents: the SEP-2127 server card (served at
// /.well-known/mcp/server-card.json) and the MCP Registry manifest
// (server.json at the repo root, read by `mcp-publisher publish`). Both must
// parse, name the same server and carry the Streamable HTTP endpoint.

const ROOT = resolve(__dirname, "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };

// Schema constraints, from the v1 server-card schema and the registry's
// 2025-12-11 server.schema.json: reverse-DNS name with exactly one slash,
// description 1–100 chars, remote URL absolute https.
const NAME_PATTERN = /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/;

test("server card: v1 shape with the required fields and the endpoint", () => {
  const card = JSON.parse(JSON.stringify(buildServerCard()));
  assert.equal(card.$schema, SERVER_CARD_SCHEMA);
  assert.equal(card.$schema, "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json");
  assert.equal(card.name, MCP_NAME);
  assert.match(card.name, NAME_PATTERN);
  assert.equal(card.version, pkg.version);
  assert.ok(card.description.length >= 1 && card.description.length <= 100, `description is ${card.description.length} chars`);
  assert.ok(card.title.length <= 100);
  assert.equal(card.remotes.length, 1);
  assert.deepEqual(card.remotes[0].type, "streamable-http");
  assert.equal(card.remotes[0].url, MCP_ENDPOINT);
  assert.match(card.remotes[0].url, /^https:\/\//);
  assert.ok(card.remotes[0].supportedProtocolVersions.includes("2026-07-28"));
  assert.equal(card.websiteUrl, "https://www.peakcam.io/connect");
  assert.equal(card.repository.source, "github");
});

test("server card: the top level carries no tool list (runtime listing owns it); the summary sits under a namespaced _meta key", () => {
  const card = buildServerCard() as unknown as Record<string, unknown>;
  for (const key of ["tools", "prompts", "resources", "capabilities", "authentication", "transport"]) {
    assert.equal(key in card, false, `${key} must not be a top-level card field`);
  }
  const meta = card._meta as Record<string, Record<string, unknown>>;
  const keys = Object.keys(meta);
  assert.deepEqual(keys, ["io.peakcam/connect"]);
  // _meta prefixes ending in `modelcontextprotocol` or `mcp` labels are reserved.
  for (const key of keys) assert.doesNotMatch(key, /(^|\.)(modelcontextprotocol|mcp)\.[^/]*\//);
  const summary = meta["io.peakcam/connect"];
  assert.equal(summary.documentation, "https://www.peakcam.io/connect");
  assert.deepEqual(summary.authentication, { required: false, schemes: [] });
  assert.deepEqual(
    (summary.tools as { name: string }[]).map((t) => t.name),
    CONNECT_TOOLS.map((t) => t.name),
  );
  assert.equal(summary.license, "https://www.peakcam.io/about#terms");
});

test("server.json: parses, uses the dated registry schema, names io.peakcam/snow and the endpoint", () => {
  const raw = readFileSync(join(ROOT, "server.json"), "utf8");
  const manifest = JSON.parse(raw);
  assert.match(manifest.$schema, /^https:\/\/static\.modelcontextprotocol\.io\/schemas\/\d{4}-\d{2}-\d{2}\/server\.schema\.json$/);
  assert.equal(manifest.name, MCP_NAME);
  assert.match(manifest.name, NAME_PATTERN);
  assert.equal(manifest.version, pkg.version, "bump server.json when package.json's version moves");
  assert.equal(manifest.description, MCP_DESCRIPTION);
  assert.ok(manifest.description.length <= 100, `registry caps description at 100 chars (${manifest.description.length})`);
  assert.equal(manifest.packages, undefined, "remote-only: no packages array");
  assert.deepEqual(manifest.remotes, [{ type: "streamable-http", url: MCP_ENDPOINT }]);
  assert.equal(manifest.repository.url, "https://github.com/jaredschueler07/peakcam");
  assert.equal(manifest.repository.source, "github");
  // Only this _meta key survives publishing; anything else is dropped.
  assert.deepEqual(Object.keys(manifest._meta), ["io.modelcontextprotocol.registry/publisher-provided"]);
  assert.ok(JSON.stringify(manifest._meta["io.modelcontextprotocol.registry/publisher-provided"]).length <= 4096);
});

test("the page's identity constants are the server's own", () => {
  assert.equal(MCP_NAME, PEAKCAM_MCP_NAME);
  assert.equal(MCP_ENDPOINT, PEAKCAM_MCP_ENDPOINT);
  assert.equal(buildServerCard().version, PEAKCAM_MCP_VERSION);
  assert.deepEqual([...MCP_PROTOCOL_VERSIONS], ["2026-07-28", "2025-11-25", "2025-06-18"]);
});

test("the tool table lists exactly the server's tools, in order, with the server's titles", () => {
  assert.deepEqual(
    CONNECT_TOOLS.map((t) => t.name),
    [...PEAKCAM_TOOL_NAMES],
  );
  // buildTools only touches the data source inside handlers, so a stub that
  // throws is enough to read the registered names and titles.
  const never = async (): Promise<never> => {
    throw new Error("not called");
  };
  const stub: McpDataSource = { catalog: never, forecast: never, forecastRuns: never, forecastAccuracy: never, snowHistory: never, camStills: never };
  const registered = buildTools(stub).map((t) => ({ name: t.name, title: t.title }));
  assert.deepEqual(
    CONNECT_TOOLS.map((t) => ({ name: t.name, title: t.title })),
    registered,
  );
  for (const tool of CONNECT_TOOLS) {
    assert.ok(tool.summary.length > 20 && tool.summary.length <= 140, `${tool.name} summary should be one line`);
  }
});
