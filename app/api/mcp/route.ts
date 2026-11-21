import { SITE_URL } from "@/lib/site";

// /api/mcp — retired. The public MCP server that lived here was withdrawn on
// 2026-11-21 by the owner's decision; the same data stays available through
// the REST API and the answer endpoint. Every method a Streamable HTTP client
// sends (GET, POST, DELETE) gets a 410 with a small JSON pointer so a
// connector that still holds the URL fails with a reason instead of a 404.
// proxy.ts keeps `api/mcp` out of the Supabase session refresh.

export const runtime = "nodejs";

const MCP_RETIRED_ON = "2026-11-21";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
} as const;

function gone(): Response {
  return Response.json(
    {
      error: "gone",
      message: `The PeakCam MCP server was retired on ${MCP_RETIRED_ON}. The same read-only data is served by the REST API and the answer endpoint.`,
      openapi: `${SITE_URL}/api/v1/openapi.json`,
      docs: `${SITE_URL}/llms.txt`,
    },
    {
      status: 410,
      headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=3600" },
    },
  );
}

export function GET(): Response {
  return gone();
}

export function POST(): Response {
  return gone();
}

export function DELETE(): Response {
  return gone();
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: { ...CORS_HEADERS, "Access-Control-Max-Age": "86400" } });
}
