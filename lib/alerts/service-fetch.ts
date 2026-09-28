// ─────────────────────────────────────────────────────────────
// Service-role PostgREST fetch shared by the alert routes and the
// /alerts/manage page. The alerts tables are deny-all under RLS, so every
// read and write goes through the service key; the anon client in
// lib/supabase.ts never sees them.
// ─────────────────────────────────────────────────────────────

export const SERVICE_FETCH_TIMEOUT_MS = 8_000;

export function serviceFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return fetch(`${url}/rest/v1${path}`, {
    ...init,
    // Without this a hung DB pins the request until the function timeout,
    // and the subscriber stares at "Activating…" — the anon-client timeout
    // wrapper in lib/supabase.ts doesn't cover these raw service-role fetches.
    signal: init?.signal ?? AbortSignal.timeout(SERVICE_FETCH_TIMEOUT_MS),
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

/** True for the rejection `AbortSignal.timeout` produces: a DOMException named TimeoutError. */
export function isTimeoutError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: unknown }).name === "TimeoutError"
  );
}

/** Status + body every alert route returns when `serviceFetch` times out. */
export const SERVICE_TIMEOUT = {
  status: 504,
  body: { error: "The alerts database timed out — please try again in a moment" },
} as const;

/**
 * Operand for a PostgREST `in.(…)` / `not.in.(…)` filter. Values are quoted
 * and URL-encoded rather than interpolated raw: they may be caller-supplied
 * strings going into a service-role request, where an unencoded `)` or `&`
 * would let the caller close the list and append their own query parameters.
 */
export function inList(values: string[]): string {
  return values
    .map((value) => encodeURIComponent(`"${value.replace(/["\\]/g, "")}"`))
    .join(",");
}
