/**
 * lib/game/server/courses.ts
 * ──────────────────────────
 * The server's view of what counts as a legal course: which trail ids exist at
 * a resort, and how big the world box is around them.
 *
 * Two consumers, both on the trust boundary:
 *   - `POST /api/drop-in/sessions` refuses to mint a ticket for a trail that
 *     does not exist, so a fabricated `trailId` can never reach the board.
 *   - `POST /api/drop-in/runs` needs the world extent to bounds-check every
 *     ghost keyframe.
 *
 * Read-only over `lib/game/config/profiles.ts` (trail names) and
 * `lib/game/terrain/resorts.ts` (bake extents). Trail *ids* are derived from
 * trail names here because no shared course registry exists yet — the
 * `RunDefinition` in `lib/game/config/modes.ts` is still just an interface with
 * no instances. When that registry lands, `resolveCourse` should read it
 * instead, and `startZ`/`finishZ` (see {@link ServerCourse}) should stop being
 * optional.
 */

import { DROP_IN_GAME_PROFILES } from "../config/profiles";
// Shared with the client (the Start poster derives the same ids); re-exported
// below so server callers keep importing them from here.
import { trailIdFromName, utcDateStamp } from "../config/course-ids";
import type { CompetitiveRunMode } from "../config/modes";
import type { DropInResortSlug } from "../config/schema";
import { RESORT_BAKE_CONFIGS } from "../terrain/resorts";

export { trailIdFromName, utcDateStamp };


export interface ServerCourse {
  resortSlug: DropInResortSlug;
  trailId: string;
  trailName: string;
  /** Half the bake-box edge, metres. World X/Z live in `[-half, +half]`. */
  halfSizeM: number;
  /**
   * Authoritative course start/finish along Z, when a course registry defines
   * them. Absent today — see the module header; the validator degrades to the
   * weaker start/finish checks it can make without them.
   */
  startZ?: number;
  finishZ?: number;
}

function isResortSlug(slug: string): slug is DropInResortSlug {
  return Object.hasOwn(DROP_IN_GAME_PROFILES, slug);
}

/** Every trail id playable at a resort, in profile order. Empty if unknown. */
export function trailIdsForResort(resortSlug: string): string[] {
  if (!isResortSlug(resortSlug)) return [];
  const profile = DROP_IN_GAME_PROFILES[resortSlug];
  return profile ? profile.trails.map((trail) => trailIdFromName(trail.name)) : [];
}

/** The course, or `null` when the resort or trail does not exist. */
export function resolveCourse(resortSlug: string, trailId: string): ServerCourse | null {
  if (!isResortSlug(resortSlug)) return null;

  const profile = DROP_IN_GAME_PROFILES[resortSlug];
  const bake = RESORT_BAKE_CONFIGS[resortSlug];
  if (!profile || !bake) return null;

  const trail = profile.trails.find((t) => trailIdFromName(t.name) === trailId);
  if (!trail) return null;

  return {
    resortSlug,
    trailId,
    trailName: trail.name,
    halfSizeM: bake.sizeM / 2,
  };
}

/**
 * Course seeds are deterministic, never per-session random: two players racing
 * the same board must get the same terrain, weather, and obstacles.
 *
 * - `time_trial` is fixed for the life of a course version (RUN-CONTRACTS.md:
 *   "a selected trail, fixed seed/weather, fixed start and finish").
 * - `score_attack` is the Daily Line — it rotates once per UTC day, which is
 *   also what makes the board resettable without a migration.
 */
export function courseSeed(
  mode: CompetitiveRunMode,
  resortSlug: string,
  trailId: string,
  courseVersion: number,
  utcDate: string,
): number {
  const material =
    mode === "score_attack"
      ? `${resortSlug}|${trailId}|${courseVersion}|${utcDate}`
      : `${resortSlug}|${trailId}|${courseVersion}`;
  return fnv1a32(material);
}

/**
 * FNV-1a, 32-bit. Not a security primitive — the seed is public and the ticket
 * HMAC is what stops tampering — just a stable, dependency-free spread that
 * gives the same number in the browser and on the server.
 */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
