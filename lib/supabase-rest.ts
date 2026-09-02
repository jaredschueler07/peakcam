// ─────────────────────────────────────────────────────────────
// lib/supabase-rest.ts
// Minimal typed wrapper over Supabase's PostgREST endpoint.
//
// Replaces the hand-rolled `supaHeaders` + `fetch(`${URL}/rest/v1/...`)`
// blocks that were pasted into scripts/snotel-sync.ts, scripts/model-sync.ts,
// scripts/seed-snotel-normals.ts, scripts/seed-openskistats.ts and
// lib/pipeline/orchestrator.ts.
//
// Deliberately dependency-free (global `fetch` only, no `node:*` imports) so
// it can also be adopted by the four `sbFetch` copies in app/api/alerts/*
// (subscribe, manage, unsubscribe, trigger). Those routes are owned by
// another workstream and are NOT changed here — the shape below is what they
// would need: pass their own `{ url, key }` and use `sbFetch` directly for
// the paths that need bespoke `Prefer` headers.
// ─────────────────────────────────────────────────────────────

/** Service-role (or anon) credentials for one PostgREST endpoint. */
export interface SupabaseRestConfig {
  url: string;
  key: string;
}

/** Standard auth + JSON headers for a PostgREST request. */
export function supaHeaders(key: string): Record<string, string> {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

/**
 * Low-level escape hatch: `path` is everything after `/rest/v1`, e.g.
 * `/resorts?is_active=eq.true&select=id`. Caller-supplied headers are merged
 * over the defaults, so `Prefer` / `Range` can be added per call.
 */
export function sbFetch(
  cfg: SupabaseRestConfig,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${cfg.url}/rest/v1${path}`, {
    ...init,
    headers: {
      ...supaHeaders(cfg.key),
      ...((init.headers as Record<string, string>) ?? {}),
    },
  });
}

async function ensureOk(resp: Response, label: string): Promise<void> {
  if (resp.ok) return;
  const text = await resp.text().catch(() => "");
  throw new Error(`${label} (${resp.status}): ${text}`);
}

export interface SelectOptions {
  /** Error message prefix on a non-2xx response. */
  errorLabel?: string;
  /** Extra headers (e.g. `Prefer: count=exact`). */
  headers?: Record<string, string>;
}

/**
 * `GET /rest/v1/<path>` returning a typed row array. Throws on a non-2xx
 * response.
 *
 * @param path everything after `/rest/v1`, including the leading slash and
 *             any PostgREST query string.
 */
export async function sbSelect<T>(
  cfg: SupabaseRestConfig,
  path: string,
  opts: SelectOptions = {},
): Promise<T[]> {
  const resp = await sbFetch(cfg, path, { headers: opts.headers });
  await ensureOk(resp, opts.errorLabel ?? `Supabase select ${path} failed`);
  return (await resp.json()) as T[];
}

/**
 * Same as `sbSelect`, but returns `[]` instead of throwing when the request
 * fails. Several per-resort lookups in the sync scripts are best-effort:
 * a missing normals row or an unreachable history query must not abort the
 * whole resort.
 */
export async function sbSelectOrEmpty<T>(
  cfg: SupabaseRestConfig,
  path: string,
  opts: SelectOptions = {},
): Promise<T[]> {
  try {
    const resp = await sbFetch(cfg, path, { headers: opts.headers });
    if (!resp.ok) return [];
    return (await resp.json()) as T[];
  } catch {
    return [];
  }
}

export interface WriteOptions {
  errorLabel?: string;
  headers?: Record<string, string>;
}

/** `POST /rest/v1/<table>` — plain insert. Accepts a row or an array of rows. */
export async function sbInsert(
  cfg: SupabaseRestConfig,
  table: string,
  body: unknown,
  opts: WriteOptions = {},
): Promise<void> {
  const resp = await sbFetch(cfg, `/${table}`, {
    method: "POST",
    headers: opts.headers,
    body: JSON.stringify(body),
  });
  await ensureOk(resp, opts.errorLabel ?? `${table} insert failed`);
}

/**
 * `POST /rest/v1/<table>` with `Prefer: resolution=merge-duplicates` — the
 * PostgREST spelling of upsert.
 */
export async function sbUpsert(
  cfg: SupabaseRestConfig,
  table: string,
  body: unknown,
  opts: WriteOptions & { onConflict?: string } = {},
): Promise<void> {
  const query = opts.onConflict ? `?on_conflict=${opts.onConflict}` : "";
  const resp = await sbFetch(cfg, `/${table}${query}`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates", ...opts.headers },
    body: JSON.stringify(body),
  });
  await ensureOk(resp, opts.errorLabel ?? `${table} upsert failed`);
}

/** `PATCH /rest/v1/<table>?<query>`. `query` omits the leading `?`. */
export async function sbPatch(
  cfg: SupabaseRestConfig,
  table: string,
  query: string,
  body: unknown,
  opts: WriteOptions = {},
): Promise<void> {
  const resp = await sbFetch(cfg, `/${table}?${query}`, {
    method: "PATCH",
    headers: opts.headers,
    body: JSON.stringify(body),
  });
  await ensureOk(resp, opts.errorLabel ?? `${table} update failed`);
}

/** `DELETE /rest/v1/<table>?<query>`. `query` omits the leading `?`. */
export async function sbDelete(
  cfg: SupabaseRestConfig,
  table: string,
  query: string,
  opts: WriteOptions = {},
): Promise<void> {
  const resp = await sbFetch(cfg, `/${table}?${query}`, {
    method: "DELETE",
    headers: opts.headers,
  });
  await ensureOk(resp, opts.errorLabel ?? `${table} delete failed`);
}
