// ─────────────────────────────────────────────────────────────
// Post-auth redirect validation
// The `next` parameter travels through the sign-in page, the magic-link
// callback, and AuthModal. Anything that isn't a same-origin relative path
// is a phishing primitive (the victim authenticates successfully, then lands
// on an attacker clone), so every sink funnels through safeNext().
// ─────────────────────────────────────────────────────────────

/**
 * Returns `raw` only when it is a same-origin relative path, otherwise "/".
 *
 * Rejects absolute URLs ("https://evil.tld"), protocol-relative URLs
 * ("//evil.tld") and the backslash variants browsers normalise to them
 * ("/\evil.tld"). Query strings and fragments are preserved.
 */
export function safeNext(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "/";
  return /^\/(?![/\\])/.test(raw) ? raw : "/";
}
