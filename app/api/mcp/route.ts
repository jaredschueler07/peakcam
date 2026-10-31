import { createMcpHandler } from "mcp-handler";
import { SITE_URL } from "@/lib/site";
import { publicJson } from "@/lib/public-api/headers";
import { productionDataSource } from "@/lib/mcp/data";
import {
  PEAKCAM_MCP_ENDPOINT,
  PEAKCAM_MCP_NAME,
  PEAKCAM_MCP_TITLE,
  PEAKCAM_MCP_VERSION,
  PEAKCAM_RESOURCE_TEMPLATE,
  peakCamServerInfo,
  peakCamServerOptions,
  registerPeakCam,
} from "@/lib/mcp/server";
import { PEAKCAM_TOOL_NAMES } from "@/lib/mcp/tools";

// /api/mcp — the `io.peakcam/snow` MCP server, stateless Streamable HTTP.
//
// mcp-handler 2.x serves the 2026-07-28 revision natively and 2025-era
// Streamable HTTP through the SDK's stateless fallback from this one route;
// there is no session store (no Redis) and no separate /sse mount. A plain
// browser GET (no `text/event-stream` in Accept) gets a small JSON pointer
// instead of the protocol's 405 so the URL is self-describing when pasted.
// proxy.ts already excludes `api/mcp` from the Supabase session refresh.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Seconds. Within the Hobby ceiling; tool calls finish in well under one. */
export const maxDuration = 60;

const handler = createMcpHandler((server) => registerPeakCam(server, productionDataSource), {
  ...peakCamServerOptions,
  serverInfo: peakCamServerInfo,
  onEvent: (event) => {
    if (event.type === "ERROR") console.error("[mcp]", event.context ?? "", event.error);
    // One line per request so a 60 s runtime timeout can be matched to the
    // JSON-RPC method that preceded it (the request log carries no body).
    // Tool arguments are not logged: a `tools/call` logs only the tool name.
    else if (event.type === "REQUEST_RECEIVED") console.log(`[mcp] received ${describeRequest(event.method, event.parameters)}`);
    else if (event.type === "REQUEST_COMPLETED") console.log(`[mcp] completed ${event.method} status=${event.status} duration=${event.duration ?? "?"}ms`);
  },
});

/** `method` plus, for a tool call, the tool name; never the arguments. */
function describeRequest(method: string, parameters: unknown): string {
  const body = parameters !== null && typeof parameters === "object" ? (parameters as Record<string, unknown>) : {};
  const params = body.params !== null && typeof body.params === "object" ? (body.params as Record<string, unknown>) : {};
  const id = "id" in body ? JSON.stringify(body.id) : "none";
  const tool = method === "tools/call" && typeof params.name === "string" ? ` tool=${params.name}` : "";
  return `${method}${tool} id=${id}`;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Accept, Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version, WWW-Authenticate",
};

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function GET(request: Request): Promise<Response> {
  const accept = request.headers.get("accept") ?? "";
  if (!accept.includes("text/event-stream")) {
    return publicJson(
      {
        name: PEAKCAM_MCP_NAME,
        title: PEAKCAM_MCP_TITLE,
        version: PEAKCAM_MCP_VERSION,
        endpoint: PEAKCAM_MCP_ENDPOINT,
        transport: "streamable-http",
        auth: "none",
        tools: PEAKCAM_TOOL_NAMES,
        resources: [PEAKCAM_RESOURCE_TEMPLATE],
        docs: `${SITE_URL}/connect`,
        openapi: `${SITE_URL}/api/v1/openapi.json`,
      },
      { cacheControl: "public, max-age=3600, s-maxage=86400" },
    );
  }
  return withCors(await handler(request));
}

export async function POST(request: Request): Promise<Response> {
  return withCors(await handler(request));
}

export async function DELETE(request: Request): Promise<Response> {
  return withCors(await handler(request));
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: { ...CORS_HEADERS, "Access-Control-Max-Age": "86400" } });
}
