// app/api/drop-in/runs/route.ts
//
// POST /api/drop-in/runs
// Verifies the run ticket, decodes the PCGH ghost, runs baseline validation,
// and writes an accepted or rejected row with the service-role key (migration
// 015 grants clients SELECT only).
//
// The logic lives in lib/game/server/handlers/runs.ts; this file supplies the
// production dependencies.

import type { NextRequest } from "next/server";

import { handleSubmitRun } from "@/lib/game/server/handlers/runs";
import {
  currentUserId,
  runLimiter,
  runWriter,
  ticketKeyring,
} from "@/lib/game/server/handlers/production-deps";

// node:crypto for the ticket HMAC and the ghost digest.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  return handleSubmitRun(request, {
    keyring: ticketKeyring,
    currentUserId,
    writer: runWriter,
    limiter: runLimiter,
    now: () => Date.now(),
  });
}
