/**
 * Read every row of a query that PostgREST would otherwise cut off.
 *
 * Supabase's REST layer returns at most 1,000 rows per request whatever
 * `limit` asks for (the project's max-rows setting), and it does so silently:
 * no error, just a short answer. Two reads were relying on a larger limit on
 * 2026-11-21 (the latest-scores index and the forecast retention read), and
 * the cam health check was reading 1,000 of 1,044 cams.
 *
 * `fetchPage(from, to)` returns the rows at offsets from..to inclusive, in a
 * stable order (the caller's query must end its ORDER BY on a unique column,
 * or rows can repeat or go missing between pages). Pure apart from the
 * callback; no Supabase import, so scripts and tests can use it.
 */

export const REST_PAGE_SIZE = 1000;

export async function readAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<readonly T[] | null | undefined>,
  { pageSize = REST_PAGE_SIZE, maxPages = 200 }: { pageSize?: number; maxPages?: number } = {},
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error(`readAllPages: bad pageSize ${pageSize}`);
  const out: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const rows = (await fetchPage(from, from + pageSize - 1)) ?? [];
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
  // A read this large is a bug in the caller, not something to truncate quietly.
  throw new Error(`readAllPages: more than ${maxPages} pages of ${pageSize} rows`);
}

/** `&limit=…&offset=…` for a raw PostgREST URL, for the scripts that call fetch directly. */
export function pageParams(from: number, to: number): string {
  return `limit=${to - from + 1}&offset=${from}`;
}
