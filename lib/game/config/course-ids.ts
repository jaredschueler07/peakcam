/**
 * lib/game/config/course-ids.ts
 * ─────────────────────────────
 * The two pure helpers the client and the server must agree on exactly: how a
 * trail name becomes a course id, and which UTC day a run belongs to.
 *
 * They live here rather than in `lib/game/server/courses.ts` because the Start
 * poster needs both to ask for a ticket, and importing the server module from a
 * client component dragged `profiles.ts` + `terrain/resorts.ts` into the browser
 * bundle for two string functions. `server/courses.ts` re-exports them, so
 * server callers are unchanged.
 *
 * Dependency-free on purpose — duplicating either side would drift silently and
 * every drifted id is a 404 from `POST /api/drop-in/sessions`.
 */

/**
 * A trail name as a URL/ticket-safe id: lowercased, diacritics folded, runs of
 * anything else collapsed to a single dash. "Kilómetro Lanzado" →
 * "kilometro-lanzado".
 */
export function trailIdFromName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** `YYYY-MM-DD` in UTC for an epoch-millisecond timestamp. */
export function utcDateStamp(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}
