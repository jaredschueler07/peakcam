/**
 * Baseline run validation: one known-good synthetic run is accepted, and each
 * single-field tamper is rejected with its own code.
 *
 * Every case starts from the same fixture and changes exactly one thing, so a
 * failure names the rule that broke rather than "the fixture no longer
 * validates". The codes are asserted literally because they are stored in
 * `drop_in_runs.rejection_code` and aggregated for anti-cheat telemetry —
 * renaming one silently would corrupt that history.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { decodeGhost, type DecodedGhost, type GhostSample } from "../replay/codec";
import { COURSE_VERSION, PHYSICS_VERSION } from "../config/versions";
import {
  FIXTURE_SAMPLE_HZ,
  makeRunFixture,
  resolveCourseOrThrow,
  type RunFixtureOptions,
} from "./__fixtures__/run";
import { verifyTicket, RunTicketError } from "./run-ticket";
import { testKeyring, FOREIGN_TICKET_KEYS } from "./__fixtures__/run";
import {
  canPersistRejection,
  rejectionCodeForGhostError,
  rejectionCodeForTicketError,
  validateRun,
  type RejectionCode,
  type RunValidationResult,
} from "./validate-run";

/** Build the fixture, verify its ticket, decode its ghost, and validate. */
function runValidator(options: RunFixtureOptions = {}): RunValidationResult {
  const fixture = makeRunFixture(options);
  const ticket = verifyTicket(fixture.ticket, fixture.keyring, { now: fixture.nowMs });
  const ghost = decodeGhost(fixture.ghostBytes);
  return validateRun({
    ticket,
    submission: fixture.submission,
    ghost,
    course: fixture.course,
  });
}

function assertRejected(result: RunValidationResult, code: RejectionCode): void {
  assert.equal(result.accepted, false, `expected a rejection, got: ${JSON.stringify(result)}`);
  assert.equal(result.rejectionCode, code);
  assert.ok(result.reason, "a rejection must explain itself for the server log");
}

// ─── The happy path ──────────────────────────────────────────

test("a known-good synthetic run is accepted", () => {
  const result = runValidator();
  assert.equal(result.rejectionCode, null);
  assert.equal(result.accepted, true);
});

test("an accepted run records the metrics that will be stored", () => {
  const { metrics } = runValidator();
  assert.equal(metrics.keyframes, 300);
  assert.equal(metrics.sampleHz, FIXTURE_SAMPLE_HZ);
  assert.equal(metrics.ghostSpanMs, 29_900);
  assert.equal(metrics.reportedTimeMs, 29_900);
  assert.equal(metrics.startSpeedCms, 0);
  assert.ok(metrics.maxSpeedCms <= 3000, `peak speed was ${metrics.maxSpeedCms}`);
  assert.ok(metrics.distanceCm > 10_000, `only covered ${metrics.distanceCm}cm`);
  // Real startZ/finishZ from COURSE_GATES — see courses.ts.
  assert.equal(metrics.startFinishChecked, true);
});

// ─── Tampered traces ─────────────────────────────────────────

test("a keyframe that jumps further than any skier could travel is a teleport", () => {
  const result = runValidator({
    mutateSamples: (samples) => shift(samples, 150, { zCm: 60_000 }),
  });
  assertRejected(result, "teleport");
});

test("an impossible top speed is overspeed", () => {
  // 150 m/s: inside the codec's corruption guard, far outside the run bound,
  // so this reaches the validator rather than failing to decode.
  const result = runValidator({
    mutateSamples: (samples) => shift(samples, 200, { speedCms: 15_000 }),
  });
  assertRejected(result, "overspeed");
});

test("a speed that ramps faster than the accel envelope is impossible acceleration", () => {
  // Two grounded samples: +700 cm/s over dt=12/120 s ⇒ 7000 cm/s² > MAX_ACCEL_CMS2,
  // while both speeds stay under MAX_RUN_SPEED_CMS so overspeed does not fire first.
  const result = runValidator({
    mutateSamples: (samples) =>
      samples.map((s, i) => {
        if (i === 100) return { ...s, speedCms: 1_000, poseFlags: 0 };
        if (i === 101) return { ...s, speedCms: 1_700, poseFlags: 0 };
        return s;
      }),
  });
  assertRejected(result, "impossible_acceleration");
});

test("a non-advancing tick is a tick regression", () => {
  // The codec rejects this at decode time, so the validator is exercised
  // directly on samples it could only receive from a future non-PCGH source.
  const fixture = makeRunFixture();
  const decoded = decodeGhost(fixture.ghostBytes);
  const ghost: DecodedGhost = {
    meta: decoded.meta,
    samples: decoded.samples.map((s, i) => (i === 120 ? { ...s, tick: decoded.samples[119].tick } : s)),
  };
  const ticket = verifyTicket(fixture.ticket, fixture.keyring, { now: fixture.nowMs });

  assertRejected(
    validateRun({ ticket, submission: fixture.submission, ghost, course: fixture.course }),
    "tick_regression",
  );
});

test("a reported time that disagrees with the ghost's tick span is a duration mismatch", () => {
  const result = runValidator({ submission: { timeMs: 12_000 } });
  assertRejected(result, "duration_mismatch");
});

test("a reported time within one tick of the ghost span is still accepted", () => {
  // The last keyframe can land up to one sample period before the finish line.
  const result = runValidator({ submission: { timeMs: 29_900 + 100 } });
  assert.equal(result.accepted, true, result.reason ?? "");
});

test("wall-clock timestamps that contradict the elapsed time are rejected", () => {
  const startedAt = new Date(Date.UTC(2026, 6, 15, 16, 0, 0)).toISOString();
  const finishedAt = new Date(Date.UTC(2026, 6, 15, 16, 5, 0)).toISOString();
  assertRejected(runValidator({ submission: { startedAt, finishedAt } }), "wall_clock_mismatch");
});

test("a keyframe outside the resort's baked box is out of bounds", () => {
  // Breckenridge bakes a 6144 m box, so ±3122 m is the outer limit.
  const result = runValidator({
    mutateSamples: (samples) => shift(samples, 250, { xCm: 900_000 }),
  });
  assertRejected(result, "out_of_bounds");
});

test("a run that launches at speed never crossed the start gate", () => {
  const result = runValidator({
    mutateSamples: (samples) => samples.map((s, i) => (i === 0 ? { ...s, speedCms: 2_500 } : s)),
  });
  assertRejected(result, "bad_start");
});

test("a run too short to be a descent is a bad finish", () => {
  // Eleven keyframes, one second, parked on the start gate: clears the start
  // and duration checks, fails the distance floor (and never reaches finish).
  const course = resolveCourseOrThrow();
  const startZCm = Math.round(course.startZ * 100);
  const result = runValidator({
    mutateSamples: (samples) =>
      samples.slice(0, 11).map((s) => ({ ...s, speedCms: 0, xCm: 0, zCm: startZCm })),
  });
  assertRejected(result, "bad_finish");
});

// ─── Ghost/ticket identity ───────────────────────────────────

test("a ghost recorded against a different seed does not match its ticket", () => {
  assertRejected(runValidator({ ghostMeta: { seed: 12_345 } }), "seed_mismatch");
});

test("a ghost from another physics version is not rankable here", () => {
  assertRejected(
    runValidator({ ghostMeta: { physicsVersion: PHYSICS_VERSION + 1 } }),
    "course_mismatch",
  );
});

test("a ghost from another course version is not rankable here", () => {
  assertRejected(
    runValidator({ ghostMeta: { courseVersion: COURSE_VERSION + 1 } }),
    "course_mismatch",
  );
});

test("a submitted tickHz that disagrees with the ghost header is rejected", () => {
  assertRejected(runValidator({ submission: { tickHz: 30 } }), "tick_hz_mismatch");
});

test("a single-keyframe ghost fails the keyframe count and cannot be stored", () => {
  const fixture = makeRunFixture();
  const decoded = decodeGhost(fixture.ghostBytes);
  const ghost: DecodedGhost = { meta: decoded.meta, samples: decoded.samples.slice(0, 1) };
  const ticket = verifyTicket(fixture.ticket, fixture.keyring, { now: fixture.nowMs });

  assertRejected(
    validateRun({ ticket, submission: fixture.submission, ghost, course: fixture.course }),
    "keyframe_count",
  );
  // Migration 015 checks `ghost_keyframes between 2 and 20000`, so there is no
  // row to write — the route answers 422 instead of storing telemetry.
  assert.equal(canPersistRejection(ghost), false);
  assert.equal(canPersistRejection(decoded), true);
});

// ─── Ticket failures (verifyTicket's codes, mapped here) ─────

test("a ticket signed with a rotated-out secret is a bad signature", () => {
  const fixture = makeRunFixture();
  const foreign = testKeyring(FOREIGN_TICKET_KEYS);

  const error = ticketErrorFrom(() => verifyTicket(fixture.ticket, foreign, { now: fixture.nowMs }));

  assert.equal(error.code, "bad-sig");
  assert.equal(rejectionCodeForTicketError(error), "ticket_bad_sig");
});

test("a ticket past its TTL is expired", () => {
  const fixture = makeRunFixture({ ticketTtlMs: 60_000 });

  const error = ticketErrorFrom(() =>
    verifyTicket(fixture.ticket, fixture.keyring, { now: fixture.nowMs + 61_000 }),
  );

  assert.equal(error.code, "expired");
  assert.equal(rejectionCodeForTicketError(error), "ticket_expired");
});

test("every ticket and ghost error maps to a distinct stored rejection code", () => {
  const ticketCodes = (["malformed", "unknown-kid", "bad-sig", "expired"] as const).map((code) =>
    rejectionCodeForTicketError(new RunTicketError(code, code)),
  );
  assert.deepEqual(ticketCodes, [
    "ticket_malformed",
    "ticket_unknown_kid",
    "ticket_bad_sig",
    "ticket_expired",
  ]);

  const ghostBad = decodeGhostError(new Uint8Array(8));
  assert.equal(ghostBad, "ghost_truncated");
});

/**
 * Nonce replay is deliberately absent from this file. It is enforced by the
 * `run_nonce` unique constraint in migration 015 — there is no pure function to
 * test, and an in-memory seen-set would be meaningless across serverless
 * instances. `handlers/routes.test.ts` covers the route's handling of the
 * conflict the database raises.
 */

// ─── helpers ─────────────────────────────────────────────────

/** Run `fn`, insisting it threw a {@link RunTicketError}, and return it. */
function ticketErrorFrom(fn: () => unknown): RunTicketError {
  try {
    fn();
  } catch (error) {
    if (error instanceof RunTicketError) return error;
    throw error;
  }
  throw new assert.AssertionError({ message: "expected a RunTicketError, nothing was thrown" });
}

function shift(samples: GhostSample[], from: number, delta: Partial<GhostSample>): GhostSample[] {
  return samples.map((s, i) =>
    i >= from
      ? {
          ...s,
          xCm: s.xCm + (delta.xCm ?? 0),
          zCm: s.zCm + (delta.zCm ?? 0),
          speedCms: delta.speedCms ?? s.speedCms,
        }
      : s,
  );
}

function decodeGhostError(bytes: Uint8Array): RejectionCode | "decoded" {
  try {
    decodeGhost(bytes);
    return "decoded";
  } catch (error) {
    return rejectionCodeForGhostError(error as never);
  }
}

// Keep the course resolvable: if the Breckenridge profile ever loses its
// trails, every case above would fail obscurely instead of here.
test("the fixture course resolves against the real resort profile", () => {
  const course = resolveCourseOrThrow();
  assert.equal(course.resortSlug, "breckenridge");
  assert.equal(course.halfSizeM, 3072);
});
