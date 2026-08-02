/**
 * Re-simulation gate (Task A5 + fix round 1).
 *
 * - Absolute 120 Hz ticks (`FIXED_HZ`); expected gap = FIXED_HZ / sampleHz.
 * - Honest fixtures (braked, neutral, full-tuck) all accept.
 * - Tick compression (×0.8, ×0.9) rejects; one-dropped-sample still accepts.
 * - Teleport + speed-hack reject.
 * - `DROP_IN_RESIM=1` threads resim into validateRun.
 *
 * Nonce *replay* is DB-side — see `run-repository.test.ts:177`. This file only
 * asserts fixture ticket nonces are unique when issued independently.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { FIXED_HZ } from "../core/clock";
import { simulationConfig } from "../core/config";
import { decodeGhost } from "../replay/codec";
import {
  dropOneSample,
  loadHonestGhost,
  tamperSpeedHack,
  tamperTeleport,
  tamperTickCompression,
  type HonestKind,
} from "./__fixtures__/ghosts";
import { makeRunFixture } from "./__fixtures__/run";
import {
  DROP_IN_RESIM_ENV,
  expectedSampleGapTicks,
  ghostSpanMsFromTicks,
  resimulateGhost,
  validateRun,
  type ResimVerdict,
} from "./validate-run";
import { verifyTicket } from "./run-ticket";

function assertRejected(verdict: ResimVerdict, code: string): void {
  assert.equal(verdict.accepted, false, `expected rejection, got ${JSON.stringify(verdict)}`);
  if (!verdict.accepted) {
    assert.equal(verdict.code, code, verdict.detail);
    assert.ok(verdict.detail.length > 0);
  }
}

const packed = simulationConfig("packed");

function spanMs(ghost: { samples: { tick: number }[] }): number {
  return ghostSpanMsFromTicks(ghost.samples[0].tick, ghost.samples.at(-1)!.tick);
}

function validateHonestEndToEnd(kind: HonestKind, resimFlag: boolean) {
  const prev = process.env[DROP_IN_RESIM_ENV];
  if (resimFlag) process.env[DROP_IN_RESIM_ENV] = "1";
  else delete process.env[DROP_IN_RESIM_ENV];
  try {
    const { ghost, course, sampleHz, seed } = loadHonestGhost(kind);
    const elapsed = spanMs(ghost);
    const fixture = makeRunFixture({ ghostMeta: { sampleHz, seed } });
    const ticket = verifyTicket(fixture.ticket, fixture.keyring, { now: fixture.nowMs });
    return validateRun({
      ticket,
      submission: {
        ...fixture.submission,
        tickHz: sampleHz,
        timeMs: Math.round(elapsed),
        startedAt: new Date(fixture.nowMs - elapsed - 2_000).toISOString(),
        finishedAt: new Date(fixture.nowMs - 2_000).toISOString(),
      },
      ghost,
      course,
    });
  } finally {
    if (prev === undefined) delete process.env[DROP_IN_RESIM_ENV];
    else process.env[DROP_IN_RESIM_ENV] = prev;
  }
}

// ─── Tick timebase ───────────────────────────────────────────

test("honest fixtures use absolute 120Hz ticks with expected sample gap", () => {
  const { ghost, sampleHz } = loadHonestGhost("braked");
  const expected = expectedSampleGapTicks(sampleHz);
  assert.equal(expected, FIXED_HZ / sampleHz);
  assert.equal(ghost.samples[0].tick, 0);
  assert.equal(ghost.samples[1].tick - ghost.samples[0].tick, expected);
  // Span is ticks/FIXED_HZ, not ticks/sampleHz (which would be 4× too short).
  const span = spanMs(ghost);
  const wrongSampleHzSpan =
    ((ghost.samples.at(-1)!.tick - ghost.samples[0].tick) / sampleHz) * 1000;
  assert.ok(Math.abs(span - wrongSampleHzSpan / (FIXED_HZ / sampleHz)) < 1);
  assert.ok(span > 10_000, `span ${span}ms looks like sample-index timebase`);
});

// ─── Honest fixtures ─────────────────────────────────────────

for (const kind of ["braked", "neutral", "full-tuck"] as const) {
  test(`resimulateGhost accepts honest ${kind} fixture`, () => {
    const { ghost, course } = loadHonestGhost(kind);
    const verdict = resimulateGhost(ghost, course, packed);
    assert.equal(verdict.accepted, true, !verdict.accepted ? verdict.detail : "");
  });

  test(`honest ${kind} clears baseline + resim end-to-end (DROP_IN_RESIM=1)`, () => {
    const result = validateHonestEndToEnd(kind, true);
    assert.equal(result.accepted, true, result.reason ?? "");
    assert.equal(result.metrics.startFinishChecked, true);
  });
}

test("honest fixture with one dropped sample still passes resim", () => {
  const { ghost, course } = loadHonestGhost("braked");
  const dropped = dropOneSample(ghost);
  const verdict = resimulateGhost(dropped, course, packed);
  assert.equal(verdict.accepted, true, !verdict.accepted ? verdict.detail : "");
  // Gap around the drop is 2× expected.
  const expected = expectedSampleGapTicks(dropped.meta.sampleHz);
  let sawDouble = false;
  for (let i = 1; i < dropped.samples.length; i++) {
    const gap = dropped.samples[i].tick - dropped.samples[i - 1].tick;
    if (gap === expected * 2) sawDouble = true;
  }
  assert.ok(sawDouble, "fixture should contain a 2× expected gap");
});

// ─── Time edit = tick compression ────────────────────────────

test("resimulateGhost rejects tick compression ×0.8 (time edit)", () => {
  const { ghost, course } = loadHonestGhost("braked");
  assertRejected(resimulateGhost(tamperTickCompression(ghost, 0.8), course, packed), "duration_mismatch");
});

test("resimulateGhost rejects tick compression ×0.9 (time edit)", () => {
  const { ghost, course } = loadHonestGhost("braked");
  assertRejected(resimulateGhost(tamperTickCompression(ghost, 0.9), course, packed), "duration_mismatch");
});

// ─── Other tampers ───────────────────────────────────────────

test("resimulateGhost rejects a mid-run teleport", () => {
  const { ghost, course } = loadHonestGhost("braked");
  assertRejected(resimulateGhost(tamperTeleport(ghost), course, packed), "teleport");
});

test("resimulateGhost rejects a speed-hacked sample", () => {
  const { ghost, course } = loadHonestGhost("braked");
  assertRejected(resimulateGhost(tamperSpeedHack(ghost), course, packed), "overspeed");
});

// ─── Env flag wiring ─────────────────────────────────────────

test("DROP_IN_RESIM off: validateRun accepts synthetic good run without resim", () => {
  const prev = process.env[DROP_IN_RESIM_ENV];
  delete process.env[DROP_IN_RESIM_ENV];
  try {
    const fixture = makeRunFixture();
    const ticket = verifyTicket(fixture.ticket, fixture.keyring, { now: fixture.nowMs });
    const ghost = decodeGhost(fixture.ghostBytes);
    const result = validateRun({
      ticket,
      submission: fixture.submission,
      ghost,
      course: fixture.course,
    });
    assert.equal(result.accepted, true, result.reason ?? "");
  } finally {
    if (prev === undefined) delete process.env[DROP_IN_RESIM_ENV];
    else process.env[DROP_IN_RESIM_ENV] = prev;
  }
});

test("DROP_IN_RESIM=1: validateRun rejects a teleport via the resim path", () => {
  const prev = process.env[DROP_IN_RESIM_ENV];
  process.env[DROP_IN_RESIM_ENV] = "1";
  try {
    const { ghost, course, sampleHz, seed } = loadHonestGhost("braked");
    const tampered = tamperTeleport(ghost);
    const elapsed = spanMs(tampered);
    const fixture = makeRunFixture({ ghostMeta: { sampleHz, seed } });
    const ticket = verifyTicket(fixture.ticket, fixture.keyring, { now: fixture.nowMs });
    const result = validateRun({
      ticket,
      submission: {
        ...fixture.submission,
        tickHz: sampleHz,
        timeMs: Math.round(elapsed),
        startedAt: new Date(fixture.nowMs - elapsed - 2_000).toISOString(),
        finishedAt: new Date(fixture.nowMs - 2_000).toISOString(),
      },
      ghost: tampered,
      course,
    });
    assert.equal(result.accepted, false);
    assert.equal(result.rejectionCode, "teleport");
  } finally {
    if (prev === undefined) delete process.env[DROP_IN_RESIM_ENV];
    else process.env[DROP_IN_RESIM_ENV] = prev;
  }
});

// ─── Fixture nonce uniqueness (not replay) ───────────────────

test("issueTicket produces unique nonces across independent fixtures", () => {
  // This asserts fixture/ticket issuance uniqueness only — not DB replay.
  // Real nonce_replay coverage: run-repository.test.ts:177
  // ("the run_nonce unique violation is reported as a replay…") and
  // handlers/routes.test.ts ("a replayed nonce surfaces as 409…").
  const a = makeRunFixture();
  const b = makeRunFixture();
  const ticketA = verifyTicket(a.ticket, a.keyring, { now: a.nowMs });
  const ticketB = verifyTicket(b.ticket, b.keyring, { now: b.nowMs });
  assert.notEqual(ticketA.nonce, ticketB.nonce);
  const replay = makeRunFixture({ nonce: ticketA.nonce });
  const ticketReplay = verifyTicket(replay.ticket, replay.keyring, { now: replay.nowMs });
  assert.equal(ticketReplay.nonce, ticketA.nonce);
});
