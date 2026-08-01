/**
 * The Supabase-facing layer: column names, `bytea` round trips, and the
 * unique-violation mapping that turns a replayed ticket into a clean 409.
 *
 * The client here is a hand-rolled chainable stub that records what the
 * repository asked for. It is not a Postgres emulator — it cannot tell us the
 * query is *correct*, only that the repository sends the filters, ordering, and
 * column names it claims to. The CHECK constraints and the `run_nonce` unique
 * index live in migration 015 and are verified when that migration is applied.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { COURSE_VERSION, PHYSICS_VERSION } from "../config/versions";
import { createLeaderboardReader, createRunWriter, type RunInsert } from "./run-repository";
import { fromByteaHex, toByteaHex } from "./supabase-admin";

// ─── bytea ───────────────────────────────────────────────────

test("bytea survives a round trip through PostgREST's hex encoding", () => {
  const bytes = new Uint8Array([0x50, 0x43, 0x47, 0x48, 0x00, 0xff, 0x7f, 0x80]);
  const encoded = toByteaHex(bytes);
  assert.equal(encoded, "\\x5043474800ff7f80");
  assert.deepEqual(fromByteaHex(encoded), bytes);
  assert.deepEqual(fromByteaHex(toByteaHex(new Uint8Array())), new Uint8Array());
});

test("a corrupt bytea value decodes to null instead of throwing", () => {
  assert.equal(fromByteaHex("5043"), null, "missing the \\x prefix");
  assert.equal(fromByteaHex("\\x504"), null, "odd hex length");
  assert.equal(fromByteaHex("\\xzz"), null, "not hex");
  assert.equal(fromByteaHex(null), null);
  assert.equal(fromByteaHex(42), null);
});

// ─── Client stub ─────────────────────────────────────────────

interface StubResult {
  data?: unknown;
  error?: { code?: string; message: string } | null;
}

interface RecordedCall {
  table: string;
  op: "select" | "insert";
  columns?: string;
  row?: Record<string, unknown>;
  filters: Record<string, unknown>;
  orders: Array<{ column: string; ascending: boolean }>;
  limit?: number;
}

function stubClient(results: Record<string, StubResult>) {
  const calls: RecordedCall[] = [];

  const client = {
    from(table: string) {
      const call: RecordedCall = { table, op: "select", filters: {}, orders: [] };
      calls.push(call);

      const settle = () => Promise.resolve(results[`${table}:${call.op}`] ?? { data: null, error: null });

      const builder = {
        select(columns: string) {
          call.columns = columns;
          return builder;
        },
        insert(row: Record<string, unknown>) {
          call.op = "insert";
          call.row = row;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.filters[column] = value;
          return builder;
        },
        order(column: string, options: { ascending: boolean }) {
          call.orders.push({ column, ascending: options.ascending });
          return builder;
        },
        limit(n: number) {
          call.limit = n;
          return settle();
        },
        single: settle,
        maybeSingle: settle,
      };
      return builder;
    },
  };

  return { client: client as unknown as SupabaseClient, calls };
}

function sampleInsert(overrides: Partial<RunInsert> = {}): RunInsert {
  return {
    resortId: "11111111-2222-4333-8444-555555555555",
    userId: null,
    mode: "time_trial",
    trailId: "peak-8",
    timeMs: 29_900,
    score: 42_000,
    physicsVersion: PHYSICS_VERSION,
    courseVersion: COURSE_VERSION,
    ghostVersion: 1,
    tickHz: 10,
    runNonce: "33333333-4444-4555-8666-777777777777",
    ghostData: new Uint8Array([1, 2, 3]),
    ghostSha256: new Uint8Array([4, 5, 6]),
    ghostKeyframes: 300,
    accepted: true,
    rejectionCode: null,
    validationMetrics: {
      keyframes: 300,
      sampleHz: 10,
      ghostSpanMs: 29_900,
      reportedTimeMs: 29_900,
      wallClockMs: 29_900,
      distanceCm: 45_000,
      maxSpeedCms: 3_000,
      maxAccelCms2: 100,
      maxDecelCms2: 0,
      maxStepCm: 294,
      maxAbsCoordCm: 76_000,
      startSpeedCms: 0,
      finishSpeedCms: 3_000,
      startFinishChecked: false,
    },
    startedAt: "2026-07-15T17:29:28.100Z",
    finishedAt: "2026-07-15T17:29:58.000Z",
    ...overrides,
  };
}

// ─── Writer ──────────────────────────────────────────────────

test("an insert maps every field to its migration 015 column", async () => {
  const { client, calls } = stubClient({
    "drop_in_runs:insert": { data: { id: "run-1", created_at: "2026-07-15T17:30:00Z" }, error: null },
  });

  const result = await createRunWriter(client).insertRun(sampleInsert());
  assert.deepEqual(result, { ok: true, id: "run-1", createdAt: "2026-07-15T17:30:00Z" });

  const row = calls[0].row!;
  assert.deepEqual(Object.keys(row).sort(), [
    "accepted",
    "course_version",
    "finished_at",
    "ghost_data",
    "ghost_keyframes",
    "ghost_sha256",
    "ghost_version",
    "mode",
    "physics_version",
    "rejection_code",
    "resort_id",
    "run_nonce",
    "score",
    "started_at",
    "tick_hz",
    "time_ms",
    "trail_id",
    "user_id",
    "validation_metrics",
  ]);
  assert.equal(row.ghost_data, "\\x010203");
  assert.equal(row.ghost_sha256, "\\x040506");
  assert.equal(row.rejection_code, null);
});

test("the run_nonce unique violation is reported as a replay, not a generic error", async () => {
  const { client } = stubClient({
    "drop_in_runs:insert": {
      data: null,
      error: { code: "23505", message: 'duplicate key value violates unique constraint "drop_in_runs_run_nonce_key"' },
    },
  });

  assert.deepEqual(await createRunWriter(client).insertRun(sampleInsert()), {
    ok: false,
    reason: "nonce_replay",
  });
});

test("any other insert failure keeps its message for the server log", async () => {
  const { client } = stubClient({
    "drop_in_runs:insert": { data: null, error: { code: "23514", message: "check constraint" } },
  });

  assert.deepEqual(await createRunWriter(client).insertRun(sampleInsert()), {
    ok: false,
    reason: "error",
    message: "check constraint",
  });
});

test("a resort slug resolves to its uuid, and an unknown slug to null", async () => {
  const found = stubClient({ "resorts:select": { data: { id: "resort-1" }, error: null } });
  assert.equal(await createRunWriter(found.client).resortIdBySlug("breckenridge"), "resort-1");
  assert.deepEqual(found.calls[0].filters, { slug: "breckenridge" });

  const missing = stubClient({ "resorts:select": { data: null, error: null } });
  assert.equal(await createRunWriter(missing.client).resortIdBySlug("nope"), null);
});

// ─── Reader ──────────────────────────────────────────────────

test("the leaderboard query filters on accepted plus the full course tuple", async () => {
  const { client, calls } = stubClient({
    "drop_in_runs:select": {
      data: [
        {
          id: "run-1",
          mode: "time_trial",
          trail_id: "peak-8",
          time_ms: 29_900,
          score: 42_000,
          physics_version: PHYSICS_VERSION,
          course_version: COURSE_VERSION,
          user_id: null,
          finished_at: "2026-07-15T17:29:58Z",
          ghost_keyframes: 300,
        },
      ],
      error: null,
    },
  });

  const rows = await createLeaderboardReader(client).topRuns({
    resortId: "resort-1",
    mode: "time_trial",
    trailId: "peak-8",
    physicsVersion: PHYSICS_VERSION,
    courseVersion: COURSE_VERSION,
    limit: 20,
    order: [
      { column: "time_ms", ascending: true },
      { column: "score", ascending: false },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].timeMs, 29_900);
  assert.equal(rows[0].ghostKeyframes, 300);

  const call = calls[0];
  assert.deepEqual(call.filters, {
    accepted: true,
    resort_id: "resort-1",
    mode: "time_trial",
    trail_id: "peak-8",
    physics_version: PHYSICS_VERSION,
    course_version: COURSE_VERSION,
  });
  assert.deepEqual(call.orders, [
    { column: "time_ms", ascending: true },
    { column: "score", ascending: false },
  ]);
  assert.equal(call.limit, 20);
  // The three columns migration 015 warns about must never be selected.
  for (const forbidden of ["validation_metrics", "run_nonce", "rejection_code", "ghost_data"]) {
    assert.doesNotMatch(call.columns ?? "", new RegExp(forbidden));
  }
});

test("a failed leaderboard query yields an empty board rather than an exception", async () => {
  const { client } = stubClient({
    "drop_in_runs:select": { data: null, error: { message: "connection reset" } },
  });

  const rows = await createLeaderboardReader(client).topRuns({
    resortId: "resort-1",
    mode: "time_trial",
    trailId: "peak-8",
    physicsVersion: PHYSICS_VERSION,
    courseVersion: COURSE_VERSION,
    limit: 20,
    order: [{ column: "time_ms", ascending: true }],
  });

  assert.deepEqual(rows, []);
});

test("a ghost fetch filters on accepted and decodes both bytea columns", async () => {
  const { client, calls } = stubClient({
    "drop_in_runs:select": {
      data: { ghost_data: "\\x504347", ghost_sha256: "\\xabcdef" },
      error: null,
    },
  });

  const ghost = await createLeaderboardReader(client).acceptedGhost("run-1");
  assert.deepEqual(ghost?.bytes, new Uint8Array([0x50, 0x43, 0x47]));
  assert.equal(ghost?.sha256Hex, "abcdef");
  assert.deepEqual(calls[0].filters, { id: "run-1", accepted: true });
});

test("a run with no row, or an unreadable blob, is simply absent", async () => {
  const missing = stubClient({ "drop_in_runs:select": { data: null, error: null } });
  assert.equal(await createLeaderboardReader(missing.client).acceptedGhost("run-1"), null);

  const corrupt = stubClient({
    "drop_in_runs:select": { data: { ghost_data: "not-hex", ghost_sha256: null }, error: null },
  });
  assert.equal(await createLeaderboardReader(corrupt.client).acceptedGhost("run-1"), null);
});
