import { publicJson, publicOptions } from "@/lib/public-api/headers";
import { buildOpenApiDocument } from "@/lib/public-api/openapi";

// GET /api/v1/openapi.json — generated from the zod registry at request time
// (cheap: no data read) and cached like a static asset. Also linked from
// /.well-known/api-catalog as rel="service-desc".
export const dynamic = "force-static";

export function GET(): Response {
  return publicJson(buildOpenApiDocument(), {
    contentType: "application/vnd.oai.openapi+json;version=3.1; charset=utf-8",
    cacheControl: "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
  });
}

export function OPTIONS(): Response {
  return publicOptions();
}
