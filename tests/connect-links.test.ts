import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { CONNECT_LINKS, CLAUDE_CONNECTOR_LINK, CURSOR_MCP_JSON, MCP_ENDPOINT } from "@/components/connect/links";

// Every internal href /connect renders must resolve to a route under app/
// (page.tsx or route.ts, with [param] segments matching any value) or a file
// under public/. No server, no env, no network: pure filesystem.

const ROOT = resolve(__dirname, "..");
const APP = join(ROOT, "app");
const PUBLIC = join(ROOT, "public");

function pathOf(href: string): string {
  return href.split("#")[0].split("?")[0];
}

/** Does a directory entry at `dir` match `segment`, literally or as a [param]? */
function matchChildren(dir: string, segment: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => statSync(join(dir, entry)).isDirectory())
    .filter((entry) => entry === segment || /^\[[^\]]+\]$/.test(entry))
    .map((entry) => join(dir, entry));
}

function routeExists(path: string): boolean {
  const segments = path.split("/").filter(Boolean);
  let dirs = [APP];
  for (const segment of segments) dirs = dirs.flatMap((dir) => matchChildren(dir, segment));
  return dirs.some((dir) => existsSync(join(dir, "page.tsx")) || existsSync(join(dir, "route.ts")));
}

function publicFileExists(path: string): boolean {
  const candidate = join(PUBLIC, path);
  return candidate.startsWith(PUBLIC) && existsSync(candidate) && statSync(candidate).isFile();
}

const entries = Object.entries(CONNECT_LINKS);

test("every non-pending /connect link resolves to an app route or a public file", () => {
  const missing = entries
    .filter(([, link]) => !("pending" in link && link.pending))
    .filter(([, link]) => {
      const path = pathOf(link.href);
      return !(routeExists(path) || publicFileExists(path));
    })
    .map(([id, link]) => `${id}: ${link.href}`);
  assert.deepEqual(missing, []);
});

test("links are site-relative, with no origin, trailing slash or double slash", () => {
  for (const [id, link] of entries) {
    assert.match(link.href, /^\/(?!\/)/, `${id} must start with a single slash`);
    assert.ok(link.href === "/" || !pathOf(link.href).endsWith("/"), `${id} must not end with a slash`);
    assert.ok(link.label.length > 0, `${id} needs a label`);
  }
});

test("a pending link stops being pending once its route lands on this branch", () => {
  // The MCP route ships on feat/mcp-server. While it is absent the link is
  // allowed to be pending; once app/api/mcp/route.ts exists, drop the flag so
  // the first test guards it like every other link.
  for (const [id, link] of entries) {
    if (!("pending" in link && link.pending)) continue;
    assert.ok(!routeExists(pathOf(link.href)), `${id} (${link.href}) exists now: remove pending`);
  }
});

test("the client recipes all point at the one MCP endpoint", () => {
  assert.equal(MCP_ENDPOINT, "https://www.peakcam.io/api/mcp");
  assert.equal(JSON.parse(CURSOR_MCP_JSON).mcpServers.peakcam.url, MCP_ENDPOINT);
  const url = new URL(CLAUDE_CONNECTOR_LINK);
  assert.equal(url.origin + url.pathname, "https://claude.ai/customize/connectors");
  assert.equal(url.searchParams.get("modal"), "add-custom-connector");
  assert.equal(url.searchParams.get("connectorName"), "PeakCam");
  assert.equal(url.searchParams.get("connectorUrl"), MCP_ENDPOINT);
});
