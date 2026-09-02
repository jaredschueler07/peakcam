// ─────────────────────────────────────────────────────────────
// JSON request/response helpers shared by the API routes.
// The response shape is fixed at `{ error: message }` — clients across the app
// read `.error`, so every route's error body must keep that key.
//
// Edge- and Node-runtime safe: no Node built-ins.
// ─────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";

/** A JSON body reader — `Request`, `NextRequest`, or a test double. */
export interface JsonReadable {
  json(): Promise<unknown>;
}

export type ParsedJsonBody<T> = { ok: true; value: T } | { ok: false };

/**
 * `message` accepts undefined because some callers forward an optional error
 * string. JSON.stringify drops the key, giving `{}` — which is what the
 * hand-written `NextResponse.json({ error: maybeUndefined })` calls produced.
 */
export function jsonError(message: string | undefined, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Parses the body, distinguishing "malformed JSON" from "the body was
 * literally `null`". Use where the route answers 400 "Invalid JSON".
 */
export async function parseJsonBody<T = unknown>(
  request: JsonReadable
): Promise<ParsedJsonBody<T>> {
  try {
    return { ok: true, value: (await request.json()) as T };
  } catch {
    return { ok: false };
  }
}

/**
 * Parses the body, collapsing malformed JSON to `null`. Use where the route
 * validates required fields anyway and reports a field-specific 400.
 */
export async function parseJsonBodyOrNull<T = unknown>(
  request: JsonReadable
): Promise<T | null> {
  const parsed = await parseJsonBody<T>(request);
  return parsed.ok ? parsed.value : null;
}
