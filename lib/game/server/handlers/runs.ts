/**
 * lib/game/server/handlers/runs.ts
 * ────────────────────────────────
 * `POST /api/drop-in/runs` — steps 3–6 of the anti-cheat flow (architecture
 * report §9): verify the ticket, decode the ghost, validate the trace, and
 * write an accepted or rejected row.
 *
 * ## Status codes
 *
 * | Code | Meaning |
 * |------|---------|
 * | 201  | Submission stored. `accepted` says whether it ranks. |
 * | 400  | Malformed JSON or a body the submission schema rejects. |
 * | 401  | Ticket does not verify, or belongs to a different user. |
 * | 409  | Ticket already spent (`run_nonce` unique violation). |
 * | 410  | Ticket expired — the run took longer than the 30-minute TTL. |
 * | 413  | Body over 128 KB. |
 * | 422  | Ghost will not decode, or cannot be stored as a rejected row. |
 * | 429  | Per-IP rate limit. |
 *
 * A *validated* rejection is a 201, not a 4xx: the submission was well-formed
 * and the server stored it as anti-cheat telemetry. The client learns
 * `accepted: false` and a coarse `rejectionCode`; it never learns which bound
 * it missed by how much, because that is a map for tuning a cheat.
 *
 * ## What is not stored
 *
 * A ghost that fails to *decode* has no keyframe count, and migration 015
 * checks `ghost_keyframes between 2 and 20000` — such a submission cannot be
 * written as a row at all, so it is a 422 with no telemetry. Same for a run
 * rejected for its keyframe count. Everything else is retained.
 */

import { createHash } from "node:crypto";

import { COURSE_VERSION, PHYSICS_VERSION } from "../../config/versions";
import { decodeGhost, GhostDecodeError, type DecodedGhost } from "../../replay/codec";
import { MAX_GHOST_BYTES, runSubmissionSchema } from "../run-schema";
import { resolveCourse } from "../courses";
import { sanitizeNickname } from "../nickname";
import { RunTicketError, verifyTicket, type RunTicketPayload, type TicketKeyring } from "../run-ticket";
import { clientIpFrom, type RateLimiter } from "../rate-limit";
import type { RunWriter } from "../run-repository";
import {
  canPersistRejection,
  rejectionCodeForGhostError,
  rejectionCodeForTicketError,
  validateRun,
  type RejectionCode,
} from "../validate-run";
import { jsonError, jsonOk, rateLimitHeaders, readJsonBody } from "./http";

/** Ghost blobs dominate the body; the report's initial limit is ~128 KB. */
export const MAX_RUN_BODY_BYTES = 128 * 1024 + 4 * 1024;
/** Submissions are once per ticket anyway; this only blunts spray. */
export const RUN_RATE_LIMIT = 12;
export const RUN_RATE_WINDOW_MS = 5 * 60 * 1000;

export interface RunsHandlerDeps {
  keyring: () => TicketKeyring;
  currentUserId: () => Promise<string | null>;
  writer: () => RunWriter;
  limiter: RateLimiter;
  now: () => number;
}

export interface RunSubmissionResponseBody {
  runId: string;
  accepted: boolean;
  /** Coarse reason, present only when `accepted` is false. */
  rejectionCode?: RejectionCode;
  /**
   * The stored time and score. Still the client's figures — the server only
   * checks they agree with the ghost's tick span. They become server-derived
   * when re-simulation lands (DESIGN.md §3.7).
   */
  timeMs: number;
  score: number;
  mode: "time_trial" | "score_attack";
  trailId: string;
  physicsVersion: number;
  courseVersion: number;
  /** The nickname as stored — sanitised, so the client renders what others see. */
  displayName: string | null;
}

export async function handleSubmitRun(
  request: Request,
  deps: RunsHandlerDeps,
): Promise<Response> {
  const decision = deps.limiter.check(clientIpFrom(request.headers), deps.now());
  if (!decision.allowed) {
    return jsonError(429, "Too many submissions. Wait a moment and try again.", {
      headers: rateLimitHeaders(decision.retryAfterSeconds, decision.resetAtMs),
    });
  }

  const body = await readJsonBody(request, MAX_RUN_BODY_BYTES);
  if (!body.ok) return jsonError(body.status, body.error);

  const parsed = runSubmissionSchema.safeParse(body.value);
  if (!parsed.success) {
    return jsonError(400, "Invalid run submission", {
      extra: { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
    });
  }
  const submission = parsed.data;

  // ── 1. Ticket ──

  let keyring: TicketKeyring;
  try {
    keyring = deps.keyring();
  } catch (error) {
    console.error("[drop-in/runs] ticket keyring unavailable:", error);
    return jsonError(500, "Run submission is not available right now");
  }

  let ticket: RunTicketPayload;
  try {
    ticket = verifyTicket(submission.ticket, keyring, { now: deps.now() });
  } catch (error) {
    if (!(error instanceof RunTicketError)) throw error;
    const rejectionCode = rejectionCodeForTicketError(error);
    // Expired is its own status: the client should start a new session rather
    // than treat the run as cheating. 410 says "this challenge is gone".
    const status = error.code === "expired" ? 410 : 401;
    return jsonError(
      status,
      error.code === "expired" ? "This run ticket has expired" : "This run ticket is not valid",
      { extra: { rejectionCode } },
    );
  }

  // A ticket issued to a signed-in player is spendable only by that player.
  // Anonymous tickets stay anonymous even if the player signs in mid-run —
  // binding them late would let one account harvest another's tickets.
  const userId = await deps.currentUserId();
  if (ticket.userId && ticket.userId !== userId) {
    return jsonError(401, "This run ticket was issued to a different account", {
      extra: { rejectionCode: "ticket_user_mismatch" satisfies RejectionCode },
    });
  }

  // The ticket, not the body, decides the course.
  const course = resolveCourse(ticket.resortSlug, ticket.trailId);
  if (!course) {
    console.error(
      `[drop-in/runs] ticket names an unknown course ${ticket.resortSlug}/${ticket.trailId}`,
    );
    return jsonError(422, "This run's course no longer exists", {
      extra: { rejectionCode: "course_mismatch" satisfies RejectionCode },
    });
  }

  // ── 2. Ghost ──

  const ghostBytes = new Uint8Array(Buffer.from(submission.ghost, "base64"));
  if (ghostBytes.byteLength > MAX_GHOST_BYTES) {
    return jsonError(413, `Ghost exceeds the ${MAX_GHOST_BYTES} byte limit`);
  }

  let ghost: DecodedGhost;
  try {
    ghost = decodeGhost(ghostBytes);
  } catch (error) {
    if (!(error instanceof GhostDecodeError)) throw error;
    return jsonError(422, "The ghost replay could not be read", {
      extra: { rejectionCode: rejectionCodeForGhostError(error) },
    });
  }

  // ── 3. Baseline validation ──

  const result = validateRun({ ticket, submission, ghost, course });
  if (!result.accepted) {
    console.warn(
      `[drop-in/runs] rejected ${ticket.resortSlug}/${ticket.trailId} ` +
        `(${result.rejectionCode}): ${result.reason}`,
    );
    if (!canPersistRejection(ghost)) {
      return jsonError(422, "This run could not be recorded", {
        extra: { rejectionCode: result.rejectionCode },
      });
    }
  }

  // ── 4. Persist ──

  const writer = deps.writer();
  const resortId = await writer.resortIdBySlug(ticket.resortSlug);
  if (!resortId) {
    console.error(`[drop-in/runs] no resorts row for slug ${ticket.resortSlug}`);
    return jsonError(500, "Could not record this run");
  }

  // Sanitised once and reused, so the row and the response can never disagree
  // about what the player is called.
  const displayName = sanitizeNickname(submission.nickname);

  const insert = await writer.insertRun({
    resortId,
    userId: ticket.userId ?? userId ?? null,
    displayName,
    mode: ticket.mode,
    trailId: ticket.trailId,
    timeMs: submission.timeMs,
    score: submission.score,
    physicsVersion: PHYSICS_VERSION,
    courseVersion: COURSE_VERSION,
    ghostVersion: ghost.meta.formatVersion,
    tickHz: submission.tickHz,
    runNonce: ticket.nonce,
    ghostData: ghostBytes,
    ghostSha256: sha256(ghostBytes),
    ghostKeyframes: ghost.samples.length,
    accepted: result.accepted,
    rejectionCode: result.rejectionCode,
    validationMetrics: result.metrics,
    startedAt: submission.startedAt,
    finishedAt: submission.finishedAt,
  });

  if (!insert.ok) {
    if (insert.reason === "nonce_replay") {
      return jsonError(409, "This run has already been submitted", {
        extra: { rejectionCode: "nonce_replay" satisfies RejectionCode },
      });
    }
    console.error("[drop-in/runs] insert failed:", insert.message);
    return jsonError(500, "Could not record this run");
  }

  const payload: RunSubmissionResponseBody = {
    runId: insert.id,
    accepted: result.accepted,
    ...(result.rejectionCode ? { rejectionCode: result.rejectionCode } : {}),
    timeMs: submission.timeMs,
    score: submission.score,
    mode: ticket.mode,
    trailId: ticket.trailId,
    physicsVersion: PHYSICS_VERSION,
    courseVersion: COURSE_VERSION,
    displayName,
  };

  return jsonOk(payload, { status: 201, headers: { "Cache-Control": "no-store" } });
}

function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}
