import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_GHOST_BYTES,
  MAX_NICKNAME_LENGTH,
  MAX_SCORE,
  MAX_TIME_MS,
  MIN_TIME_MS,
  base64ByteLength,
  ghostBase64Schema,
  leaderboardOrder,
  publicLeaderboardRowSchema,
  publicLeaderboardSchema,
  runSubmissionSchema,
} from "./run-schema";

const TICKET = "aGVhZGVy.cGF5bG9hZA.c2lnbmF0dXJl";

function base64OfBytes(byteLength: number): string {
  return Buffer.alloc(byteLength, 0x41).toString("base64");
}

const VALID_SUBMISSION = {
  ticket: TICKET,
  ghost: base64OfBytes(2048),
  tickHz: 10,
  timeMs: 92_450,
  score: 18_300,
  startedAt: "2026-08-01T17:04:11.000Z",
  finishedAt: "2026-08-01T17:05:43.450Z",
};

function submissionIssues(body: unknown) {
  const result = runSubmissionSchema.safeParse(body);
  assert.equal(result.success, false, "expected the submission to be rejected");
  return result.error.issues;
}

/** Paths of every issue a rejected submission produced. */
function submissionError(body: unknown): string[] {
  return submissionIssues(body).map((issue) => issue.path.join("."));
}

// ─── base64 sizing ───────────────────────────────────────────

test("base64ByteLength matches the real decoded length", () => {
  for (const n of [1, 2, 3, 4, 5, 100, 1023, 1024, 65_535]) {
    const encoded = base64OfBytes(n);
    assert.equal(base64ByteLength(encoded), n, `${n} bytes`);
  }
});

test("ghost payloads are bounded at 128 KB", () => {
  assert.equal(ghostBase64Schema.safeParse(base64OfBytes(MAX_GHOST_BYTES)).success, true);
  assert.equal(ghostBase64Schema.safeParse(base64OfBytes(MAX_GHOST_BYTES + 1)).success, false);
});

test("ghost payloads must be standard base64", () => {
  assert.equal(ghostBase64Schema.safeParse("not base64!!").success, false);
  // base64url is rejected: the ghost rides in a JSON body, not a URL.
  assert.equal(ghostBase64Schema.safeParse("q-_A").success, false);
  // Unpadded input would silently change the decoded length.
  assert.equal(ghostBase64Schema.safeParse("QUFB QQ==".replace(" ", "")).success, true);
  assert.equal(ghostBase64Schema.safeParse("QUFBQ").success, false);
});

// ─── Submission ──────────────────────────────────────────────

test("accepts a well-formed submission", () => {
  const parsed = runSubmissionSchema.parse(VALID_SUBMISSION);
  assert.equal(parsed.timeMs, 92_450);
  assert.equal(parsed.nickname, undefined);
});

test("accepts an optional trimmed nickname", () => {
  const parsed = runSubmissionSchema.parse({ ...VALID_SUBMISSION, nickname: "  Powder Hound " });
  assert.equal(parsed.nickname, "Powder Hound");
  assert.deepEqual(
    submissionError({ ...VALID_SUBMISSION, nickname: "x".repeat(MAX_NICKNAME_LENGTH + 1) }),
    ["nickname"],
  );
});

test("rejects unknown fields so a client cannot smuggle course parameters", () => {
  // resort/mode/trail/seed/versions come from the ticket, never the body.
  for (const extra of [{ resortSlug: "breckenridge" }, { accepted: true }, { userId: "u" }]) {
    const issues = submissionIssues({ ...VALID_SUBMISSION, ...extra });
    assert.equal(issues.length, 1);
    assert.equal(issues[0].code, "unrecognized_keys");
    assert.deepEqual(
      (issues[0] as { keys: string[] }).keys,
      Object.keys(extra),
    );
  }
});

test("enforces the RUN-CONTRACTS time and score bounds", () => {
  assert.deepEqual(submissionError({ ...VALID_SUBMISSION, timeMs: MIN_TIME_MS - 1 }), ["timeMs"]);
  assert.deepEqual(submissionError({ ...VALID_SUBMISSION, timeMs: MAX_TIME_MS + 1 }), ["timeMs"]);
  assert.deepEqual(submissionError({ ...VALID_SUBMISSION, timeMs: 1234.5 }), ["timeMs"]);
  assert.deepEqual(submissionError({ ...VALID_SUBMISSION, score: -1 }), ["score"]);
  assert.deepEqual(submissionError({ ...VALID_SUBMISSION, score: MAX_SCORE + 1 }), ["score"]);

  assert.equal(runSubmissionSchema.safeParse({ ...VALID_SUBMISSION, timeMs: MIN_TIME_MS }).success, true);
  assert.equal(runSubmissionSchema.safeParse({ ...VALID_SUBMISSION, score: 0 }).success, true);
});

test("enforces the tick rate bounds from the migration's CHECK", () => {
  assert.deepEqual(submissionError({ ...VALID_SUBMISSION, tickHz: 9 }), ["tickHz"]);
  assert.deepEqual(submissionError({ ...VALID_SUBMISSION, tickHz: 241 }), ["tickHz"]);
  assert.equal(runSubmissionSchema.safeParse({ ...VALID_SUBMISSION, tickHz: 240 }).success, true);
});

test("rejects a ticket that is not a compact token", () => {
  assert.deepEqual(submissionError({ ...VALID_SUBMISSION, ticket: "two.parts" }), ["ticket"]);
  assert.deepEqual(submissionError({ ...VALID_SUBMISSION, ticket: "has.bad+chars.here" }), [
    "ticket",
  ]);
});

test("rejects an impossible wall-clock window", () => {
  // finishedAt before startedAt.
  assert.deepEqual(
    submissionError({
      ...VALID_SUBMISSION,
      startedAt: "2026-08-01T17:05:43.450Z",
      finishedAt: "2026-08-01T17:04:11.000Z",
    }),
    ["finishedAt"],
  );
  // A window shorter than the minimum legal run.
  assert.deepEqual(
    submissionError({
      ...VALID_SUBMISSION,
      startedAt: "2026-08-01T17:04:11.000Z",
      finishedAt: "2026-08-01T17:04:11.500Z",
    }),
    ["finishedAt"],
  );
});

test("requires offset-bearing ISO timestamps", () => {
  const paths = submissionError({ ...VALID_SUBMISSION, startedAt: "2026-08-01 17:04:11" });
  assert.ok(paths.includes("startedAt"), `expected a startedAt issue, got ${paths.join(", ")}`);
});

// ─── Public projection ───────────────────────────────────────

const VALID_ROW = {
  id: "1f2e3d4c-5b6a-4798-8899-aabbccddeeff",
  rank: 1,
  mode: "time_trial" as const,
  trailId: "roca-jack",
  timeMs: 92_450,
  score: 18_300,
  physicsVersion: 3,
  courseVersion: 20_260_801,
  displayName: "Powder Hound",
  isSelf: false,
  hasGhost: true,
  finishedAt: "2026-08-01T17:05:43.450Z",
};

test("accepts a public leaderboard row and an anonymous one", () => {
  assert.equal(publicLeaderboardRowSchema.safeParse(VALID_ROW).success, true);
  assert.equal(
    publicLeaderboardRowSchema.safeParse({ ...VALID_ROW, displayName: null }).success,
    true,
  );
});

test("strips nothing — private columns make the row invalid outright", () => {
  // DESIGN §3.7: validation_metrics, nonce, rejection detail, and raw identity
  // must never reach a client. `.strict()` turns a leaky select into a 500 in
  // the server's own logs rather than a silent data leak.
  for (const leak of [
    { validationMetrics: { maxSpeed: 41.2 } },
    { validation_metrics: {} },
    { runNonce: "6f1a2b3c-0000-4000-8000-000000000001" },
    { rejectionCode: "speed-hack" },
    { userId: "8f14e45f-ceea-467a-9f26-9a3f2b0f9e11" },
    { ghostData: "UENHSA==" },
  ]) {
    const result = publicLeaderboardRowSchema.safeParse({ ...VALID_ROW, ...leak });
    assert.equal(result.success, false, `${Object.keys(leak)[0]} should be rejected`);
  }
});

test("validates the leaderboard envelope", () => {
  const board = {
    resortSlug: "ski-portillo",
    mode: "time_trial" as const,
    trailId: "roca-jack",
    physicsVersion: 3,
    courseVersion: 20_260_801,
    rows: [VALID_ROW, { ...VALID_ROW, id: "2f2e3d4c-5b6a-4798-8899-aabbccddeeff", rank: 2 }],
  };
  assert.equal(publicLeaderboardSchema.safeParse(board).success, true);
  assert.equal(publicLeaderboardSchema.safeParse({ ...board, rows: [{ rank: 1 }] }).success, false);
});

test("ranks each mode by its own contract", () => {
  assert.deepEqual(leaderboardOrder("time_trial"), [
    { column: "time_ms", ascending: true },
    { column: "score", ascending: false },
  ]);
  assert.deepEqual(leaderboardOrder("score_attack"), [
    { column: "score", ascending: false },
    { column: "time_ms", ascending: true },
  ]);
});
