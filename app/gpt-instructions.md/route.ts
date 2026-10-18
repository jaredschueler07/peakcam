import { buildGptInstructions } from "@/lib/public-api/gpt-instructions";
import { publicOptions, withPublicHeaders } from "@/lib/public-api/headers";

// GET /gpt-instructions.md — instructions for a ChatGPT Custom GPT that
// calls the REST API as an Action. Static per deploy.
export const dynamic = "force-static";

export function GET(): Response {
  const response = new Response(buildGptInstructions(), { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
  return withPublicHeaders(response, { cacheControl: "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400" });
}

export function OPTIONS(): Response {
  return publicOptions();
}
