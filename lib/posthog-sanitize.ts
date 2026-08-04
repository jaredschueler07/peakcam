// ─────────────────────────────────────────────────────────────
// Redaction of capability tokens from analytics properties.
//
// `/alerts/manage?token=<64 hex chars>` carries a bearer capability with no
// expiry that authorises reading the subscriber's email, rewriting their alert
// preferences and deleting the subscription. PostHog records $current_url on
// every pageview, so without this the token is stored indefinitely in event
// properties. The same applies to the Supabase auth `code` (PKCE) and to
// access/refresh tokens, which arrive in the URL fragment under implicit flow.
// ─────────────────────────────────────────────────────────────

/** Query/fragment parameter names whose values must never reach analytics. */
export const SENSITIVE_URL_PARAMS = new Set([
  "token",
  "manage_token",
  // Supabase one-time-password / email-confirmation links carry token_hash.
  "token_hash",
  "code",
  "access_token",
  "refresh_token",
  "provider_token",
  "provider_refresh_token",
]);

const REDACTED = "[redacted]";

function redactParamList(query: string): string {
  return query
    .split("&")
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq === -1) return pair;
      const key = pair.slice(0, eq);
      let decoded = key;
      try {
        decoded = decodeURIComponent(key);
      } catch {
        // Malformed percent-encoding — fall back to the raw key.
      }
      return SENSITIVE_URL_PARAMS.has(decoded.toLowerCase())
        ? `${key}=${REDACTED}`
        : pair;
    })
    .join("&");
}

/**
 * Replaces the value of every sensitive parameter in `url` with `[redacted]`,
 * leaving the rest of the URL — including the path, which analytics needs —
 * untouched. Works on absolute and relative URLs alike, and covers the
 * fragment as well as the query string because implicit-flow auth tokens
 * arrive after the `#`.
 */
export function redactSensitiveUrl(url: string): string {
  const hashAt = url.indexOf("#");
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const fragment = hashAt === -1 ? null : url.slice(hashAt + 1);

  const queryAt = beforeHash.indexOf("?");
  let out =
    queryAt === -1
      ? beforeHash
      : `${beforeHash.slice(0, queryAt)}?${redactParamList(beforeHash.slice(queryAt + 1))}`;

  if (fragment !== null) {
    // A fragment with no "=" is an anchor (#main-content), not parameters.
    out += `#${fragment.includes("=") ? redactParamList(fragment) : fragment}`;
  }

  return out;
}

/**
 * Property-bag sanitizer. Every string-valued property is passed
 * through {@link redactSensitiveUrl} rather than an allow-list of known URL
 * property names, because PostHog adds URL-bearing properties over time
 * ($current_url, $pathname, $referrer, $initial_*, session-replay entry URLs)
 * and an allow-list silently misses the next one. Strings without a sensitive
 * parameter are returned unchanged.
 */
export function sanitizeAnalyticsProperties(
  properties: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...properties };
  for (const [key, value] of Object.entries(out)) {
    if (typeof value === "string") out[key] = redactSensitiveUrl(value);
  }
  return out;
}

/**
 * PostHog `before_send` hook — sanitizes an event's whole property bag on its
 * way out, covering the events PostHog captures on its own (autocapture,
 * $pageleave, web vitals) as well as this app's explicit `capture` calls.
 *
 * `before_send` rather than `sanitize_properties`: the latter is deprecated in
 * posthog-js 1.362.0. It still works, but it logs a console.error on every
 * captured event, and a future version dropping it would silently stop
 * redacting automatic events while the explicit redaction in lib/posthog.tsx
 * kept working — a failure with no visible symptom.
 *
 * Returns the event (never null) so no event is dropped; only redacted.
 */
export function sanitizeCaptureEvent<
  E extends { properties?: Record<string, unknown> } | null,
>(event: E): E {
  if (!event?.properties) return event;
  return {
    ...event,
    properties: sanitizeAnalyticsProperties(event.properties),
    // The spread widens the type past E's constraint; the shape is unchanged.
  } as E;
}
