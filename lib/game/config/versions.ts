/**
 * lib/game/config/versions.ts
 * ───────────────────────────
 * The two integers that decide which runs are mutually rankable.
 *
 * Every `drop_in_runs` row stores the versions it was played under
 * (migration 015), and the leaderboard query filters on them, so a bump here
 * silently starts a fresh board rather than mixing incomparable times.
 *
 * - `PHYSICS_VERSION` — bump when the deterministic core changes in any way
 *   that alters a run's outcome from the same seed + input trace.
 * - `COURSE_VERSION` — bump when terrain, trail corridors, obstacle placement,
 *   or start/finish geometry change.
 *
 * Deliberately dependency-free: imported by the browser runtime, by the run
 * recorder, and by the server-side submission path.
 */

export const PHYSICS_VERSION = 1;
export const COURSE_VERSION = 1;
