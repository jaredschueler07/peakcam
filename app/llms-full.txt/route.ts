import { buildLlmsFull } from "@/lib/public-api/llms-full";
import { publicOptions, withPublicHeaders } from "@/lib/public-api/headers";

// GET /llms-full.txt — the long-form agent guide (tool-by-tool, REST with
// curl, attribution, rate limit). Built from the tool definitions and the
// examples table, no data read, so it is static per deploy and cached a day.
// /llms.txt stays the short, data-bearing map.
export const dynamic = "force-static";

export function GET(): Response {
  const response = new Response(buildLlmsFull(), { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
  return withPublicHeaders(response, { cacheControl: "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400" });
}

export function OPTIONS(): Response {
  return publicOptions();
}
