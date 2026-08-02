/**
 * Round-trips the browser-side run client against the *real* Route Handlers.
 *
 * `fetchImpl` is pointed straight at `handleSubmitRun` / `handleGetLeaderboard`
 * / `handleGetGhost` with the same stubs `handlers/routes.test.ts` uses, so
 * "matches the route contract" is proved by the handler accepting the body this
 * module produces — not by a second copy of the contract written down here.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";

import {
  LEADERBOARD_ENDPOINT,
  MAX_NICKNAME_INPUT_LENGTH,
  RUN_SUBMISSION_ENDPOINT,
  clampNickname,
  fetchGhost,
  fetchLeaderboard,
  ghostEndpoint,
  ghostSampleHz,
  isRunClientFailure,
  MAX_GHOST_SUBMISSION_BYTES,
  resultsOutcome,
  takeRecordingOnce,
  runTimeMsFromSamples,
  submitRun,
  type FinishedRunRecording,
  type LeaderboardBoard,
  type LeaderboardRow,
  type RecordingCache,
  type SubmittableRunSession,
  type SubmittedRun,
} from "./run-client";
// Test-only imports. `run-client.ts` must NOT reach into `lib/game/server/`
// (node:crypto, the ticket secret, the Supabase admin client); the test file is
// never bundled, so it is the right place to prove the hand-mirrored types and
// the request body still match what the server actually accepts.
import { handleSubmitRun, type RunSubmissionResponseBody } from "../server/handlers/runs";
import { handleGetLeaderboard } from "../server/handlers/leaderboard";
import { handleGetGhost } from "../server/handlers/ghosts";
import {
  MAX_GHOST_BYTES,
  type PublicLeaderboard,
  type PublicLeaderboardRow,
} from "../server/run-schema";
import type {
  LeaderboardQuery,
  LeaderboardReader,
  LeaderboardRunRow,
  RunInsert,
  RunInsertResult,
  RunWriter,
} from "../server/run-repository";
import { createSlidingWindowLimiter, type RateLimiter } from "../server/rate-limit";
import {
  FIXTURE_NOW_MS,
  FIXTURE_RESORT_SLUG,
  makeRunFixture,
  makeRunSamples,
  resolveCourseOrThrow,
  testKeyring,
} from "../server/__fixtures__/run";
import { GHOST_TICK_HZ } from "../server/handlers/sessions";
import { GHOST_SAMPLE_HZ } from "../replay/recorder";
import { decodeGhost } from "../replay/codec";
import { COURSE_VERSION, PHYSICS_VERSION } from "../config/versions";
import type { DropInRunSession } from "../../../components/drop-in/DropInGame";
import type { GameRuntime } from "../runtime/GameRuntime";

// ── Compile-time contracts ──────────────────────────────────────────────────
// Mutual assignability, so a server-side shape change is a `tsc` error here
// rather than a field that silently arrives as undefined three screens later.

type Extends<A, B> = A extends B ? true : false;

const _rowMatchesServer: Extends<LeaderboardRow, PublicLeaderboardRow> = true;
const _serverMatchesRow: Extends<PublicLeaderboardRow, LeaderboardRow> = true;
const _boardMatchesServer: Extends<LeaderboardBoard, PublicLeaderboard> = true;
const _serverMatchesBoard: Extends<PublicLeaderboard, LeaderboardBoard> = true;
// `rejectionCode` is deliberately widened to `string` on the client: a code the
// server adds later must render as text rather than fail the whole parse and
// cost the player their placement. Every other field is exact.
const _runMatchesServer: Extends<
  Omit<SubmittedRun, "rejectionCode">,
  Omit<RunSubmissionResponseBody, "rejectionCode">
> = true;
const _serverMatchesRun: Extends<
  Omit<RunSubmissionResponseBody, "rejectionCode">,
  Omit<SubmittedRun, "rejectionCode">
> = true;
const _rejectionCodeIsText: Extends<
  NonNullable<RunSubmissionResponseBody["rejectionCode"]>,
  NonNullable<SubmittedRun["rejectionCode"]>
> = true;
void _rejectionCodeIsText;
// The shell's session object is what A4 is handed; the client's structural
// interface must describe exactly it (no more, no less).
const _sessionMatchesShell: Extends<DropInRunSession, SubmittableRunSession> = true;
const _shellMatchesSession: Extends<SubmittableRunSession, DropInRunSession> = true;
// And the recording is whatever `takeFinishedRun()` hands back.
type RuntimeRecording = NonNullable<ReturnType<GameRuntime["takeFinishedRun"]>>;
const _recordingMatchesRuntime: Extends<RuntimeRecording, FinishedRunRecording> = true;
void _rowMatchesServer;
void _serverMatchesRow;
void _boardMatchesServer;
void _serverMatchesBoard;
void _runMatchesServer;
void _serverMatchesRun;
void _sessionMatchesShell;
void _shellMatchesSession;
void _recordingMatchesRuntime;

// ── Stubs (mirrors of handlers/routes.test.ts) ──────────────────────────────

const ORIGIN = "https://peakcam.io";
const RESORT_UUID = "11111111-2222-4333-8444-555555555555";
const RUN_UUID = "99999999-8888-4777-8666-555555555555";

function stubWriter(result?: RunInsertResult): RunWriter & { inserts: RunInsert[] } {
  const inserts: RunInsert[] = [];
  return {
    inserts,
    async resortIdBySlug() {
      return RESORT_UUID;
    },
    async insertRun(run) {
      inserts.push(run);
      return result ?? { ok: true, id: RUN_UUID, createdAt: new Date(FIXTURE_NOW_MS).toISOString() };
    },
  };
}

function stubReader(
  rows: LeaderboardRunRow[] = [],
  ghost?: { bytes: Uint8Array; sha256Hex: string },
): LeaderboardReader & { queries: LeaderboardQuery[] } {
  const queries: LeaderboardQuery[] = [];
  return {
    queries,
    async resortIdBySlug(slug) {
      return slug === FIXTURE_RESORT_SLUG ? RESORT_UUID : null;
    },
    async topRuns(query) {
      queries.push(query);
      return rows;
    },
    async acceptedGhost() {
      return ghost ?? null;
    },
  };
}

function permissiveLimiter(): RateLimiter {
  return createSlidingWindowLimiter({ limit: 1_000, windowMs: 60_000 });
}

function leaderboardRow(overrides: Partial<LeaderboardRunRow> = {}): LeaderboardRunRow {
  return {
    id: RUN_UUID,
    mode: "time_trial",
    trailId: resolveCourseOrThrow().trailId,
    timeMs: 29_900,
    score: 42_000,
    physicsVersion: PHYSICS_VERSION,
    courseVersion: COURSE_VERSION,
    userId: null,
    displayName: "Powder Hound",
    finishedAt: "2026-07-15T17:29:58.000Z",
    ghostKeyframes: 300,
    ...overrides,
  };
}

/** A `fetch` that runs the real submission handler against stub dependencies. */
function submissionFetch(options: {
  writer?: RunWriter;
  userId?: string | null;
  seen?: { body?: unknown; init?: RequestInit; url?: string };
} = {}): typeof fetch {
  const writer = options.writer ?? stubWriter();
  return (async (url: string, init: RequestInit) => {
    if (options.seen) {
      options.seen.url = url;
      options.seen.init = init;
      options.seen.body = JSON.parse(String(init.body));
    }
    const request = new Request(`${ORIGIN}${url}`, init as RequestInit & { duplex?: string });
    return handleSubmitRun(request, {
      keyring: () => testKeyring(),
      currentUserId: async () => options.userId ?? null,
      writer: () => writer,
      limiter: permissiveLimiter(),
      now: () => FIXTURE_NOW_MS,
    });
  }) as unknown as typeof fetch;
}

function leaderboardFetch(reader: LeaderboardReader, userId: string | null = null): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const request = new Request(`${ORIGIN}${url}`, init);
    return handleGetLeaderboard(request, { reader: () => reader, currentUserId: async () => userId });
  }) as unknown as typeof fetch;
}

function ghostFetch(reader: LeaderboardReader): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const runId = url.split("/").pop() ?? "";
    const request = new Request(`${ORIGIN}${url}`, init);
    return handleGetGhost(request, decodeURIComponent(runId), { reader: () => reader });
  }) as unknown as typeof fetch;
}

// ── Session + recording doubles ─────────────────────────────────────────────

function makeSession(
  ticket: SubmittableRunSession["ticket"],
  overrides: Partial<SubmittableRunSession> = {},
): SubmittableRunSession & { submittedCount: number } {
  const session = {
    mode: "time_trial" as const,
    trailId: resolveCourseOrThrow().trailId,
    ticket,
    offline: ticket === null,
    submittedCount: 0,
    markSubmitted() {
      session.submittedCount += 1;
    },
    ...overrides,
  };
  return session;
}

/** The fixture run, shaped the way `GameRuntime.takeFinishedRun()` hands it over. */
function fixtureRun() {
  const fixture = makeRunFixture();
  const recording: FinishedRunRecording = {
    samples: fixture.samples,
    encoded: fixture.ghostBytes,
  };
  const session = makeSession({
    ticket: fixture.ticket,
    seed: fixture.seed,
    resortSlug: FIXTURE_RESORT_SLUG,
    mode: "time_trial",
    trailId: fixture.course.trailId,
    physicsVersion: PHYSICS_VERSION,
    courseVersion: COURSE_VERSION,
    tickHz: fixture.submission.tickHz,
    expiresAt: new Date(FIXTURE_NOW_MS + 60_000).toISOString(),
  });
  return { fixture, recording, session };
}

// ── submitRun ───────────────────────────────────────────────────────────────

test("submitRun is the spend owner: no ticket, no request, no markSubmitted", async () => {
  const { recording } = fixtureRun();
  const session = makeSession(null);
  let called = false;
  const outcome = await submitRun(session, recording, {
    score: 42_000,
    fetchImpl: (async () => {
      called = true;
      return new Response(null, { status: 500 });
    }) as unknown as typeof fetch,
  });

  assert.equal(outcome.status, "skipped");
  assert.equal(called, false, "an unticketed run must not reach the network");
  assert.equal(session.submittedCount, 0);
});

test("a recorded run is accepted by the real submission handler", async () => {
  const { recording, session } = fixtureRun();
  const writer = stubWriter();
  const outcome = await submitRun(session, recording, {
    score: 42_000,
    finishedAtMs: FIXTURE_NOW_MS,
    fetchImpl: submissionFetch({ writer }),
  });

  assert.equal(outcome.status, "submitted", JSON.stringify(outcome));
  assert.ok(outcome.status === "submitted");
  assert.equal(outcome.run.accepted, true, `rejected: ${outcome.run.rejectionCode}`);
  assert.equal(outcome.run.runId, RUN_UUID);
  assert.equal(outcome.run.mode, "time_trial");
  assert.equal(session.submittedCount, 1, "the ticket is spent exactly once");
  assert.equal(writer.inserts.length, 1);
});

test("the request body carries exactly the fields the runs schema accepts", async () => {
  const { fixture, recording, session } = fixtureRun();
  const seen: { body?: unknown; init?: RequestInit; url?: string } = {};
  await submitRun(session, recording, {
    score: 42_000,
    finishedAtMs: FIXTURE_NOW_MS,
    nickname: "  Powder Hound  ",
    fetchImpl: submissionFetch({ seen }),
  });

  assert.equal(seen.url, RUN_SUBMISSION_ENDPOINT);
  assert.equal(seen.init?.method, "POST");
  assert.equal(seen.init?.cache, "no-store");
  const body = seen.body as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(body).sort(),
    ["finishedAt", "ghost", "nickname", "score", "startedAt", "tickHz", "timeMs", "ticket"].sort(),
  );
  assert.equal(body.ticket, fixture.ticket);
  assert.equal(body.tickHz, fixture.submission.tickHz);
  assert.equal(body.score, 42_000);
  assert.equal(body.nickname, "Powder Hound", "the nickname is trimmed before it is sent");
  // The ghost rides as standard base64 of the recorder's own bytes.
  assert.deepEqual(
    new Uint8Array(Buffer.from(String(body.ghost), "base64")),
    fixture.ghostBytes,
  );
  // Time comes from the ghost's tick span, not from a HUD readout — the
  // validator compares the two and rejects a mismatch.
  assert.equal(body.timeMs, fixture.submission.timeMs);
  assert.equal(body.timeMs, runTimeMsFromSamples(recording.samples));
  assert.equal(
    Date.parse(String(body.finishedAt)) - Date.parse(String(body.startedAt)),
    body.timeMs,
  );
  assert.equal(new Date(String(body.finishedAt)).toISOString(), String(body.finishedAt));
});

test("tickHz follows the recorder, not the ticket the sessions route advertises", async () => {
  // Production drift, and the reason this test exists: `GHOST_TICK_HZ` in
  // lib/game/server/handlers/sessions.ts says 10, while `GHOST_SAMPLE_HZ` in
  // lib/game/replay/recorder.ts records at 30 and the runtime encodes that into
  // the PCGH header. The validator compares the header against the *submitted*
  // tickHz, so echoing the ticket's figure would fail every real run with
  // `tick_hz_mismatch`. The ghost's own rate is the only correct source.
  const fixture = makeRunFixture({
    ghostMeta: { sampleHz: GHOST_SAMPLE_HZ },
    mutateSamples: () =>
      makeRunSamples({ count: 30 * GHOST_SAMPLE_HZ, sampleHz: GHOST_SAMPLE_HZ }),
  });
  const session = makeSession({
    ticket: fixture.ticket,
    seed: fixture.seed,
    resortSlug: FIXTURE_RESORT_SLUG,
    mode: "time_trial",
    trailId: fixture.course.trailId,
    physicsVersion: PHYSICS_VERSION,
    courseVersion: COURSE_VERSION,
    // What the live sessions route actually hands out.
    tickHz: GHOST_TICK_HZ,
    expiresAt: new Date(FIXTURE_NOW_MS + 60_000).toISOString(),
  });
  const seen: { body?: unknown } = {};
  const outcome = await submitRun(
    session,
    { samples: fixture.samples, encoded: fixture.ghostBytes },
    { score: 42_000, finishedAtMs: FIXTURE_NOW_MS, fetchImpl: submissionFetch({ seen }) },
  );

  assert.equal((seen.body as Record<string, unknown>).tickHz, GHOST_SAMPLE_HZ);
  assert.ok(outcome.status === "submitted", JSON.stringify(outcome));
  assert.equal(outcome.run.accepted, true, `rejected: ${outcome.run.rejectionCode}`);
});

test("ghostSampleHz reads the same rate decodeGhost does, at either recorder rate", () => {
  for (const hz of [10, GHOST_SAMPLE_HZ]) {
    const fixture = makeRunFixture({
      ghostMeta: { sampleHz: hz },
      mutateSamples: () => makeRunSamples({ count: 30 * hz, sampleHz: hz }),
    });
    assert.equal(ghostSampleHz(fixture.ghostBytes), decodeGhost(fixture.ghostBytes).meta.sampleHz);
    assert.equal(ghostSampleHz(fixture.ghostBytes), hz);
  }
  // A buffer too short to hold a header has no rate to report; the submission
  // schema's 10..240 bound then rejects it before it can be mis-declared.
  assert.equal(ghostSampleHz(new Uint8Array(4)), 0);
});

test("a blank nickname is omitted rather than sent empty", async () => {
  const { recording, session } = fixtureRun();
  const seen: { body?: unknown } = {};
  await submitRun(session, recording, {
    score: 1,
    finishedAtMs: FIXTURE_NOW_MS,
    nickname: "   ",
    fetchImpl: submissionFetch({ seen }),
  });
  assert.equal("nickname" in (seen.body as Record<string, unknown>), false);
});

test("a server rejection is reported without spending the ticket", async () => {
  const { recording, session } = fixtureRun();
  const outcome = await submitRun(session, recording, {
    score: 42_000,
    finishedAtMs: FIXTURE_NOW_MS,
    fetchImpl: submissionFetch({
      writer: stubWriter({ ok: false, reason: "nonce_replay" }),
    }),
  });

  assert.equal(outcome.status, "failed");
  assert.ok(outcome.status === "failed");
  assert.match(outcome.error, /already been submitted/i);
  assert.equal(session.submittedCount, 0, "only a 2xx spends the ticket");
});

test("a validated rejection is still a submission, with its rejection code", async () => {
  const fixture = makeRunFixture({
    // A finish-line gate the run never reaches: baseline validation rejects it,
    // the handler still stores it and answers 201.
    mutateSamples: (samples) => samples.map((s) => ({ ...s, speedCms: 19_000 })),
  });
  const session = makeSession({
    ticket: fixture.ticket,
    seed: fixture.seed,
    resortSlug: FIXTURE_RESORT_SLUG,
    mode: "time_trial",
    trailId: fixture.course.trailId,
    physicsVersion: PHYSICS_VERSION,
    courseVersion: COURSE_VERSION,
    tickHz: fixture.submission.tickHz,
    expiresAt: new Date(FIXTURE_NOW_MS + 60_000).toISOString(),
  });
  const outcome = await submitRun(
    session,
    { samples: fixture.samples, encoded: fixture.ghostBytes },
    { score: 42_000, finishedAtMs: FIXTURE_NOW_MS, fetchImpl: submissionFetch() },
  );

  assert.ok(outcome.status === "submitted", JSON.stringify(outcome));
  assert.equal(outcome.run.accepted, false);
  assert.ok(outcome.run.rejectionCode, "a rejected run carries a coarse code");
  assert.equal(session.submittedCount, 1, "the nonce is spent server-side either way");
});

test("a network failure comes back as an error, never as a throw", async () => {
  const { recording, session } = fixtureRun();
  const outcome = await submitRun(session, recording, {
    score: 1,
    fetchImpl: (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch,
  });
  assert.equal(outcome.status, "failed");
  assert.ok(outcome.status === "failed" && /failed to fetch/i.test(outcome.error));
  assert.equal(session.submittedCount, 0);
});

test("a run too short to submit is skipped before it reaches the network", async () => {
  const { session } = fixtureRun();
  let called = false;
  const outcome = await submitRun(
    session,
    { samples: [{ tick: 0, xCm: 0, zCm: 0, groundOffsetCm: 0, yaw: 0, speedCms: 0, poseFlags: 0 }], encoded: new Uint8Array(34) },
    {
      score: 0,
      fetchImpl: (async () => {
        called = true;
        return new Response(null, { status: 500 });
      }) as unknown as typeof fetch,
    },
  );
  assert.equal(outcome.status, "skipped");
  assert.equal(called, false);
  assert.equal(session.submittedCount, 0);
});

// ── fetchLeaderboard ────────────────────────────────────────────────────────

test("fetchLeaderboard parses the real handler's board", async () => {
  const course = resolveCourseOrThrow();
  const reader = stubReader([leaderboardRow(), leaderboardRow({ id: "22222222-3333-4444-8555-666666666666", timeMs: 31_000 })]);
  const result = await fetchLeaderboard(
    { resortSlug: FIXTURE_RESORT_SLUG, courseId: course.trailId, mode: "time_trial" },
    { fetchImpl: leaderboardFetch(reader) },
  );

  assert.ok(!isRunClientFailure(result), JSON.stringify(result));
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].rank, 1);
  assert.equal(result.rows[0].displayName, "Powder Hound");
  assert.equal(result.rows[0].hasGhost, true);
  assert.equal(result.mode, "time_trial");
  assert.equal(reader.queries[0].limit, 20, "the panel asks for a top-20 board");
});

test("fetchLeaderboard sends the query the leaderboard route expects", async () => {
  const course = resolveCourseOrThrow();
  let seen = "";
  let seenInit: RequestInit | undefined;
  await fetchLeaderboard(
    { resortSlug: FIXTURE_RESORT_SLUG, courseId: course.trailId, mode: "score_attack" },
    {
      fetchImpl: (async (url: string, init?: RequestInit) => {
        seen = url;
        seenInit = init;
        return leaderboardFetch(stubReader())(url);
      }) as unknown as typeof fetch,
    },
  );
  // The board is re-read right after a submission; a cached copy would be
  // missing exactly the row the player is looking for.
  assert.equal(seenInit?.cache, "no-store");
  const query = new URL(`${ORIGIN}${seen}`);
  assert.equal(query.pathname, LEADERBOARD_ENDPOINT);
  assert.equal(query.searchParams.get("resort"), FIXTURE_RESORT_SLUG);
  assert.equal(query.searchParams.get("mode"), "score_attack");
  assert.equal(query.searchParams.get("trailId"), course.trailId);
  assert.equal(query.searchParams.get("limit"), "20");
});

test("an unknown course is a failure, not a throw", async () => {
  const result = await fetchLeaderboard(
    { resortSlug: "not-a-resort", courseId: "nope", mode: "time_trial" },
    { fetchImpl: leaderboardFetch(stubReader()) },
  );
  assert.ok(isRunClientFailure(result));
  assert.match(result.error, /unknown resort or trail/i);
});

test("a body that is not a board is a failure, not a crash", async () => {
  const result = await fetchLeaderboard(
    { resortSlug: FIXTURE_RESORT_SLUG, courseId: "x", mode: "time_trial" },
    { fetchImpl: (async () => Response.json({ rows: "nope" })) as unknown as typeof fetch },
  );
  assert.ok(isRunClientFailure(result));
});

// ── fetchGhost ──────────────────────────────────────────────────────────────

test("fetchGhost decodes the bytes the ghost route serves", async () => {
  const fixture = makeRunFixture();
  const reader = stubReader([], {
    bytes: fixture.ghostBytes,
    sha256Hex: createHash("sha256").update(fixture.ghostBytes).digest("hex"),
  });
  const result = await fetchGhost(RUN_UUID, { fetchImpl: ghostFetch(reader) });

  assert.ok(!isRunClientFailure(result), JSON.stringify(result));
  assert.equal(result.samples.length, fixture.samples.length);
  assert.equal(result.meta.seed, fixture.seed);
  assert.equal(ghostEndpoint(RUN_UUID), `/api/drop-in/ghosts/${RUN_UUID}`);
});

test("a missing ghost is a failure the panel can render", async () => {
  const result = await fetchGhost(RUN_UUID, { fetchImpl: ghostFetch(stubReader()) });
  assert.ok(isRunClientFailure(result));
  assert.match(result.error, /not found/i);
});

test("undecodable ghost bytes fail closed", async () => {
  const result = await fetchGhost(RUN_UUID, {
    fetchImpl: (async () => new Response(new Uint8Array([1, 2, 3])) ) as unknown as typeof fetch,
  });
  assert.ok(isRunClientFailure(result));
});

test("a ghost over the submission byte budget is skipped before the network", async () => {
  const { session } = fixtureRun();
  // Legal PCGH bytes are irrelevant here: the budget is checked on length, and
  // sending 129 KB could only ever earn a 413 while spending the ticket.
  const oversized = makeRunFixture();
  let called = false;
  const outcome = await submitRun(
    session,
    {
      samples: oversized.samples,
      encoded: new Uint8Array(MAX_GHOST_SUBMISSION_BYTES + 1),
    },
    {
      score: 1,
      finishedAtMs: FIXTURE_NOW_MS,
      fetchImpl: (async () => {
        called = true;
        return new Response(null, { status: 413 });
      }) as unknown as typeof fetch,
    },
  );
  assert.ok(outcome.status === "skipped" && outcome.reason === "unrecordable");
  assert.equal(called, false);
  assert.equal(session.submittedCount, 0);
});

test("the client's ghost byte budget is the server's", () => {
  assert.equal(MAX_GHOST_SUBMISSION_BYTES, MAX_GHOST_BYTES);
  const _budgetsAgree: Extends<typeof MAX_GHOST_SUBMISSION_BYTES, typeof MAX_GHOST_BYTES> = true;
  void _budgetsAgree;
});

// ── idempotent recording take ───────────────────────────────────────────────

test("takeRecordingOnce consumes the runtime's recording exactly once", () => {
  // `GameRuntime.takeFinishedRun()` is a consuming read: the second call
  // returns null. React StrictMode double-invokes effects, so without this
  // wrapper a dev-mode results screen takes the run, throws it away, and then
  // renders "Played offline" for a run that was perfectly submittable.
  const recording: FinishedRunRecording = { samples: [], encoded: new Uint8Array(0) };
  let calls = 0;
  const take = () => {
    calls += 1;
    return calls === 1 ? recording : null;
  };
  const cache: RecordingCache = { current: undefined };

  assert.equal(takeRecordingOnce(take, cache), recording);
  assert.equal(takeRecordingOnce(take, cache), recording, "a second take is the cached one");
  assert.equal(takeRecordingOnce(take, cache), recording);
  assert.equal(calls, 1, "the runtime is asked exactly once");
});

test("takeRecordingOnce caches a genuine absence too, and resets for the next run", () => {
  let calls = 0;
  const take = () => {
    calls += 1;
    return null;
  };
  const cache: RecordingCache = { current: undefined };

  assert.equal(takeRecordingOnce(take, cache), null);
  assert.equal(takeRecordingOnce(take, cache), null);
  assert.equal(calls, 1, "null is an answer, not a reason to ask again");

  // What the dialog does when it closes: the next results screen is a new run.
  cache.current = undefined;
  assert.equal(takeRecordingOnce(take, cache), null);
  assert.equal(calls, 2);
});

// ── results outcome ─────────────────────────────────────────────────────────

test("Free Ski has no leaderboard outcome at all", () => {
  assert.equal(
    resultsOutcome({ competitive: false, offlineAtOpen: false, hasRecording: true, submitted: false }),
    "free_ski",
  );
});

test("a ticketed run with a recording is submittable", () => {
  assert.equal(
    resultsOutcome({ competitive: true, offlineAtOpen: false, hasRecording: true, submitted: false }),
    "submittable",
  );
});

test("a downgraded session, or a run with no recording, reads offline", () => {
  assert.equal(
    resultsOutcome({ competitive: true, offlineAtOpen: true, hasRecording: true, submitted: false }),
    "offline",
  );
  assert.equal(
    resultsOutcome({ competitive: true, offlineAtOpen: false, hasRecording: false, submitted: false }),
    "offline",
  );
});

test("a submitted run stays 'submitted' even though the session now reads offline", () => {
  // markSubmitted() clears the frozen ticket, so `session.offline` flips back to
  // true. The held response, not the session, is what the dialog renders.
  assert.equal(
    resultsOutcome({ competitive: true, offlineAtOpen: true, hasRecording: true, submitted: true }),
    "submitted",
  );
});

// ── nickname ────────────────────────────────────────────────────────────────

test("clampNickname trims and bounds the input the server will re-sanitise", () => {
  assert.equal(clampNickname("  Yuki  "), "Yuki");
  assert.equal(clampNickname("x".repeat(80)).length, MAX_NICKNAME_INPUT_LENGTH);
  assert.equal(clampNickname("   "), "");
});
