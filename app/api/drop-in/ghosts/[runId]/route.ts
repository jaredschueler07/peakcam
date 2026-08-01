// app/api/drop-in/ghosts/[runId]/route.ts
//
// GET /api/drop-in/ghosts/:runId
// The PCGH ghost blob of an accepted run, as application/octet-stream with
// immutable caching. 404 for anything missing or unaccepted.
//
// The logic lives in lib/game/server/handlers/ghosts.ts.

import type { NextRequest } from "next/server";

import { handleGetGhost } from "@/lib/game/server/handlers/ghosts";
import { leaderboardReader } from "@/lib/game/server/handlers/production-deps";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await context.params;
  return handleGetGhost(request, runId, { reader: leaderboardReader });
}
