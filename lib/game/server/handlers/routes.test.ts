/**
 * Route Handler behaviour, exercised by calling the handlers directly with
 * hand-rolled stubs — no Next.js runtime, no database, no env.
 *
 * The handlers take their dependencies as an argument precisely so this file
 * can exist: the alternative is mocking module resolution to intercept a
 * Supabase client built inside the handler, which tests the mock more than the
 * code. Nothing here touches a real Supabase project.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";

import { COURSE_VERSION, PHYSICS_VERSION } from "../../config/versions";
import { encodeGhost } from "../../replay/codec";
import { createSlidingWindowLimiter, type RateLimiter } from "../rate-limit";
import { verifyTicket } from "../run-ticket";
import type {
  LeaderboardQuery,
  LeaderboardReader,
  LeaderboardRunRow,
  RunInsert,
  RunInsertResult,
  RunWriter,
} from "../run-repository";
import {
  FIXTURE_RESORT_SLUG,
  FOREIGN_TICKET_KEYS,
  makeRunFixture,
  resolveCourseOrThrow,
  testKeyring,
} from "../__fixtures__/run";
import { GHOST_SAMPLE_HZ } from "../../replay/recorder";
import { GHOST_TICK_HZ, handleCreateSession } from "./sessions";
import { handleSubmitRun } from "./runs";
import { handleGetLeaderboard } from "./leaderboard";
import { handleGetGhost } from "./ghosts";

const RESORT_UUID = "11111111-2222-4333-8444-555555555555";
const RUN_UUID = "99999999-8888-4777-8666-555555555555";
const USER_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

// ─── Stubs ───────────────────────────────────────────────────

interface WriterStub extends RunWriter {
  readonly inserts: RunInsert[];
}

function stubWriter(
  result: RunInsertResult = { ok: true, id: RUN_UUID, createdAt: new Date().toISOString() },
  resortId: string | null = RESORT_UUID,
): WriterStub {
  const inserts: RunInsert[] = [];
  return {
    inserts,
    async resortIdBySlug() {
      return resortId;
    },
    async insertRun(run) {
      inserts.push(run);
      return result;
    },
  };
}

interface ReaderStub extends LeaderboardReader {
  readonly queries: LeaderboardQuery[];
}

function stubReader(rows: LeaderboardRunRow[] = [], ghost?: { bytes: Uint8Array; sha256Hex: string }): ReaderStub {
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

function postRequest(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
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

// ─── POST /api/drop-in/sessions ──────────────────────────────

test("the advertised keyframe rate is the rate the recorder actually samples at", () => {
  // One constant, two audiences: the sessions payload tells the client what to
  // record at, and `validateRun` compares the PCGH header against the submitted
  // tickHz. If this ever splits again, every honest run fails tick_hz_mismatch.
  assert.equal(GHOST_TICK_HZ, GHOST_SAMPLE_HZ);
});

const sessionUrl = "https://peakcam.io/api/drop-in/sessions";

test("a session request mints a ticket the server can verify", async () => {
  const keyring = testKeyring();
  const now = Date.UTC(2026, 6, 15, 17, 0, 0);
  const trailId = resolveCourseOrThrow().trailId;

  const response = await handleCreateSession(
    postRequest(sessionUrl, { resortSlug: FIXTURE_RESORT_SLUG, mode: "time_trial", trailId }),
    { keyring: () => keyring, currentUserId: async () => null, limiter: permissiveLimiter(), now: () => now },
  );

  assert.equal(response.status, 201);
  assert.equal(response.headers.get("Cache-Control"), "no-store");

  const body = await response.json();
  assert.equal(body.resortSlug, FIXTURE_RESORT_SLUG);
  assert.equal(body.trailId, trailId);
  assert.equal(body.physicsVersion, PHYSICS_VERSION);
  assert.equal(body.courseVersion, COURSE_VERSION);
  // The rate the client must record at. Bound to the recorder's own constant,
  // not written out again: this field is the public half of a contract the
  // validator enforces, and a literal here let it drift to 10 while the
  // recorder sampled at 30 (see GHOST_TICK_HZ in ./sessions.ts).
  assert.equal(body.tickHz, GHOST_SAMPLE_HZ);

  const payload = verifyTicket(body.ticket, keyring, { now });
  assert.equal(payload.seed, body.seed, "the ticket must bind the seed it advertised");
  assert.equal(payload.trailId, trailId);
  assert.equal(payload.userId, undefined, "an anonymous session binds no user");
  assert.equal(payload.exp - payload.iat, 30 * 60 * 1000);
  assert.equal(new Date(body.expiresAt).getTime(), payload.exp);
});

test("the seed is chosen server-side and ignores anything the client sends", async () => {
  const keyring = testKeyring();
  const now = Date.UTC(2026, 6, 15, 17, 0, 0);
  const trailId = resolveCourseOrThrow().trailId;

  const response = await handleCreateSession(
    postRequest(sessionUrl, {
      resortSlug: FIXTURE_RESORT_SLUG,
      mode: "time_trial",
      trailId,
      seed: 7,
    }),
    { keyring: () => keyring, currentUserId: async () => null, limiter: permissiveLimiter(), now: () => now },
  );

  // `.strict()` on the schema: an unexpected field is a 400, not a silent drop.
  assert.equal(response.status, 400);
});

test("a signed-in session binds the user id into the ticket", async () => {
  const keyring = testKeyring();
  const now = Date.UTC(2026, 6, 15, 17, 0, 0);

  const response = await handleCreateSession(
    postRequest(sessionUrl, {
      resortSlug: FIXTURE_RESORT_SLUG,
      mode: "score_attack",
      trailId: resolveCourseOrThrow().trailId,
    }),
    {
      keyring: () => keyring,
      currentUserId: async () => USER_UUID,
      limiter: permissiveLimiter(),
      now: () => now,
    },
  );

  const body = await response.json();
  assert.equal(verifyTicket(body.ticket, keyring, { now }).userId, USER_UUID);
});

test("an unknown trail gets no ticket", async () => {
  const response = await handleCreateSession(
    postRequest(sessionUrl, {
      resortSlug: FIXTURE_RESORT_SLUG,
      mode: "time_trial",
      trailId: "a-trail-that-does-not-exist",
    }),
    {
      keyring: () => testKeyring(),
      currentUserId: async () => null,
      limiter: permissiveLimiter(),
      now: () => Date.now(),
    },
  );

  assert.equal(response.status, 404);
});

test("a rate-limited session request answers 429 with Retry-After", async () => {
  const limiter = createSlidingWindowLimiter({ limit: 1, windowMs: 60_000 });
  const deps = {
    keyring: () => testKeyring(),
    currentUserId: async () => null,
    limiter,
    now: () => 1_000,
  };
  const body = {
    resortSlug: FIXTURE_RESORT_SLUG,
    mode: "time_trial" as const,
    trailId: resolveCourseOrThrow().trailId,
  };

  const first = await handleCreateSession(
    postRequest(sessionUrl, body, { "x-forwarded-for": "203.0.113.7" }),
    deps,
  );
  const second = await handleCreateSession(
    postRequest(sessionUrl, body, { "x-forwarded-for": "203.0.113.7" }),
    deps,
  );

  assert.equal(first.status, 201);
  assert.equal(second.status, 429);
  assert.ok(Number(second.headers.get("Retry-After")) >= 1);
});

test("a missing signing key is a 500, not a 400 blaming the client", async () => {
  const response = await handleCreateSession(
    postRequest(sessionUrl, {
      resortSlug: FIXTURE_RESORT_SLUG,
      mode: "time_trial",
      trailId: resolveCourseOrThrow().trailId,
    }),
    {
      keyring: () => {
        throw new Error("DROP_IN_TICKET_KEYS is empty");
      },
      currentUserId: async () => null,
      limiter: permissiveLimiter(),
      now: () => Date.now(),
    },
  );

  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /DROP_IN_TICKET_KEYS/, "never echo config detail");
});

// ─── POST /api/drop-in/runs ──────────────────────────────────

const runsUrl = "https://peakcam.io/api/drop-in/runs";

function submissionBody(fixture: ReturnType<typeof makeRunFixture>) {
  return {
    ticket: fixture.ticket,
    ghost: fixture.ghostBase64,
    ...fixture.submission,
  };
}

function runDeps(writer: RunWriter, now: number, userId: string | null = null) {
  return {
    keyring: () => testKeyring(),
    currentUserId: async () => userId,
    writer: () => writer,
    limiter: permissiveLimiter(),
    now: () => now,
  };
}

test("a good run is stored as accepted and echoed back without private fields", async () => {
  const fixture = makeRunFixture();
  const writer = stubWriter();

  const response = await handleSubmitRun(
    postRequest(runsUrl, submissionBody(fixture)),
    runDeps(writer, fixture.nowMs),
  );

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.accepted, true);
  assert.equal(body.runId, RUN_UUID);
  assert.equal(body.rejectionCode, undefined);
  assert.deepEqual(Object.keys(body).sort(), [
    "accepted",
    "courseVersion",
    "displayName",
    "mode",
    "physicsVersion",
    "runId",
    "score",
    "timeMs",
    "trailId",
  ]);

  assert.equal(writer.inserts.length, 1);
  const row = writer.inserts[0];
  assert.equal(row.accepted, true);
  assert.equal(row.rejectionCode, null);
  assert.equal(row.resortId, RESORT_UUID);
  assert.equal(row.ghostKeyframes, 300);
  assert.equal(row.tickHz, 10);
  assert.deepEqual(row.ghostData, fixture.ghostBytes);
  assert.deepEqual(
    Buffer.from(row.ghostSha256).toString("hex"),
    createHash("sha256").update(fixture.ghostBytes).digest("hex"),
  );
  assert.equal(row.runNonce, verifyTicket(fixture.ticket, fixture.keyring, { now: fixture.nowMs }).nonce);
});

test("a nickname is sanitised before it is stored, and echoed back as stored", async () => {
  const fixture = makeRunFixture();
  const writer = stubWriter();

  const response = await handleSubmitRun(
    postRequest(runsUrl, { ...submissionBody(fixture), nickname: "  Powder\u200b   Hound  " }),
    runDeps(writer, fixture.nowMs),
  );

  assert.equal(writer.inserts[0].displayName, "Powder Hound");
  assert.equal(
    (await response.json()).displayName,
    "Powder Hound",
    "the client must render the name others will see, not the one it typed",
  );
});

test("no nickname, signed in or not, stores null rather than an invented name", async () => {
  const anonymous = makeRunFixture();
  const anonWriter = stubWriter();
  await handleSubmitRun(
    postRequest(runsUrl, submissionBody(anonymous)),
    runDeps(anonWriter, anonymous.nowMs),
  );
  assert.equal(anonWriter.inserts[0].displayName, null);

  // Profile names are not wired up yet: a signed-in player without a nickname
  // is still nameless on the board.
  const signedIn = makeRunFixture({ userId: USER_UUID });
  const userWriter = stubWriter();
  await handleSubmitRun(
    postRequest(runsUrl, submissionBody(signedIn)),
    runDeps(userWriter, signedIn.nowMs, USER_UUID),
  );
  assert.equal(userWriter.inserts[0].displayName, null);
  assert.equal(userWriter.inserts[0].userId, USER_UUID);
});

test("a nickname of nothing but invisible characters stores null", async () => {
  const fixture = makeRunFixture();
  const writer = stubWriter();

  const response = await handleSubmitRun(
    postRequest(runsUrl, { ...submissionBody(fixture), nickname: "\u200b\u200b\u200b" }),
    runDeps(writer, fixture.nowMs),
  );

  assert.equal(response.status, 201, "an unusable nickname costs the player a name, not the run");
  assert.equal(writer.inserts[0].displayName, null);
});

test("a rejected run is still stored, with its code, and reported as not accepted", async () => {
  const fixture = makeRunFixture({
    mutateSamples: (samples) => samples.map((s, i) => (i >= 150 ? { ...s, zCm: s.zCm + 60_000 } : s)),
  });
  const writer = stubWriter();

  const response = await handleSubmitRun(
    postRequest(runsUrl, submissionBody(fixture)),
    runDeps(writer, fixture.nowMs),
  );

  assert.equal(response.status, 201, "a well-formed submission is processed even when it fails validation");
  const body = await response.json();
  assert.equal(body.accepted, false);
  assert.equal(body.rejectionCode, "teleport");

  const row = writer.inserts[0];
  assert.equal(row.accepted, false);
  assert.equal(row.rejectionCode, "teleport");
  assert.ok(row.validationMetrics.maxStepCm > 0, "telemetry is retained for anti-cheat");
});

test("the client is never told how close it came to a bound", async () => {
  const fixture = makeRunFixture({
    mutateSamples: (samples) => samples.map((s, i) => (i >= 200 ? { ...s, speedCms: 15_000 } : s)),
  });

  const response = await handleSubmitRun(
    postRequest(runsUrl, submissionBody(fixture)),
    runDeps(stubWriter(), fixture.nowMs),
  );

  const text = await response.text();
  assert.match(text, /overspeed/);
  assert.doesNotMatch(text, /15000|cm\/s|maxSpeed/, "no metrics in the response body");
});

test("a ticket signed with an unknown secret is rejected before anything is stored", async () => {
  const fixture = makeRunFixture({ keyring: testKeyring(FOREIGN_TICKET_KEYS) });
  const writer = stubWriter();

  const response = await handleSubmitRun(
    postRequest(runsUrl, submissionBody(fixture)),
    runDeps(writer, fixture.nowMs),
  );

  assert.equal(response.status, 401);
  assert.equal((await response.json()).rejectionCode, "ticket_bad_sig");
  assert.equal(writer.inserts.length, 0);
});

test("an expired ticket is 410 — start a new session, not a cheating accusation", async () => {
  const fixture = makeRunFixture({ ticketTtlMs: 60_000 });

  const response = await handleSubmitRun(
    postRequest(runsUrl, submissionBody(fixture)),
    runDeps(stubWriter(), fixture.nowMs + 120_000),
  );

  assert.equal(response.status, 410);
  assert.equal((await response.json()).rejectionCode, "ticket_expired");
});

test("a ticket issued to another account cannot be spent", async () => {
  const fixture = makeRunFixture({ userId: USER_UUID });
  const writer = stubWriter();

  const response = await handleSubmitRun(
    postRequest(runsUrl, submissionBody(fixture)),
    runDeps(writer, fixture.nowMs, "ffffffff-0000-4000-8000-000000000000"),
  );

  assert.equal(response.status, 401);
  assert.equal((await response.json()).rejectionCode, "ticket_user_mismatch");
  assert.equal(writer.inserts.length, 0);
});

test("a replayed nonce surfaces as 409 when the unique constraint fires", async () => {
  const fixture = makeRunFixture();
  const writer = stubWriter({ ok: false, reason: "nonce_replay" });

  const response = await handleSubmitRun(
    postRequest(runsUrl, submissionBody(fixture)),
    runDeps(writer, fixture.nowMs),
  );

  assert.equal(response.status, 409);
  assert.equal((await response.json()).rejectionCode, "nonce_replay");
});

test("a ghost that will not decode is 422 and is never stored", async () => {
  const fixture = makeRunFixture();
  const writer = stubWriter();

  const response = await handleSubmitRun(
    postRequest(runsUrl, {
      ...submissionBody(fixture),
      ghost: Buffer.alloc(64, 7).toString("base64"),
    }),
    runDeps(writer, fixture.nowMs),
  );

  assert.equal(response.status, 422);
  assert.equal((await response.json()).rejectionCode, "ghost_bad_magic");
  assert.equal(writer.inserts.length, 0);
});

test("a run whose keyframe count cannot satisfy the table CHECK is 422, not a 500", async () => {
  const fixture = makeRunFixture();
  const single = encodeGhost([fixture.samples[0]], {
    physicsVersion: PHYSICS_VERSION,
    courseVersion: COURSE_VERSION,
    sampleHz: 10,
    seed: fixture.seed,
  });
  const writer = stubWriter();

  const response = await handleSubmitRun(
    postRequest(runsUrl, {
      ...submissionBody(fixture),
      ghost: Buffer.from(single).toString("base64"),
      timeMs: 1_000,
    }),
    runDeps(writer, fixture.nowMs),
  );

  assert.equal(response.status, 422);
  assert.equal((await response.json()).rejectionCode, "keyframe_count");
  assert.equal(writer.inserts.length, 0);
});

test("an oversized body is refused before it is parsed", async () => {
  const fixture = makeRunFixture();
  const response = await handleSubmitRun(
    postRequest(runsUrl, { ...submissionBody(fixture), nickname: "x".repeat(200_000) }),
    runDeps(stubWriter(), fixture.nowMs),
  );

  assert.equal(response.status, 413);
});

test("a body the submission schema rejects is a 400 with issue paths", async () => {
  const fixture = makeRunFixture();
  const response = await handleSubmitRun(
    postRequest(runsUrl, { ...submissionBody(fixture), score: -1 }),
    runDeps(stubWriter(), fixture.nowMs),
  );

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.ok(body.issues.some((i: { path: string }) => i.path === "score"));
});

test("malformed JSON is a 400", async () => {
  const response = await handleSubmitRun(
    postRequest(runsUrl, "{not json"),
    runDeps(stubWriter(), Date.now()),
  );
  assert.equal(response.status, 400);
});

// ─── GET /api/drop-in/leaderboard ────────────────────────────

function leaderboardUrl(params: Record<string, string>): string {
  const url = new URL("https://peakcam.io/api/drop-in/leaderboard");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

test("a time trial board is ordered by time ascending, then score descending", async () => {
  const trailId = resolveCourseOrThrow().trailId;
  const reader = stubReader([leaderboardRow()]);

  const response = await handleGetLeaderboard(
    new Request(leaderboardUrl({ resort: FIXTURE_RESORT_SLUG, mode: "time_trial", trailId })),
    { reader: () => reader, currentUserId: async () => null },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(reader.queries[0].order, [
    { column: "time_ms", ascending: true },
    { column: "score", ascending: false },
  ]);
  assert.equal(reader.queries[0].physicsVersion, PHYSICS_VERSION);
  assert.equal(reader.queries[0].courseVersion, COURSE_VERSION);
  assert.equal(reader.queries[0].limit, 20);
});

test("a score attack board is ordered by score descending, then time ascending", async () => {
  const trailId = resolveCourseOrThrow().trailId;
  const reader = stubReader([]);

  await handleGetLeaderboard(
    new Request(leaderboardUrl({ resort: FIXTURE_RESORT_SLUG, mode: "score_attack", trailId })),
    { reader: () => reader, currentUserId: async () => null },
  );

  assert.deepEqual(reader.queries[0].order, [
    { column: "score", ascending: false },
    { column: "time_ms", ascending: true },
  ]);
});

test("rows are projected to public fields only, with ranks assigned in order", async () => {
  const trailId = resolveCourseOrThrow().trailId;
  const reader = stubReader([
    leaderboardRow({ id: RUN_UUID, timeMs: 29_900, userId: USER_UUID }),
    leaderboardRow({ id: "22222222-3333-4444-8555-666666666666", timeMs: 31_000 }),
  ]);

  const response = await handleGetLeaderboard(
    new Request(leaderboardUrl({ resort: FIXTURE_RESORT_SLUG, mode: "time_trial", trailId })),
    { reader: () => reader, currentUserId: async () => null },
  );

  const body = await response.json();
  assert.deepEqual(body.rows.map((r: { rank: number }) => r.rank), [1, 2]);
  assert.equal(body.rows[0].displayName, "Powder Hound");
  for (const row of body.rows) {
    assert.deepEqual(Object.keys(row).sort(), [
      "courseVersion",
      "displayName",
      "finishedAt",
      "hasGhost",
      "id",
      "isSelf",
      "mode",
      "physicsVersion",
      "rank",
      "score",
      "timeMs",
      "trailId",
    ]);
  }
});

test("an unnamed run publishes a null display name, not a placeholder", async () => {
  const trailId = resolveCourseOrThrow().trailId;
  const reader = stubReader([leaderboardRow({ displayName: null })]);

  const response = await handleGetLeaderboard(
    new Request(leaderboardUrl({ resort: FIXTURE_RESORT_SLUG, mode: "time_trial", trailId })),
    { reader: () => reader, currentUserId: async () => null },
  );

  assert.equal((await response.json()).rows[0].displayName, null);
});

test("a stored name too long for the public schema fails the projection, not the client", async () => {
  // Belt and braces: sanitizeNickname caps at 24, the column CHECKs 24, and
  // publicLeaderboardRowSchema refuses to publish anything longer. If a row
  // ever slips past the first two, this is the gate that notices.
  const trailId = resolveCourseOrThrow().trailId;
  const reader = stubReader([leaderboardRow({ displayName: "x".repeat(25) })]);

  const response = await handleGetLeaderboard(
    new Request(leaderboardUrl({ resort: FIXTURE_RESORT_SLUG, mode: "time_trial", trailId })),
    { reader: () => reader, currentUserId: async () => null },
  );

  assert.equal(response.status, 500);
});

test("an anonymous board is shared-cacheable; a signed-in one is not", async () => {
  const trailId = resolveCourseOrThrow().trailId;
  const url = leaderboardUrl({ resort: FIXTURE_RESORT_SLUG, mode: "time_trial", trailId });
  const rows = [leaderboardRow({ userId: USER_UUID })];

  const anon = await handleGetLeaderboard(new Request(url), {
    reader: () => stubReader(rows),
    currentUserId: async () => null,
  });
  assert.equal(anon.headers.get("Cache-Control"), "public, s-maxage=60, stale-while-revalidate=300");
  assert.equal((await anon.json()).rows[0].isSelf, false);

  const signedIn = await handleGetLeaderboard(new Request(url), {
    reader: () => stubReader(rows),
    currentUserId: async () => USER_UUID,
  });
  assert.equal(signedIn.headers.get("Cache-Control"), "private, no-store");
  assert.equal((await signedIn.json()).rows[0].isSelf, true, "isSelf is why the response is private");
});

test("the leaderboard limit is clamped by validation, not silently truncated", async () => {
  const trailId = resolveCourseOrThrow().trailId;
  const over = await handleGetLeaderboard(
    new Request(leaderboardUrl({ resort: FIXTURE_RESORT_SLUG, mode: "time_trial", trailId, limit: "51" })),
    { reader: () => stubReader(), currentUserId: async () => null },
  );
  assert.equal(over.status, 400);

  const reader = stubReader();
  const ok = await handleGetLeaderboard(
    new Request(leaderboardUrl({ resort: FIXTURE_RESORT_SLUG, mode: "time_trial", trailId, limit: "50" })),
    { reader: () => reader, currentUserId: async () => null },
  );
  assert.equal(ok.status, 200);
  assert.equal(reader.queries[0].limit, 50);
});

test("an unknown course or mode never reaches the database", async () => {
  const trailId = resolveCourseOrThrow().trailId;

  const badMode = await handleGetLeaderboard(
    new Request(leaderboardUrl({ resort: FIXTURE_RESORT_SLUG, mode: "free_ride", trailId })),
    { reader: () => stubReader(), currentUserId: async () => null },
  );
  assert.equal(badMode.status, 400);

  const reader = stubReader();
  const badTrail = await handleGetLeaderboard(
    new Request(leaderboardUrl({ resort: FIXTURE_RESORT_SLUG, mode: "time_trial", trailId: "nope" })),
    { reader: () => reader, currentUserId: async () => null },
  );
  assert.equal(badTrail.status, 404);
  assert.equal(reader.queries.length, 0);
});

// ─── GET /api/drop-in/ghosts/[runId] ─────────────────────────

const ghostUrl = `https://peakcam.io/api/drop-in/ghosts/${RUN_UUID}`;

test("an accepted run's ghost is served as immutable binary", async () => {
  const fixture = makeRunFixture();
  const sha256Hex = createHash("sha256").update(fixture.ghostBytes).digest("hex");
  const reader = stubReader([], { bytes: fixture.ghostBytes, sha256Hex });

  const response = await handleGetGhost(new Request(ghostUrl), RUN_UUID, { reader: () => reader });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "application/octet-stream");
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
  assert.equal(response.headers.get("ETag"), `"${sha256Hex}"`);

  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual(bytes, fixture.ghostBytes);
});

test("a matching If-None-Match gets a 304 with no body", async () => {
  const fixture = makeRunFixture();
  const sha256Hex = createHash("sha256").update(fixture.ghostBytes).digest("hex");
  const reader = stubReader([], { bytes: fixture.ghostBytes, sha256Hex });

  const response = await handleGetGhost(
    new Request(ghostUrl, { headers: { "If-None-Match": `"${sha256Hex}"` } }),
    RUN_UUID,
    { reader: () => reader },
  );

  assert.equal(response.status, 304);
  assert.equal(await response.text(), "");
});

test("a missing, rejected, or non-uuid run all answer the same 404", async () => {
  const missing = await handleGetGhost(new Request(ghostUrl), RUN_UUID, {
    reader: () => stubReader(),
  });
  assert.equal(missing.status, 404);

  const reader = stubReader();
  const notAUuid = await handleGetGhost(new Request(ghostUrl), "../../etc/passwd", {
    reader: () => reader,
  });
  assert.equal(notAUuid.status, 404);
  assert.deepEqual(await missing.json(), await notAUuid.json(), "no oracle for run existence");
});
