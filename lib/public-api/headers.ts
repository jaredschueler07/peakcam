// ─────────────────────────────────────────────────────────────
// Public API — response headers shared by every /api/v1 route, the
// .well-known/api-catalog document and (Sprint 5) the MCP endpoint.
//
// Pure: no Next.js imports, so lib/public-api/*.test.ts can assert on the
// header set without a server. Routes call `withPublicHeaders(response)` or
// build a `new Response(body, { headers: publicApiHeaders(...) })`.
// ─────────────────────────────────────────────────────────────

import { SITE_URL } from "@/lib/site";

/** ISR window for every public API route — the same number goes in `revalidate`. */
export const PUBLIC_API_REVALIDATE_SECONDS = 900;

/** Printed in `X-Attribution` and in every JSON body's `attribution` field. */
export const PUBLIC_API_ATTRIBUTION =
  "PeakCam (https://www.peakcam.io) - SNOTEL data: USDA NRCS; forecasts: NWS/Open-Meteo; cams: their operators";

/**
 * There is no standalone /terms route: the Terms of Service live in a section
 * of /about (app/about/page.tsx, `<section id="terms">`), so the licence link
 * points there. Move it when a dedicated legal page exists.
 */
export const PUBLIC_API_LICENSE_URL = `${SITE_URL}/about#terms`;
export const PUBLIC_API_AUTHOR_URL = SITE_URL;

export const PUBLIC_API_LINK_HEADER =
  `<${PUBLIC_API_AUTHOR_URL}>; rel="author", <${PUBLIC_API_LICENSE_URL}>; rel="license"`;

export const PUBLIC_API_CACHE_CONTROL =
  `public, s-maxage=${PUBLIC_API_REVALIDATE_SECONDS}, stale-while-revalidate=3600`;

export const PUBLIC_API_ALLOWED_METHODS = "GET, OPTIONS";

export interface PublicApiHeaderOptions {
  /** Defaults to JSON. The api-catalog route passes `application/linkset+json`. */
  contentType?: string;
  /** Extra `Link` relations appended after author/license. */
  extraLinks?: string[];
  /** Override the cache policy (error responses use `no-store`). */
  cacheControl?: string;
}

/** The full header set as a plain object, for `new Response(body, { headers })`. */
export function publicApiHeaders(options: PublicApiHeaderOptions = {}): Record<string, string> {
  const link = [PUBLIC_API_LINK_HEADER, ...(options.extraLinks ?? [])].join(", ");
  return {
    "Content-Type": options.contentType ?? "application/json; charset=utf-8",
    "Cache-Control": options.cacheControl ?? PUBLIC_API_CACHE_CONTROL,
    Vary: "Accept",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": PUBLIC_API_ALLOWED_METHODS,
    "Access-Control-Allow-Headers": "Accept, Content-Type",
    "Access-Control-Expose-Headers": "Link, X-Attribution",
    "Access-Control-Max-Age": "86400",
    "X-Attribution": PUBLIC_API_ATTRIBUTION,
    Link: link,
  };
}

/** Stamp the shared header set onto an existing Response (e.g. `Response.json(...)`). */
export function withPublicHeaders(response: Response, options: PublicApiHeaderOptions = {}): Response {
  const headers = publicApiHeaders({
    // Keep whatever content type the response already carries unless overridden.
    contentType: options.contentType ?? response.headers.get("Content-Type") ?? undefined,
    ...options,
  });
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
}

/** A JSON body with the shared header set. */
export function publicJson(body: unknown, init: { status?: number } & PublicApiHeaderOptions = {}): Response {
  const { status = 200, ...options } = init;
  return new Response(JSON.stringify(body), { status, headers: publicApiHeaders(options) });
}

/**
 * Error envelope. Errors are not cached (`no-store`) so an outage or a typo'd
 * slug never pins a 404/503 at the CDN for the ISR window; the header set is
 * otherwise identical, so a CORS client can still read `X-Attribution`.
 */
export function publicError(status: number, error: string, detail?: string): Response {
  return publicJson({ error, ...(detail ? { detail } : {}), status }, { status, cacheControl: "no-store" });
}

/** CORS preflight: no body, the same header set, 204. */
export function publicOptions(): Response {
  return new Response(null, { status: 204, headers: publicApiHeaders({ cacheControl: "public, max-age=86400" }) });
}
