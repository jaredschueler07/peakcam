// ─────────────────────────────────────────────────────────────
// Service-role PostgREST fetch, shared by the alerts routes.
//
// The env is resolved per call, not at module load, so importing a route
// module never throws — a misconfigured deployment fails on the request with
// a named error instead of at build/import time.
//
// Edge- and Node-runtime safe: no Node built-ins.
//
// Deliberate duplication: scripts/ has its own service-role fetch helper. That
// one is free to use Node-only APIs and dotenv loading, this one must stay
// runtime-agnostic. Worth merging only if the two constraints ever converge.
// ─────────────────────────────────────────────────────────────

import { requireServiceEnv, type ServiceEnvSource } from "./service-env";

export type SbFetch = (path: string, init?: RequestInit) => Promise<Response>;

export interface CreateSbFetchOptions {
  /** When set, every request carries an AbortSignal.timeout of this many ms. */
  timeoutMs?: number;
  /** Test seam. */
  fetchImpl?: typeof fetch;
  /** Test seam. */
  env?: ServiceEnvSource;
}

/**
 * Builds a `fetch` bound to `<SUPABASE_URL>/rest/v1` with service-role headers.
 * `path` is appended verbatim, so callers must URL-encode their own filter
 * values (see the encoding notes at the call sites).
 */
export function createSbFetch(options: CreateSbFetchOptions = {}): SbFetch {
  const { timeoutMs, fetchImpl, env } = options;
  // async, so a misconfigured env surfaces as a rejected promise at the
  // `await` rather than a synchronous throw from the call expression.
  return async (path, init) => {
    const { url, serviceKey } = requireServiceEnv(env ?? process.env);
    const doFetch = fetchImpl ?? fetch;
    return doFetch(`${url}/rest/v1${path}`, {
      ...init,
      ...(timeoutMs === undefined ? {} : { signal: AbortSignal.timeout(timeoutMs) }),
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  };
}
