/**
 * Shared read-only pagination, batching, and bounded-response helpers for
 * Node/tsx operational scripts. Zero third-party dependencies so both plain
 * `.mjs` and `tsx` `.ts` scripts can import it.
 */

export const POSTGREST_PAGE_SIZE = 1000;

/**
 * Split `items` into fixed-size slices for PostgREST `in.(...)` / Storage deletes.
 * @template T
 * @param {readonly T[]} items
 * @param {number} [size]
 * @returns {T[][]}
 */
export function chunkArray(items, size = 100) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Fetch every page from a PostgREST endpoint that supports `limit` & `offset`.
 * Callers MUST pass a deterministic `order=...` in `pathAndQuery` (or have a
 * deterministic order column) and omit `limit`/`offset` from `pathAndQuery`.
 * @template T
 * @param {string} supabaseUrl
 * @param {string} pathAndQuery
 * @param {Record<string, string>} headers
 * @param {{ pageSize?: number; maxPages?: number; timeoutMs?: number; fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<T[]>}
 */
export async function fetchPagedRest(
  supabaseUrl,
  pathAndQuery,
  headers,
  { pageSize = POSTGREST_PAGE_SIZE, maxPages = 100, timeoutMs = 30_000, fetchImpl = fetch } = {},
) {
  const out = [];
  const sep = pathAndQuery.includes("?") ? "&" : "?";
  for (let page = 0; page < maxPages; page++) {
    const offset = page * pageSize;
    const url = `${supabaseUrl}/rest/v1/${pathAndQuery}${sep}limit=${pageSize}&offset=${offset}`;
    const res = await fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Supabase GET ${pathAndQuery.split("?")[0]} failed (${res.status}): ${body.slice(0, 200)}`);
    }
    const rows = await res.json();
    if (!Array.isArray(rows)) {
      throw new Error(`Supabase GET ${pathAndQuery.split("?")[0]} expected array response`);
    }
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

/**
 * Read a `Response` body as UTF-8 text up to `maxBytes`.
 * Throws when `throwOnOverflow` is true, or returns the bounded prefix when false.
 * @param {Response} res
 * @param {{ maxBytes?: number; throwOnOverflow?: boolean }} [options]
 * @returns {Promise<string>}
 */
export async function readTextCapped(
  res,
  { maxBytes = 2 * 1024 * 1024, throwOnOverflow = false } = {},
) {
  if (!res.body) {
    const text = await res.text();
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes <= maxBytes) return text;
    if (throwOnOverflow) throw new Error(`Response exceeded ${maxBytes} byte limit`);
    return Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8");
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      if (total + value.byteLength > maxBytes) {
        if (throwOnOverflow) {
          throw new Error(`Response exceeded ${maxBytes} byte limit`);
        }
        const remaining = maxBytes - total;
        if (remaining > 0) chunks.push(value.subarray(0, remaining));
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))).toString("utf8");
}
