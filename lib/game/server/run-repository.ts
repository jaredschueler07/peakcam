/**
 * lib/game/server/run-repository.ts
 * ─────────────────────────────────
 * The only place that knows `drop_in_runs` is a Postgres table.
 *
 * The Route Handlers depend on the three narrow interfaces below, not on
 * `SupabaseClient`. That keeps two things honest at once: the handlers stay
 * testable with a dozen lines of hand-rolled stub instead of a mocked query
 * builder, and every column name, every `bytea` round trip, and the
 * unique-violation mapping live in one file that can be re-read against the
 * migration.
 *
 * Reads and writes use different clients on purpose:
 *   - {@link createRunWriter} takes the **service-role** client. Migration 015
 *     defines no client INSERT policy, so this is the only path that can write
 *     a run, and it must never be handed a user-scoped client.
 *   - {@link createLeaderboardReader} takes an anon or cookie-bound client and
 *     leans on RLS, which already limits SELECT to accepted rows (plus the
 *     caller's own rejected ones — hence the explicit `accepted` filter on
 *     every query).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { fromByteaHex, toByteaHex } from "./supabase-admin";
import type { RejectionCode, RunValidationMetrics } from "./validate-run";
import type { CompetitiveRunMode } from "../config/modes";

/** Postgres `unique_violation` — the `run_nonce` constraint firing. */
const UNIQUE_VIOLATION = "23505";

// ─── Write side ──────────────────────────────────────────────

export interface RunInsert {
  resortId: string;
  userId: string | null;
  /** Sanitised nickname, or `null` for an unnamed run. */
  displayName: string | null;
  mode: CompetitiveRunMode;
  trailId: string;
  timeMs: number;
  score: number;
  physicsVersion: number;
  courseVersion: number;
  ghostVersion: number;
  tickHz: number;
  runNonce: string;
  ghostData: Uint8Array;
  ghostSha256: Uint8Array;
  ghostKeyframes: number;
  accepted: boolean;
  rejectionCode: RejectionCode | null;
  validationMetrics: RunValidationMetrics;
  startedAt: string;
  finishedAt: string;
}

export type RunInsertResult =
  | { ok: true; id: string; createdAt: string }
  /** The nonce was already spent — this ticket has been submitted before. */
  | { ok: false; reason: "nonce_replay" }
  | { ok: false; reason: "error"; message: string };

export interface RunWriter {
  resortIdBySlug(slug: string): Promise<string | null>;
  insertRun(run: RunInsert): Promise<RunInsertResult>;
}

export function createRunWriter(client: SupabaseClient): RunWriter {
  return {
    async resortIdBySlug(slug) {
      const { data, error } = await client
        .from("resorts")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (error) {
        console.error("[drop-in] resort lookup failed:", error.message);
        return null;
      }
      return (data?.id as string | undefined) ?? null;
    },

    async insertRun(run) {
      const { data, error } = await client
        .from("drop_in_runs")
        .insert({
          resort_id: run.resortId,
          user_id: run.userId,
          display_name: run.displayName,
          mode: run.mode,
          trail_id: run.trailId,
          time_ms: run.timeMs,
          score: run.score,
          physics_version: run.physicsVersion,
          course_version: run.courseVersion,
          ghost_version: run.ghostVersion,
          tick_hz: run.tickHz,
          run_nonce: run.runNonce,
          ghost_data: toByteaHex(run.ghostData),
          ghost_sha256: toByteaHex(run.ghostSha256),
          ghost_keyframes: run.ghostKeyframes,
          accepted: run.accepted,
          rejection_code: run.rejectionCode,
          validation_metrics: run.validationMetrics,
          started_at: run.startedAt,
          finished_at: run.finishedAt,
        })
        .select("id, created_at")
        .single();

      if (error) {
        // The nonce unique constraint is the one-time-use control from the
        // architecture report §9. Postgres is the enforcement point; this just
        // recognises it.
        if (error.code === UNIQUE_VIOLATION) return { ok: false, reason: "nonce_replay" };
        return { ok: false, reason: "error", message: error.message };
      }
      if (!data) return { ok: false, reason: "error", message: "insert returned no row" };

      return { ok: true, id: data.id as string, createdAt: data.created_at as string };
    },
  };
}

// ─── Read side ───────────────────────────────────────────────

export interface LeaderboardQuery {
  resortId: string;
  mode: CompetitiveRunMode;
  trailId: string;
  physicsVersion: number;
  courseVersion: number;
  limit: number;
  order: ReadonlyArray<{ column: "time_ms" | "score"; ascending: boolean }>;
}

/** A stored run as the leaderboard reads it — projected before it leaves the API. */
export interface LeaderboardRunRow {
  id: string;
  mode: CompetitiveRunMode;
  trailId: string;
  timeMs: number;
  score: number;
  physicsVersion: number;
  courseVersion: number;
  userId: string | null;
  displayName: string | null;
  finishedAt: string;
  ghostKeyframes: number;
}

export interface StoredGhost {
  bytes: Uint8Array;
  sha256Hex: string;
}

export interface LeaderboardReader {
  resortIdBySlug(slug: string): Promise<string | null>;
  topRuns(query: LeaderboardQuery): Promise<LeaderboardRunRow[]>;
  /** Ghost bytes of an **accepted** run, or `null` when there is no such run. */
  acceptedGhost(runId: string): Promise<StoredGhost | null>;
}

export function createLeaderboardReader(client: SupabaseClient): LeaderboardReader {
  return {
    async resortIdBySlug(slug) {
      const { data, error } = await client
        .from("resorts")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (error) {
        console.error("[drop-in] resort lookup failed:", error.message);
        return null;
      }
      return (data?.id as string | undefined) ?? null;
    },

    async topRuns(query) {
      let builder = client
        .from("drop_in_runs")
        .select(
          "id, mode, trail_id, time_ms, score, physics_version, course_version, user_id, display_name, finished_at, ghost_keyframes",
        )
        // RLS also lets a signed-in caller see their own rejected rows, so the
        // accepted filter is stated rather than assumed.
        .eq("accepted", true)
        .eq("resort_id", query.resortId)
        .eq("mode", query.mode)
        .eq("trail_id", query.trailId)
        .eq("physics_version", query.physicsVersion)
        .eq("course_version", query.courseVersion);

      for (const { column, ascending } of query.order) {
        builder = builder.order(column, { ascending });
      }

      const { data, error } = await builder.limit(query.limit);
      if (error) {
        console.error("[drop-in] leaderboard query failed:", error.message);
        return [];
      }

      return (data ?? []).map(
        (row: Record<string, unknown>): LeaderboardRunRow => ({
          id: row.id as string,
          mode: row.mode as CompetitiveRunMode,
          trailId: row.trail_id as string,
          timeMs: row.time_ms as number,
          score: row.score as number,
          physicsVersion: row.physics_version as number,
          courseVersion: row.course_version as number,
          userId: (row.user_id as string | null) ?? null,
          displayName: (row.display_name as string | null) ?? null,
          finishedAt: row.finished_at as string,
          ghostKeyframes: (row.ghost_keyframes as number) ?? 0,
        }),
      );
    },

    async acceptedGhost(runId) {
      const { data, error } = await client
        .from("drop_in_runs")
        .select("ghost_data, ghost_sha256")
        .eq("id", runId)
        .eq("accepted", true)
        .maybeSingle();

      if (error) {
        console.error("[drop-in] ghost fetch failed:", error.message);
        return null;
      }
      if (!data) return null;

      const bytes = fromByteaHex(data.ghost_data);
      if (!bytes) return null;
      const digest = fromByteaHex(data.ghost_sha256);

      return {
        bytes,
        sha256Hex: digest ? Buffer.from(digest).toString("hex") : "",
      };
    },
  };
}
