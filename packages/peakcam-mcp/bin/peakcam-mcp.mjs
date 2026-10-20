#!/usr/bin/env node
// peakcam-mcp — a stdio bridge to PeakCam's hosted MCP server.
//
// Clients that only speak stdio (Claude Desktop's config file, older
// editors, local agent frameworks) run `npx -y peakcam-mcp`; every JSON-RPC
// message they write to stdin is forwarded as-is to
// https://www.peakcam.io/api/mcp over Streamable HTTP, and every response
// or notification comes back on stdout. Nothing is interpreted here except
// the `initialize` result, whose negotiated protocol version is handed to
// the HTTP transport so later requests carry the right header. No key, no
// state, no cache: the hosted server is stateless and read-only.
//
//   PEAKCAM_MCP_URL  override the endpoint (a preview deployment, a mirror)
//   --url <url>      the same, on the command line

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const DEFAULT_URL = "https://www.peakcam.io/api/mcp";

function endpoint(argv) {
  const i = argv.indexOf("--url");
  const fromArg = i >= 0 ? argv[i + 1] : undefined;
  const raw = fromArg ?? process.env.PEAKCAM_MCP_URL ?? DEFAULT_URL;
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error(`peakcam-mcp: refusing non-HTTPS endpoint ${raw}`);
  }
  return url;
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stderr.write(`usage: peakcam-mcp [--url ${DEFAULT_URL}]\nBridges stdio MCP to PeakCam's hosted server. Docs: https://www.peakcam.io/connect\n`);
    return;
  }
  const url = endpoint(process.argv.slice(2));
  const stdio = new StdioServerTransport();
  const http = new StreamableHTTPClientTransport(url);

  // Requests and notifications from the client go up; everything from the
  // server comes down. A transport error on either side ends the process so
  // the client sees a clean exit instead of a hung pipe.
  stdio.onmessage = (message) => {
    http.send(message).catch((err) => fail("send", err));
  };
  http.onmessage = (message) => {
    if (message && "result" in message && message.result && typeof message.result.protocolVersion === "string") {
      http.setProtocolVersion(message.result.protocolVersion);
    }
    stdio.send(message).catch((err) => fail("stdout", err));
  };
  stdio.onerror = (err) => fail("stdin", err);
  http.onerror = (err) => fail("http", err);
  stdio.onclose = () => shutdown(0);
  http.onclose = () => shutdown(0);

  await http.start();
  await stdio.start();

  function fail(where, err) {
    process.stderr.write(`peakcam-mcp: ${where}: ${err instanceof Error ? err.message : String(err)}\n`);
    shutdown(1);
  }
  function shutdown(code) {
    Promise.allSettled([http.close(), stdio.close()]).finally(() => process.exit(code));
  }
}

main().catch((err) => {
  process.stderr.write(`peakcam-mcp: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
