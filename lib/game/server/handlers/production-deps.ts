/**
 * lib/game/server/handlers/production-deps.ts
 * ───────────────────────────────────────────
 * The real dependencies the Drop In Route Handlers run with: the ticket
 * keyring from the environment, the caller's Supabase session, the
 * service-role writer, the anon reader, and the process-local rate limiters.
 *
 * Kept apart from the handlers so a unit test can import a handler without
 * dragging in `next/headers`, `@supabase/ssr`, or a demand for production
 * secrets. Only the files under `app/api/drop-in/` import this module.
 *
 * The limiters are module-level singletons on purpose — one window per
 * serverless instance, with all the caveats documented in `../rate-limit.ts`.
 */

import { createSupabaseServerClient } from "@/lib/supabase-server";
import { supabase as anonClient } from "@/lib/supabase";

import { createSlidingWindowLimiter, type RateLimiter } from "../rate-limit";
import { parseTicketKeyring, type TicketKeyring } from "../run-ticket";
import { createSupabaseAdminClient } from "../supabase-admin";
import {
  createLeaderboardReader,
  createRunWriter,
  type LeaderboardReader,
  type RunWriter,
} from "../run-repository";
import { SESSION_RATE_LIMIT, SESSION_RATE_WINDOW_MS } from "./sessions";
import { RUN_RATE_LIMIT, RUN_RATE_WINDOW_MS } from "./runs";

export const sessionLimiter: RateLimiter = createSlidingWindowLimiter({
  limit: SESSION_RATE_LIMIT,
  windowMs: SESSION_RATE_WINDOW_MS,
});

export const runLimiter: RateLimiter = createSlidingWindowLimiter({
  limit: RUN_RATE_LIMIT,
  windowMs: RUN_RATE_WINDOW_MS,
});

let cachedKeyring: TicketKeyring | null = null;

/**
 * Parsed `DROP_IN_TICKET_KEYS`. Parsed once per instance and cached; a missing
 * or malformed value throws every call, which the handlers turn into a 500.
 */
export function ticketKeyring(): TicketKeyring {
  cachedKeyring ??= parseTicketKeyring(process.env.DROP_IN_TICKET_KEYS);
  return cachedKeyring;
}

/**
 * The signed-in user's id, or `null`. Never throws: an unreadable session is
 * an anonymous run, not a failed request.
 */
export async function currentUserId(): Promise<string | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return data.user.id;
  } catch (error) {
    console.error("[drop-in] could not read the Supabase session:", error);
    return null;
  }
}

/** Service-role writer — the only path that may insert a run. */
export function runWriter(): RunWriter {
  return createRunWriter(createSupabaseAdminClient());
}

/** Anon reader; RLS already limits SELECT to accepted rows. */
export function leaderboardReader(): LeaderboardReader {
  return createLeaderboardReader(anonClient);
}
