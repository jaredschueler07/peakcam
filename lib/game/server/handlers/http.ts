/**
 * lib/game/server/handlers/http.ts
 * ────────────────────────────────
 * Shared request/response plumbing for the Drop In Route Handlers.
 *
 * The handlers in this directory are plain `(Request, deps) => Promise<Response>`
 * functions. The files under `app/api/drop-in/` are thin adapters that build
 * the production dependencies and delegate here, which is what lets the unit
 * tests invoke a handler directly with hand-rolled stubs instead of mocking
 * Next.js module resolution.
 *
 * Error bodies are `{ error }` — the shape the rest of `app/api/` already
 * uses — plus, on the submission route, a coarse `rejectionCode`. Detailed
 * validator reasons never cross this boundary: they tell an attacker exactly
 * which bound to stay under.
 */

export type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413; error: string };

export interface JsonErrorOptions {
  /** Extra top-level fields, e.g. `rejectionCode` or zod `issues`. */
  extra?: Record<string, unknown>;
  headers?: HeadersInit;
}

/** `{ error }` with a status, matching the house convention. */
export function jsonError(
  status: number,
  error: string,
  options: JsonErrorOptions = {},
): Response {
  return Response.json({ error, ...options.extra }, { status, headers: options.headers });
}

export function jsonOk(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

/**
 * Read a JSON body, refusing anything over `maxBytes`.
 *
 * `Content-Length` is checked first so an oversized upload is rejected without
 * being parsed, but it is a client-supplied header — the decoded byte length is
 * re-checked after reading, which is the check that actually binds. Next
 * buffers the body before a handler runs, so this bounds parsing work rather
 * than transfer.
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<JsonBodyResult> {
  const declared = Number(request.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, status: 413, error: `Body exceeds the ${maxBytes} byte limit` };
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, status: 400, error: "Could not read the request body" };
  }

  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    return { ok: false, status: 413, error: `Body exceeds the ${maxBytes} byte limit` };
  }

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON" };
  }
}

/** `Retry-After` plus the usual informational headers for a 429. */
export function rateLimitHeaders(retryAfterSeconds: number, resetAtMs: number): HeadersInit {
  return {
    "Retry-After": String(retryAfterSeconds),
    "X-RateLimit-Reset": String(Math.ceil(resetAtMs / 1000)),
  };
}
