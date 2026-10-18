import { SITE_URL } from "@/lib/site";
import { publicJson, publicOptions } from "@/lib/public-api/headers";

// GET /.well-known/api-catalog — RFC 9727 API catalog: a linkset
// (RFC 9264) naming the APIs this origin publishes and where their
// descriptions live. Agents and crawlers that know the convention find the
// OpenAPI document from here without reading HTML. Sprint 6 adds the MCP
// server entry alongside.
export const dynamic = "force-static";

export function GET(): Response {
  const api = `${SITE_URL}/api/v1`;
  const body = {
    linkset: [
      {
        anchor: `${api}/`,
        "service-desc": [
          { href: `${api}/openapi.json`, type: "application/vnd.oai.openapi+json;version=3.1" },
        ],
        "service-doc": [
          { href: `${SITE_URL}/methodology`, type: "text/html" },
          { href: `${SITE_URL}/llms.txt`, type: "text/plain" },
        ],
        "service-meta": [
          { href: `${SITE_URL}/about#terms`, type: "text/html", title: "Terms of reuse" },
        ],
        status: [{ href: `${api}/resorts`, type: "application/json", title: "Resort list (200 when healthy)" }],
      },
    ],
  };
  return publicJson(body, {
    contentType: 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"; charset=utf-8',
    cacheControl: "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
    extraLinks: [`<${api}/openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json;version=3.1"`],
  });
}

export function OPTIONS(): Response {
  return publicOptions();
}
