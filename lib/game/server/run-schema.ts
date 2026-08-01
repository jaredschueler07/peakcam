/**
 * lib/game/server/run-schema.ts
 * ─────────────────────────────
 * Zod contracts for the Drop In v2 run-submission API and the public
 * leaderboard projection (DESIGN.md §3.7, RUN-CONTRACTS.md).
 *
 * Two jobs, both about trust boundaries:
 *
 * 1. `runSubmissionSchema` is the *first* gate on an untrusted POST body. It
 *    only bounds shape and size — it says nothing about whether the run was
 *    played honestly. The ticket check, ghost decode, and (later) authoritative
 *    re-simulation are what actually decide `accepted`. Client-reported
 *    `timeMs`/`score` are recorded for comparison against the server's own
 *    derivation, never trusted as the score.
 *
 * 2. `publicLeaderboardRowSchema` is the *last* gate before bytes leave the
 *    server. `drop_in_runs` rows carry `validation_metrics`, `run_nonce`,
 *    `rejection_code`, `user_id`, and the ghost blob; none of those may reach a
 *    client. Parse every leaderboard response through this schema so a wider
 *    `select` can never silently widen the API.
 *
 * Pure zod: no Node built-ins, so the schemas can also validate on the client
 * before a submission is sent.
 */

import { z } from "zod";

// ─── Bounds ──────────────────────────────────────────────────
// These mirror the CHECK constraints in supabase/migrations/012_drop_in_runs.sql.
// Keep the two in sync: zod rejects politely, Postgres rejects with a 500.

/** 1 s — shorter than any legal descent. */
export const MIN_TIME_MS = 1_000;
/** 30 min — the `time_ms between 1000 and 1800000` ceiling. */
export const MAX_TIME_MS = 1_800_000;
export const MIN_SCORE = 0;
export const MAX_SCORE = 100_000_000;
/** Submission body limit from the architecture report §9. */
export const MAX_GHOST_BYTES = 128 * 1024;
export const MIN_TICK_HZ = 10;
export const MAX_TICK_HZ = 240;
/** Anonymous run nickname length; profanity screening happens server-side. */
export const MAX_NICKNAME_LENGTH = 24;

export const competitiveRunModeSchema = z.enum(["time_trial", "score_attack"]);

// ─── Ghost payload ───────────────────────────────────────────

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** Decoded byte length of a canonical base64 string. */
export function base64ByteLength(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

/**
 * Standard base64 (not base64url — this rides in a JSON body, not a URL) whose
 * decoded length fits the submission budget. Checked before any decode so an
 * oversized payload never reaches the codec.
 */
export const ghostBase64Schema = z
  .string()
  .min(4)
  .refine((v) => v.length % 4 === 0 && BASE64_RE.test(v), {
    message: "ghost must be standard base64",
  })
  .refine((v) => base64ByteLength(v) <= MAX_GHOST_BYTES, {
    message: `ghost must decode to at most ${MAX_GHOST_BYTES} bytes`,
  });

// ─── Submission ──────────────────────────────────────────────

/** Compact `header.payload.signature`, all base64url. */
const ticketSchema = z
  .string()
  .max(4096)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, "ticket is not a compact token");

const isoTimestampSchema = z.iso.datetime({ offset: true });

/**
 * `POST /api/drop-in/runs`. The ticket is authoritative for resort, mode,
 * trail, seed, and versions — none of those are accepted from the body, so a
 * client cannot resubmit one run against a different course.
 */
export const runSubmissionSchema = z
  .object({
    ticket: ticketSchema,
    ghost: ghostBase64Schema,
    /** Keyframe rate the ghost was recorded at; cross-checked against the header. */
    tickHz: z.number().int().min(MIN_TICK_HZ).max(MAX_TICK_HZ),
    /** Client-reported; compared with the server's own derivation, not trusted. */
    timeMs: z.number().int().min(MIN_TIME_MS).max(MAX_TIME_MS),
    score: z.number().int().min(MIN_SCORE).max(MAX_SCORE),
    startedAt: isoTimestampSchema,
    finishedAt: isoTimestampSchema,
    /** Display name for an anonymous run; signed-in runs use the profile. */
    nickname: z.string().trim().min(1).max(MAX_NICKNAME_LENGTH).optional(),
  })
  .strict()
  // One refinement, not two: `>= MIN_TIME_MS` already subsumes ordering, and a
  // single issue keeps the client's error list honest.
  .refine(
    (v) => Date.parse(v.finishedAt) - Date.parse(v.startedAt) >= MIN_TIME_MS,
    {
      message: `finishedAt must be at least ${MIN_TIME_MS}ms after startedAt`,
      path: ["finishedAt"],
    },
  );

export type RunSubmission = z.infer<typeof runSubmissionSchema>;

// ─── Public projection ───────────────────────────────────────

/**
 * The only shape a leaderboard response may take. Every field here is safe to
 * publish; anything absent is deliberately withheld — see the module header.
 */
export const publicLeaderboardRowSchema = z
  .object({
    id: z.uuid(),
    rank: z.number().int().positive(),
    mode: competitiveRunModeSchema,
    trailId: z.string().min(1),
    timeMs: z.number().int().min(MIN_TIME_MS).max(MAX_TIME_MS),
    score: z.number().int().min(MIN_SCORE).max(MAX_SCORE),
    physicsVersion: z.number().int().nonnegative(),
    courseVersion: z.number().int().nonnegative(),
    /** Nickname or profile name; null for an unclaimed anonymous run. */
    displayName: z.string().max(MAX_NICKNAME_LENGTH).nullable(),
    /** True when the row belongs to the requesting user — set by the server. */
    isSelf: z.boolean(),
    /** A ghost is available at `/api/drop-in/ghosts/[runId]`. */
    hasGhost: z.boolean(),
    finishedAt: isoTimestampSchema,
  })
  .strict();

export type PublicLeaderboardRow = z.infer<typeof publicLeaderboardRowSchema>;

export const publicLeaderboardSchema = z
  .object({
    resortSlug: z.string().min(1),
    mode: competitiveRunModeSchema,
    trailId: z.string().min(1),
    physicsVersion: z.number().int().nonnegative(),
    courseVersion: z.number().int().nonnegative(),
    rows: z.array(publicLeaderboardRowSchema),
  })
  .strict();

export type PublicLeaderboard = z.infer<typeof publicLeaderboardSchema>;

/**
 * Ordering per RUN-CONTRACTS.md: `time_trial` ranks by time ascending then
 * score descending; `score_attack` by score descending then time ascending.
 * The partial index in migration 012 cannot express both, so callers must ask
 * for the right one — this is the single place that decides.
 */
export function leaderboardOrder(
  mode: z.infer<typeof competitiveRunModeSchema>,
): ReadonlyArray<{ column: "time_ms" | "score"; ascending: boolean }> {
  return mode === "time_trial"
    ? [
        { column: "time_ms", ascending: true },
        { column: "score", ascending: false },
      ]
    : [
        { column: "score", ascending: false },
        { column: "time_ms", ascending: true },
      ];
}
