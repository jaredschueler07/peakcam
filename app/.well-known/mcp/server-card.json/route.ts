import { createHash } from "node:crypto";
import { publicJson, publicOptions } from "@/lib/public-api/headers";
import { buildServerCard, SERVER_CARD_MEDIA_TYPE } from "@/components/connect/server-card";

// GET /.well-known/mcp/server-card.json — the `io.peakcam/snow` MCP Server
// Card (SEP-2127 v1 shape, see components/connect/server-card.ts). The SEP's
// reserved location is `<streamable-http-url>/server-card`, i.e.
// /api/mcp/server-card, which app/api/mcp/server-card/route.ts serves by
// re-exporting these handlers; this .well-known copy is the address the
// execution plan, llms.txt and server.json advertise. Both are byte-identical.
//
// Static (changes only on deploy), cached a day, CORS open, ETag per the
// extension's discovery doc (clients send If-None-Match on re-fetch).
export const dynamic = "force-static";

const CACHE_CONTROL = "public, max-age=86400, s-maxage=86400, stale-while-revalidate=86400";

export function GET(): Response {
  const card = buildServerCard();
  const body = JSON.stringify(card);
  const response = publicJson(card, {
    contentType: `${SERVER_CARD_MEDIA_TYPE}; charset=utf-8`,
    cacheControl: CACHE_CONTROL,
  });
  response.headers.set("ETag", `"${createHash("sha256").update(body).digest("hex").slice(0, 32)}"`);
  response.headers.set("Access-Control-Allow-Headers", "Accept, Content-Type, If-None-Match");
  response.headers.set("Access-Control-Expose-Headers", "ETag, Link, X-Attribution");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export function OPTIONS(): Response {
  const response = publicOptions();
  response.headers.set("Access-Control-Allow-Headers", "Accept, Content-Type, If-None-Match");
  response.headers.set("Access-Control-Expose-Headers", "ETag, Link, X-Attribution");
  return response;
}
