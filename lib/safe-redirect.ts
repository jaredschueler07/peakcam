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
 *
 * Control characters are rejected outright, before the shape check. The WHATWG
 * URL parser strips tab, LF and CR from *anywhere* in the input and trims
 * leading C0/space, so "/\t/evil.tld" would otherwise satisfy a positional
 * check on the first two characters and then collapse to "//evil.tld" — an
 * off-origin redirect. No legitimate redirect path contains these bytes.
 */
export function safeNext(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "/";
  if (/[\u0000-\u0020\u007F]/.test(raw)) return "/";
  return /^\/(?![/\\])/.test(raw) ? raw : "/";
}
