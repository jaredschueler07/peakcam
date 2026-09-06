// app/api/drop-in/sessions/route.ts
//
// POST /api/drop-in/sessions
// Issues a server-signed run ticket for one competitive Drop In run: the
// server picks the seed, stamps the physics/course versions, and binds the
// signed-in user when there is one. Anonymous runs are allowed.
//
// The logic lives in lib/game/server/handlers/sessions.ts so it can be unit
// tested without mocking Next module resolution; this file is the adapter that
// supplies the production dependencies.

import { dailyMorningConditions } from "@/lib/game/server/morning-snapshot";
import type { NextRequest } from "next/server";

import { handleCreateSession } from "@/lib/game/server/handlers/sessions";
import {
  currentUserId,
  sessionLimiter,
  ticketKeyring,
} from "@/lib/game/server/handlers/production-deps";

// node:crypto (HMAC) — not the edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  return handleCreateSession(request, {
    keyring: ticketKeyring,
    dailyConditions: dailyMorningConditions,
    currentUserId,
    limiter: sessionLimiter,
    now: () => Date.now(),
  });
}
