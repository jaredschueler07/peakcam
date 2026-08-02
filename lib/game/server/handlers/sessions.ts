/**
 * lib/game/server/handlers/sessions.ts
 * ────────────────────────────────────
 * `POST /api/drop-in/sessions` — hand out a signed challenge for one run.
 *
 * This is step 1 of the anti-cheat flow in the architecture report §9: the
 * *server* chooses the seed and binds the whole course definition into a
 * short-lived HMAC ticket. The client cannot pick its own seed, cannot play a
 * different trail than the one it was issued, and cannot replay the ticket —
 * `drop_in_runs.run_nonce` is unique.
 *
 * Anonymous callers are welcome (DESIGN.md §6 keeps leaderboards open to
 * unauthenticated players); when a Supabase session exists the user id is
 * bound into the ticket and the submission route enforces the match, so a
 * ticket issued to one account cannot be spent by another.
 */

import { z } from "zod";

import { COURSE_VERSION, PHYSICS_VERSION } from "../../config/versions";
import { GHOST_SAMPLE_HZ } from "../../replay/recorder";
import { competitiveRunModeSchema } from "../run-schema";
import { courseSeed, resolveCourse, utcDateStamp } from "../courses";
import { issueTicket, activeKeyOf, type TicketKeyring } from "../run-ticket";
import { clientIpFrom, type RateLimiter } from "../rate-limit";
import { jsonError, jsonOk, rateLimitHeaders, readJsonBody } from "./http";

/** Sessions are cheap to issue but must not be farmed; 20 per 5 minutes per IP. */
export const SESSION_RATE_LIMIT = 20;
export const SESSION_RATE_WINDOW_MS = 5 * 60 * 1000;
/** Tickets last one run, not one sitting. Matches `MAX_TICKET_TTL_MS`. */
export const SESSION_TICKET_TTL_MS = 30 * 60 * 1000;
/** A session request is three short strings. */
const MAX_SESSION_BODY_BYTES = 2 * 1024;

export const sessionRequestSchema = z
  .object({
    resortSlug: z.string().min(1).max(64),
    mode: competitiveRunModeSchema,
    trailId: z.string().min(1).max(64),
  })
  .strict();

export interface SessionsHandlerDeps {
  /** Parsed `DROP_IN_TICKET_KEYS`. Throws when unset — a 500, not a 400. */
  keyring: () => TicketKeyring;
  /** Supabase `auth.users.id`, or `null` for an anonymous run. */
  currentUserId: () => Promise<string | null>;
  limiter: RateLimiter;
  now: () => number;
}

export interface SessionResponseBody {
  ticket: string;
  seed: number;
  resortSlug: string;
  mode: "time_trial" | "score_attack";
  trailId: string;
  physicsVersion: number;
  courseVersion: number;
  tickHz: number;
  /** ISO timestamp after which the ticket is dead and the run unsubmittable. */
  expiresAt: string;
}

/**
 * Keyframe rate the client must record at, echoed so it cannot drift silently.
 *
 * Derived from the recorder rather than written out again, because "cannot
 * drift silently" was exactly what a hand-copied `10` failed to deliver: the
 * recorder moved to 30 Hz and this constant did not, leaving the public
 * contract advertising a rate nothing sampled at. `validateRun` compares the
 * PCGH header against the submitted `tickHz`, so any client that believed this
 * field would have failed every honest run with `tick_hz_mismatch`.
 */
export const GHOST_TICK_HZ = GHOST_SAMPLE_HZ;

export async function handleCreateSession(
  request: Request,
  deps: SessionsHandlerDeps,
): Promise<Response> {
  const ip = clientIpFrom(request.headers);
  const decision = deps.limiter.check(ip, deps.now());
  if (!decision.allowed) {
    return jsonError(429, "Too many run sessions requested. Wait a moment and try again.", {
      headers: rateLimitHeaders(decision.retryAfterSeconds, decision.resetAtMs),
    });
  }

  const body = await readJsonBody(request, MAX_SESSION_BODY_BYTES);
  if (!body.ok) return jsonError(body.status, body.error);

  const parsed = sessionRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return jsonError(400, "Invalid session request", {
      extra: { issues: parsed.error.issues.map(issueOf) },
    });
  }

  const { resortSlug, mode, trailId } = parsed.data;
  const course = resolveCourse(resortSlug, trailId);
  if (!course) {
    return jsonError(404, "Unknown resort or trail");
  }

  let keyring: TicketKeyring;
  try {
    keyring = deps.keyring();
  } catch (error) {
    // Misconfiguration, not bad input: log it and stay vague to the client.
    console.error("[drop-in/sessions] ticket keyring unavailable:", error);
    return jsonError(500, "Run sessions are not available right now");
  }

  const now = deps.now();
  const seed = courseSeed(mode, resortSlug, trailId, COURSE_VERSION, utcDateStamp(now));
  const userId = (await deps.currentUserId()) ?? undefined;

  const ticket = issueTicket(
    {
      resortSlug,
      mode,
      trailId,
      seed,
      physicsVersion: PHYSICS_VERSION,
      courseVersion: COURSE_VERSION,
      userId,
    },
    { ...activeKeyOf(keyring), ttlMs: SESSION_TICKET_TTL_MS, now },
  );

  const payload: SessionResponseBody = {
    ticket,
    seed,
    resortSlug,
    mode,
    trailId,
    physicsVersion: PHYSICS_VERSION,
    courseVersion: COURSE_VERSION,
    tickHz: GHOST_TICK_HZ,
    expiresAt: new Date(now + SESSION_TICKET_TTL_MS).toISOString(),
  };

  // A ticket is minted per request and must never be reused from a cache.
  return jsonOk(payload, { status: 201, headers: { "Cache-Control": "no-store" } });
}

function issueOf(issue: { path: PropertyKey[]; message: string }) {
  return { path: issue.path.join("."), message: issue.message };
}
