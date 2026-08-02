import assert from "node:assert/strict";
import { test } from "node:test";

import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import { createWorld } from "../terrain/obstacles";
import { createTerrainSource } from "../terrain/terrain-source";
import type { RunSessionTicket } from "./session-client";
import {
  NO_TICKET,
  needsRemint,
  resolveRunSeed,
  ticketForWorld,
  ticketReducer,
  usableTicket,
  type TicketState,
} from "./ticket-lifecycle";
import { physicsModelForSessionRequest } from "../runtime/physics-selection";

const NOW = 1_754_000_000_000;

function proceduralTerrain(profile: (typeof DROP_IN_GAME_PROFILES)["ski-portillo"]) {
  return createTerrainSource({ profile, mode: "procedural" }).sampler;
}

function ticketAt(expiresAtMs: number, seed = 4242): RunSessionTicket {
  return {
    ticket: `tok-${expiresAtMs}`,
    seed,
    resortSlug: "ski-portillo",
    mode: "time_trial",
    trailId: "roca-jack",
    surface: "packed",
    physicsModel: "v1",
    physicsVersion: 1,
    courseVersion: 1,
    tickHz: 10,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

const fresh = ticketAt(NOW + 60_000);

function ready(): TicketState {
  return ticketReducer(ticketReducer(NO_TICKET, { type: "request" }), { type: "received", ticket: fresh });
}

test("a requested ticket becomes usable once it arrives", () => {
  const requesting = ticketReducer(NO_TICKET, { type: "request" });
  assert.equal(requesting.status, "requesting");
  assert.equal(usableTicket(requesting, NOW), null, "an in-flight request is not a ticket");

  const state = ticketReducer(requesting, { type: "received", ticket: fresh });
  assert.equal(state.status, "ready");
  assert.equal(usableTicket(state, NOW), fresh);
  assert.equal(needsRemint(state, NOW), false);
});

test("a failed request degrades to offline rather than pretending to hold a ticket", () => {
  const state = ticketReducer(ticketReducer(NO_TICKET, { type: "request" }), { type: "failed" });
  assert.equal(state.status, "offline");
  assert.equal(usableTicket(state, NOW), null);
});

test("submitting spends the ticket, and a spent ticket must be re-minted before reuse", () => {
  const spent = ticketReducer(ready(), { type: "submitted" });
  assert.equal(spent.status, "spent");
  // The nonce is one-time-use: reusing it is a 409 nonce_replay on the server.
  assert.equal(usableTicket(spent, NOW), null);
  assert.equal(needsRemint(spent, NOW), true);
});

test("an unspent ticket survives a restart and is not re-minted", () => {
  const state = ready();
  assert.equal(needsRemint(state, NOW), false, "a run that was never submitted keeps its ticket");
  assert.equal(usableTicket(state, NOW), fresh);
});

test("an expired ticket is unusable and asks to be re-minted", () => {
  const state = ticketReducer(ticketReducer(NO_TICKET, { type: "request" }), {
    type: "received",
    ticket: ticketAt(NOW - 1),
  });
  assert.equal(state.status, "ready");
  assert.equal(usableTicket(state, NOW), null, "an expired ticket cannot start a competitive run");
  assert.equal(needsRemint(state, NOW), true);
});

test("re-minting after a spend returns a usable ticket again", () => {
  const spent = ticketReducer(ready(), { type: "submitted" });
  const requesting = ticketReducer(spent, { type: "request" });
  assert.equal(requesting.status, "requesting");
  const reminted = ticketReducer(requesting, { type: "received", ticket: ticketAt(NOW + 120_000) });
  assert.equal(reminted.status, "ready");
  assert.equal(needsRemint(reminted, NOW), false);
  assert.notEqual(usableTicket(reminted, NOW)?.ticket, fresh.ticket);
});

test("clearing returns to the no-ticket state, which never needs a re-mint", () => {
  const state = ticketReducer(ready(), { type: "cleared" });
  assert.equal(state, NO_TICKET);
  assert.equal(needsRemint(NO_TICKET, NOW), false, "Free Ski must never trigger a session request");
});

// ── ticketForWorld: a ticket is only usable for the world actually running ──

test("a ticket whose seed and physics model match the running world can be frozen onto the run", () => {
  const state = ready();
  assert.equal(ticketForWorld(state, fresh.seed, { surface: "packed", physicsModel: "v1" }, NOW), fresh);
});

test("a re-minted ticket from a UTC-day rollover is refused rather than submitted", () => {
  // The Daily Line seed rotates at midnight UTC, but a restart does not rebuild
  // the world — so the new ticket describes a course this run is not skiing.
  const rolled = ticketReducer(NO_TICKET, { type: "received", ticket: ticketAt(NOW + 60_000, 111) });
  assert.equal(ticketForWorld(rolled, 222, { surface: "packed", physicsModel: "v1" }, NOW), null);
  assert.equal(usableTicket(rolled, NOW)?.seed, 111, "the ticket itself is still valid, just not for this world");
});

test("ticketForWorld fails closed when the running world's seed is unknown", () => {
  const state = ready();
  assert.equal(ticketForWorld(state, null, { surface: "packed", physicsModel: "v1" }, NOW), null);
  assert.equal(ticketForWorld(state, undefined, { surface: "packed", physicsModel: "v1" }, NOW), null);
});

test("?phys=v2 override is unsubmittable unless its ticket declares physicsModel v2", () => {
  // The URL override changes the world only; ticket requests stay on the
  // rollout model, so a v1 ticket must fail closed here.
  assert.equal(ticketForWorld(ready(), fresh.seed, { surface: "packed", physicsModel: "v2" }, NOW), null);
  assert.equal(physicsModelForSessionRequest({ physicsModel: "v1" }), "v1");
  const v2 = { ...fresh, physicsModel: "v2" as const };
  const state = ticketReducer(NO_TICKET, { type: "received", ticket: v2 });
  assert.equal(ticketForWorld(state, fresh.seed, { surface: "packed", physicsModel: "v2" }, NOW), v2);
});

test("a ticket for a different snow surface is not usable for the running world", () => {
  assert.equal(ticketForWorld(ready(), fresh.seed, { surface: "ice", physicsModel: "v1" }, NOW), null);
});

test("ticketForWorld still honours spend and expiry", () => {
  const spent = ticketReducer(ready(), { type: "submitted" });
  assert.equal(ticketForWorld(spent, fresh.seed, { surface: "packed", physicsModel: "v1" }, NOW), null);

  const expired = ticketReducer(NO_TICKET, { type: "received", ticket: ticketAt(NOW - 1, fresh.seed) });
  assert.equal(ticketForWorld(expired, fresh.seed, { surface: "packed", physicsModel: "v1" }, NOW), null);
});

// ── C1: the ticket seed must reach the simulated world ──────────────────────

test("a ticketed run seeds the world from the ticket, not the profile", () => {
  const profile = DROP_IN_GAME_PROFILES["ski-portillo"];
  const ticket = ticketAt(NOW + 60_000, 987654321);
  assert.notEqual(ticket.seed, profile.seed, "fixture must differ from the profile seed to be meaningful");

  const seed = resolveRunSeed(ticket, profile.seed);
  assert.equal(seed, ticket.seed);

  // world.seed is what GameRuntime writes into the ghost header, and what the
  // server compares against the ticket (validate-run.ts → seed_mismatch).
  const world = createWorld(profile, seed, proceduralTerrain(profile));
  assert.equal(world.seed, ticket.seed);
});

test("an offline or Free Ski run falls back to the profile seed and stays unsubmittable", () => {
  const profile = DROP_IN_GAME_PROFILES["ski-portillo"];
  assert.equal(resolveRunSeed(null, profile.seed), profile.seed);
  const world = createWorld(profile, resolveRunSeed(null, profile.seed), proceduralTerrain(profile));
  assert.equal(world.seed, profile.seed);
});
