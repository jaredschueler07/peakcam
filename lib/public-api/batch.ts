// ─────────────────────────────────────────────────────────────
// Public API — /api/v1/batch request parsing. Pure; the route owns the
// handler table (it imports the other route modules, which this file must
// not, so the tests can load it without Next).
// ─────────────────────────────────────────────────────────────

export const BATCH_MAX_REQUESTS = 10;
export const BATCH_MAX_PATH_LENGTH = 300;

export type BatchRouteId = "resorts" | "searchIndex" | "resort" | "cams" | "forecast" | "forecastAccuracy" | "powder" | "status" | "ask";

export interface BatchPath {
  path: string;
  route: BatchRouteId;
  slug: string | null;
}

/** GET paths the batch endpoint will dispatch, with their slug capture. */
const ROUTE_PATTERNS: Array<{ route: BatchRouteId; re: RegExp }> = [
  { route: "searchIndex", re: /^\/api\/v1\/resorts\/search-index$/ },
  { route: "resorts", re: /^\/api\/v1\/resorts$/ },
  { route: "cams", re: /^\/api\/v1\/resorts\/([a-z0-9][a-z0-9-]{0,99})\/cams$/ },
  { route: "forecast", re: /^\/api\/v1\/resorts\/([a-z0-9][a-z0-9-]{0,99})\/forecast$/ },
  { route: "forecastAccuracy", re: /^\/api\/v1\/resorts\/([a-z0-9][a-z0-9-]{0,99})\/forecast-accuracy$/ },
  { route: "resort", re: /^\/api\/v1\/resorts\/([a-z0-9][a-z0-9-]{0,99})$/ },
  { route: "powder", re: /^\/api\/v1\/powder$/ },
  { route: "status", re: /^\/api\/v1\/status$/ },
  { route: "ask", re: /^\/api\/v1\/ask$/ },
];

export function matchBatchPath(path: string): BatchPath | null {
  if (typeof path !== "string" || path.length > BATCH_MAX_PATH_LENGTH || !path.startsWith("/api/v1/")) return null;
  if (path.includes("..") || /\s/.test(path)) return null;
  const pathname = path.split("?")[0].split("#")[0];
  for (const { route, re } of ROUTE_PATTERNS) {
    const m = re.exec(pathname);
    if (m) return { path, route, slug: m[1] ?? null };
  }
  return null;
}

export type BatchParse = { ok: true; paths: BatchPath[] } | { ok: false; error: string; detail: string };

/**
 * Accepts `{ "requests": [{ "path": "/api/v1/..." }] }` (the documented
 * shape) or a bare array of path strings. Every path must be a GET route
 * under /api/v1 that this endpoint knows; anything else fails the whole
 * batch with the offending path named, so a client never gets a silently
 * shorter result.
 */
export function parseBatchBody(body: unknown): BatchParse {
  const raw: unknown = Array.isArray(body) ? body : (body as { requests?: unknown })?.requests;
  if (!Array.isArray(raw)) return { ok: false, error: "invalid_body", detail: 'Send {"requests":[{"path":"/api/v1/resorts/alta"}]} or an array of path strings.' };
  if (raw.length === 0) return { ok: false, error: "invalid_body", detail: "requests is empty." };
  if (raw.length > BATCH_MAX_REQUESTS) return { ok: false, error: "too_many_requests", detail: `At most ${BATCH_MAX_REQUESTS} paths per batch (got ${raw.length}).` };
  const paths: BatchPath[] = [];
  for (const item of raw) {
    const path = typeof item === "string" ? item : (item as { path?: unknown })?.path;
    if (typeof path !== "string") return { ok: false, error: "invalid_path", detail: "Each request needs a string path." };
    const matched = matchBatchPath(path);
    if (!matched) {
      return {
        ok: false,
        error: "disallowed_path",
        detail: `${path} is not a batchable GET route. Allowed: /api/v1/resorts, /api/v1/resorts/search-index, /api/v1/resorts/{slug}, /api/v1/resorts/{slug}/cams, /api/v1/resorts/{slug}/forecast, /api/v1/resorts/{slug}/forecast-accuracy, /api/v1/powder, /api/v1/status, /api/v1/ask (with query strings).`,
      };
    }
    paths.push(matched);
  }
  return { ok: true, paths };
}
