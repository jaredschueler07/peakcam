// ─────────────────────────────────────────────────────────────
// Client IP extraction from proxy headers.
// Edge- and Node-runtime safe: no Node built-ins. (The salted hash lives in
// ./hash-ip, which pulls in node:crypto — keep it out of this module.)
// ─────────────────────────────────────────────────────────────

export interface HeaderBearing {
  headers: { get(name: string): string | null };
}

/** Vercel sets x-forwarded-for; the first hop is the original client. */
export function extractIp(request: HeaderBearing): string | null {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0];
    return first === undefined ? null : first.trim();
  }
  return request.headers.get("x-real-ip");
}
