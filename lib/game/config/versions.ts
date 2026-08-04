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
/**
 * 2 — the Phase 1 DEM upgrade re-baked every heightfield from a real elevation
 * source (Portillo Copernicus GLO-30, Breckenridge 3DEP 1 m lidar, Heavenly
 * 3DEP 1/3 arc-second seamless), which moved the terrain under every course
 * and shifted one gate. `PHYSICS_VERSION` deliberately stays 1: the
 * deterministic core is byte-for-byte unchanged, only the ground it runs over.
 */
export const COURSE_VERSION = 2;
