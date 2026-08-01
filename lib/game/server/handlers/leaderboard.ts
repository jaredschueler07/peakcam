/**
 * lib/game/server/handlers/leaderboard.ts
 * ───────────────────────────────────────
 * `GET /api/drop-in/leaderboard` — the public board for one course.
 *
 * A board is always one `(resort, mode, trail, physicsVersion, courseVersion)`
 * tuple. Filtering on the versions is not an optimisation: a physics or course
 * bump makes older times incomparable, and mixing them would silently rank a
 * player against a mountain that no longer exists.
 *
 * Every row leaves through `publicLeaderboardRowSchema`. Migration 015 warns
 * that RLS exposes whole rows to anyone who can see them — `validation_metrics`,
 * `run_nonce`, `rejection_code`, `user_id` and all — so the projection is the
 * actual API boundary, and parsing (not casting) is what keeps a widened
 * `select` from widening the response.
 *
 * ## Caching
 *
 * Anonymous responses are shared-cacheable (`s-maxage=60,
 * stale-while-revalidate=300`): a board that is a minute stale is fine, and the
 * CDN absorbs the traffic. A signed-in response carries `isSelf` and is
 * therefore per-user, so it is `private, no-store` — caching it at the edge
 * would hand one player's identity to the next.
 */

import { z } from "zod";

import { COURSE_VERSION, PHYSICS_VERSION } from "../../config/versions";
import { resolveCourse } from "../courses";
import {
  competitiveRunModeSchema,
  leaderboardOrder,
  publicLeaderboardSchema,
  type PublicLeaderboard,
  type PublicLeaderboardRow,
} from "../run-schema";
import type { LeaderboardReader } from "../run-repository";
import { jsonError, jsonOk } from "./http";

export const DEFAULT_LEADERBOARD_LIMIT = 20;
export const MAX_LEADERBOARD_LIMIT = 50;
export const LEADERBOARD_S_MAXAGE_SECONDS = 60;
export const LEADERBOARD_SWR_SECONDS = 300;

export const leaderboardQuerySchema = z
  .object({
    resort: z.string().min(1).max(64),
    mode: competitiveRunModeSchema,
    trailId: z.string().min(1).max(64),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_LEADERBOARD_LIMIT)
      .default(DEFAULT_LEADERBOARD_LIMIT),
  })
  .strict();

export interface LeaderboardHandlerDeps {
  reader: () => LeaderboardReader;
  /** `null` for an anonymous request; drives `isSelf` and the cache policy. */
  currentUserId: () => Promise<string | null>;
}

export async function handleGetLeaderboard(
  request: Request,
  deps: LeaderboardHandlerDeps,
): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const parsed = leaderboardQuerySchema.safeParse({
    resort: params.get("resort") ?? undefined,
    mode: params.get("mode") ?? undefined,
    trailId: params.get("trailId") ?? undefined,
    ...(params.get("limit") === null ? {} : { limit: params.get("limit") }),
  });

  if (!parsed.success) {
    return jsonError(400, "Invalid leaderboard query", {
      extra: {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    });
  }

  const { resort, mode, trailId, limit } = parsed.data;
  if (!resolveCourse(resort, trailId)) {
    return jsonError(404, "Unknown resort or trail");
  }

  const reader = deps.reader();
  const resortId = await reader.resortIdBySlug(resort);
  if (!resortId) {
    return jsonError(404, "Unknown resort or trail");
  }

  const userId = await deps.currentUserId();

  const rows = await reader.topRuns({
    resortId,
    mode,
    trailId,
    physicsVersion: PHYSICS_VERSION,
    courseVersion: COURSE_VERSION,
    limit,
    order: leaderboardOrder(mode),
  });

  const projected: PublicLeaderboardRow[] = rows.map((row, index) => ({
    id: row.id,
    rank: index + 1,
    mode: row.mode,
    trailId: row.trailId,
    timeMs: row.timeMs,
    score: row.score,
    physicsVersion: row.physicsVersion,
    courseVersion: row.courseVersion,
    // Sanitised at submission time (lib/game/server/nickname.ts). Null for a
    // run whose player gave no nickname, including signed-in players until
    // profile names are wired up.
    displayName: row.displayName,
    isSelf: userId !== null && row.userId === userId,
    hasGhost: row.ghostKeyframes > 0,
    finishedAt: new Date(row.finishedAt).toISOString(),
  }));

  const board: PublicLeaderboard = {
    resortSlug: resort,
    mode,
    trailId,
    physicsVersion: PHYSICS_VERSION,
    courseVersion: COURSE_VERSION,
    rows: projected,
  };

  // Parse, don't cast: a row that somehow carries an extra field fails here
  // rather than leaking.
  const safe = publicLeaderboardSchema.safeParse(board);
  if (!safe.success) {
    console.error("[drop-in/leaderboard] projection failed:", safe.error.issues);
    return jsonError(500, "Could not build the leaderboard");
  }

  return jsonOk(safe.data, {
    headers: {
      "Cache-Control": userId
        ? "private, no-store"
        : `public, s-maxage=${LEADERBOARD_S_MAXAGE_SECONDS}, stale-while-revalidate=${LEADERBOARD_SWR_SECONDS}`,
    },
  });
}
