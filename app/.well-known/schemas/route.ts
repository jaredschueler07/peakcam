import { publicJson, publicOptions } from "@/lib/public-api/headers";
import { buildSchemaIndex } from "@/lib/public-api/json-schemas";

// GET /.well-known/schemas — index of the standalone JSON Schema documents
// under /.well-known/schemas/{file}.json (lib/public-api/json-schemas.ts).
// Static: the registry changes only on deploy.
export const dynamic = "force-static";

const CACHE_CONTROL = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400";

export function GET(): Response {
  return publicJson(buildSchemaIndex(), { cacheControl: CACHE_CONTROL });
}

export function OPTIONS(): Response {
  return publicOptions();
}
