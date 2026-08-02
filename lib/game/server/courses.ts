/**
 * lib/game/server/courses.ts
 * ──────────────────────────
 * The server's view of what counts as a legal course: which trail ids exist at
 * a resort, how big the world box is around them, and the authoritative start
 * / finish Z gates for competitive validation.
 *
 * Two consumers, both on the trust boundary:
 *   - `POST /api/drop-in/sessions` refuses to mint a ticket for a trail that
 *     does not exist, so a fabricated `trailId` can never reach the board.
 *   - `POST /api/drop-in/runs` needs the world extent to bounds-check every
 *     ghost keyframe, and the start/finish Z to reject runs that never left
 *     the gate or never crossed the line.
 *
 * Read-only over `lib/game/config/profiles.ts` (trail names) and
 * `lib/game/terrain/resorts.ts` (bake extents). Trail *ids* are derived from
 * trail names here because no shared course registry exists yet — the
 * `RunDefinition` in `lib/game/config/modes.ts` is still just an interface with
 * no instances.
 *
 * ## startZ / finishZ provenance
 *
 * Gates are the first and last point Z of each real run after the same
 * orientation/trim pipeline used by `buildRealCourse` (`lib/game/terrain/
 * real-course.ts`, P5-RUN-SELECTION.md). Values were measured against the
 * committed `public/game/terrain/<slug>.{trails,height}` assets and are stored
 * here so the server stays free of heightfield I/O on the submit path. Bump
 * `COURSE_VERSION` if a re-bake moves a gate.
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
   * Authoritative course start along game Z (metres). Always set for the three
   * pilot resorts — see {@link COURSE_GATES}.
   */
  startZ: number;
  /**
   * Authoritative course finish along game Z (metres). Direction relative to
   * `startZ` defines the fall line (see run-lifecycle finish crossing).
   */
  finishZ: number;
}

/**
 * Start/finish Z (metres) for every competitive trail, keyed by resort then
 * trail id. Measured from the real-course polylines (P5).
 *
 * **Always-on gates:** when these values are present, `validateRun` always
 * enforces start/finish (A5). That is stricter than the pre-A5 baseline, where
 * `startZ`/`finishZ` were optional and `startFinishChecked` stayed false. The
 * `DROP_IN_RESIM` flag only gates the *trajectory re-sim* branch — not these
 * course gates. Bump `COURSE_VERSION` if a re-bake moves a gate.
 */
export const COURSE_GATES: Readonly<
  Record<DropInResortSlug, Readonly<Record<string, Readonly<{ startZ: number; finishZ: number }>>>>
> = {
  "ski-portillo": {
    "roca-jack": { startZ: -846.9, finishZ: -699.5 },
    juncalillo: { startZ: -705.7, finishZ: -765.8 },
    "el-plateau": { startZ: -1312.4, finishZ: -1040.6 },
    "la-garganta": { startZ: -1312.4, finishZ: -941 },
    "kilometro-lanzado": { startZ: -159.6, finishZ: 556.8 },
    "las-vizcachas": { startZ: -1040.6, finishZ: -878.3 },
  },
  breckenridge: {
    "horseshoe-bowl": { startZ: 290.4, finishZ: 86.7 },
    "imperial-bowl": { startZ: 269.2, finishZ: 522.3 },
    "devil-s-crotch": { startZ: 1334.6, finishZ: 929.6 },
    "four-o-clock": { startZ: 459.5, finishZ: 222 },
    "whale-s-tail": { startZ: 40.3, finishZ: -375.1 },
    psychopath: { startZ: 615.3, finishZ: 883.5 },
  },
  heavenly: {
    gunbarrel: { startZ: 1002, finishZ: 638 },
    "ridge-run": { startZ: 2565, finishZ: 1912.4 },
    "milky-way-bowl": { startZ: 1911, finishZ: 1546.4 },
    "mott-canyon": { startZ: 1509.5, finishZ: 657.3 },
    "olympic-downhill": { startZ: -236.1, finishZ: -1514.9 },
    "killebrew-canyon": { startZ: 2909.8, finishZ: 2356.3 },
  },
};

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

  const gates = COURSE_GATES[resortSlug][trailId];
  if (!gates) return null;

  return {
    resortSlug,
    trailId,
    trailName: trail.name,
    halfSizeM: bake.sizeM / 2,
    startZ: gates.startZ,
    finishZ: gates.finishZ,
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
