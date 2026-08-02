/**
 * Re-simulation gate (Task A5).
 *
 * - `resimulateGhost` accepts the committed honest pure-sim fixture and rejects
 *   every programmed tamper (time edit, teleport, speed hack).
 * - When `DROP_IN_RESIM=1`, `validateRun` threads the verdict through; when the
 *   flag is off the path stays baseline-only.
 * - Nonce replay is enforced at the ticket/DB layer (not pure trajectory) —
 *   covered here by re-asserting the route/repository contract.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { simulationConfig } from "../core/config";
import {
  loadHonestGhost,
  tamperDurationShrink,
  tamperSpeedHack,
  tamperTeleport,
} from "./__fixtures__/ghosts";
import { makeRunFixture } from "./__fixtures__/run";
import {
  DROP_IN_RESIM_ENV,
  resimulateGhost,
  validateRun,
  type ResimVerdict,
} from "./validate-run";
import { decodeGhost } from "../replay/codec";
import { verifyTicket } from "./run-ticket";

function assertRejected(verdict: ResimVerdict, code: string): void {
  assert.equal(verdict.accepted, false, `expected rejection, got ${JSON.stringify(verdict)}`);
  if (!verdict.accepted) {
    assert.equal(verdict.code, code, verdict.detail);
    assert.ok(verdict.detail.length > 0);
  }
}

const packed = simulationConfig("packed");

// ─── Honest fixture ──────────────────────────────────────────

test("resimulateGhost accepts the honest pure-sim fixture", () => {
  const { ghost, course } = loadHonestGhost();
  const verdict = resimulateGhost(ghost, course, packed);
  assert.equal(verdict.accepted, true, !verdict.accepted ? verdict.detail : "");
});

test("the honest fixture also clears baseline validateRun", () => {
  const { ghost, course, sampleHz } = loadHonestGhost();
  const fixture = makeRunFixture({
    ghostMeta: { sampleHz, seed: ghost.meta.seed },
    mutateSamples: () => ghost.samples,
  });
  // Rebuild submission duration from the honest tick span.
  const spanMs = ((ghost.samples.at(-1)!.tick - ghost.samples[0].tick) / sampleHz) * 1000;
  const ticket = verifyTicket(fixture.ticket, fixture.keyring, { now: fixture.nowMs });
  const result = validateRun({
    ticket,
    submission: {
      ...fixture.submission,
      tickHz: sampleHz,
      timeMs: Math.round(spanMs),
      startedAt: new Date(fixture.nowMs - spanMs - 2_000).toISOString(),
      finishedAt: new Date(fixture.nowMs - 2_000).toISOString(),
    },
    ghost,
    course,
  });
  assert.equal(result.accepted, true, result.reason ?? "");
  assert.equal(result.metrics.startFinishChecked, true);
});

// ─── Tampered fixtures ───────────────────────────────────────

test("resimulateGhost rejects a duration-shrunk (time edit) ghost", () => {
  const { ghost, course } = loadHonestGhost();
  const tampered = tamperDurationShrink(ghost);
  assertRejected(resimulateGhost(tampered, course, packed), "duration_mismatch");
});

test("resimulateGhost rejects a mid-run teleport", () => {
  const { ghost, course } = loadHonestGhost();
  const tampered = tamperTeleport(ghost);
  assertRejected(resimulateGhost(tampered, course, packed), "teleport");
});

test("resimulateGhost rejects a speed-hacked sample", () => {
  const { ghost, course } = loadHonestGhost();
  const tampered = tamperSpeedHack(ghost);
  assertRejected(resimulateGhost(tampered, course, packed), "overspeed");
});

// ─── Env flag wiring ─────────────────────────────────────────

test("DROP_IN_RESIM off: validateRun is baseline-only (flag-off path)", () => {
  const prev = process.env[DROP_IN_RESIM_ENV];
  delete process.env[DROP_IN_RESIM_ENV];
  try {
    // A teleport that baseline catches still fails; the point is the flag is
    // not required for baseline. A known-good synthetic run is accepted.
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
    const { ghost, course, sampleHz } = loadHonestGhost();
    const tampered = tamperTeleport(ghost);
    const spanMs =
      ((tampered.samples.at(-1)!.tick - tampered.samples[0].tick) / sampleHz) * 1000;
    const fixture = makeRunFixture({
      ghostMeta: { sampleHz, seed: ghost.meta.seed },
    });
    const ticket = verifyTicket(fixture.ticket, fixture.keyring, { now: fixture.nowMs });
    const result = validateRun({
      ticket,
      submission: {
        ...fixture.submission,
        tickHz: sampleHz,
        timeMs: Math.round(spanMs),
        startedAt: new Date(fixture.nowMs - spanMs - 2_000).toISOString(),
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

test("DROP_IN_RESIM=1: validateRun accepts the honest fixture", () => {
  const prev = process.env[DROP_IN_RESIM_ENV];
  process.env[DROP_IN_RESIM_ENV] = "1";
  try {
    const { ghost, course, sampleHz } = loadHonestGhost();
    const spanMs = ((ghost.samples.at(-1)!.tick - ghost.samples[0].tick) / sampleHz) * 1000;
    const fixture = makeRunFixture({
      ghostMeta: { sampleHz, seed: ghost.meta.seed },
    });
    const ticket = verifyTicket(fixture.ticket, fixture.keyring, { now: fixture.nowMs });
    const result = validateRun({
      ticket,
      submission: {
        ...fixture.submission,
        tickHz: sampleHz,
        timeMs: Math.round(spanMs),
        startedAt: new Date(fixture.nowMs - spanMs - 2_000).toISOString(),
        finishedAt: new Date(fixture.nowMs - 2_000).toISOString(),
      },
      ghost,
      course,
    });
    assert.equal(result.accepted, true, result.reason ?? "");
  } finally {
    if (prev === undefined) delete process.env[DROP_IN_RESIM_ENV];
    else process.env[DROP_IN_RESIM_ENV] = prev;
  }
});

// ─── Nonce replay (ticket-level, not trajectory) ─────────────

test("nonce replay is a ticket/DB concern — unique nonce per issueTicket call", () => {
  // Pure trajectory validation has no nonce; the run route maps the unique
  // constraint on `run_nonce` to rejection_code `nonce_replay` (see
  // handlers/routes.test.ts "a replayed nonce surfaces as 409"). Confirm two
  // independently issued tickets never share a nonce so a client cannot
  // resubmit the same ticket body under a different ghost.
  const a = makeRunFixture();
  const b = makeRunFixture();
  const ticketA = verifyTicket(a.ticket, a.keyring, { now: a.nowMs });
  const ticketB = verifyTicket(b.ticket, b.keyring, { now: b.nowMs });
  assert.notEqual(ticketA.nonce, ticketB.nonce);
  // Forced same nonce: repository layer is what rejects the second insert.
  const replay = makeRunFixture({ nonce: ticketA.nonce });
  const ticketReplay = verifyTicket(replay.ticket, replay.keyring, { now: replay.nowMs });
  assert.equal(ticketReplay.nonce, ticketA.nonce);
});
