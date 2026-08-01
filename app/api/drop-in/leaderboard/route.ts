// app/api/drop-in/leaderboard/route.ts
//
// GET /api/drop-in/leaderboard?resort=&mode=&trailId=&limit=
// Accepted runs for one course, projected through publicLeaderboardRowSchema.
// Anonymous responses are CDN-cacheable; signed-in ones carry isSelf and are
// therefore private.
//
// The logic lives in lib/game/server/handlers/leaderboard.ts.

import type { NextRequest } from "next/server";

import { handleGetLeaderboard } from "@/lib/game/server/handlers/leaderboard";
import { currentUserId, leaderboardReader } from "@/lib/game/server/handlers/production-deps";

export const runtime = "nodejs";
// The handler sets its own Cache-Control; the response varies with the session.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  return handleGetLeaderboard(request, {
    reader: leaderboardReader,
    currentUserId,
  });
}
