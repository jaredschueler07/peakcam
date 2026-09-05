import test from "node:test";
import assert from "node:assert/strict";
import { freezeConditions } from "./freeze-conditions";
import type { ConditionsSnapshot } from "../conditions";
import type { RunSessionTicket } from "./session-client";
import { COURSE_VERSION, PHYSICS_VERSION } from "../config/versions";
const live: ConditionsSnapshot = { surface: "powder", physicsModel: "v2", weatherDefault: 1, powderDay: true, baseDepthIn: 60, snow24In: 12, stamp: "Snowing", narrative: null, environment: { powderDepthCm: 30, windSpeedMps: 15, morningIce: false, visibilityM: 800, northSign: -1 } };
const ticket: RunSessionTicket = { ticket: "signed", seed: 42, resortSlug: "breckenridge", mode: "time_trial", trailId: "osm:way:1:0", surface: "packed", physicsModel: "v2", physicsVersion: PHYSICS_VERSION, courseVersion: COURSE_VERSION, tickHz: 30, expiresAt: new Date(100000).toISOString(), environment: { powderDepthCm: 0, windSpeedMps: 0, morningIce: false, visibilityM: 20000, northSign: -1 } };
function freeze(t = ticket, model: "v1" | "v2" = "v2") { return freezeConditions(live, { status: "ready", ticket: t }, model, "breckenridge", t.mode, ticket.trailId, 0); }
test("Time Trial builds the signed calm packed world despite live powder and wind", () => {
  const frozen = freeze();
  assert.equal(frozen.ticket, ticket); assert.equal(frozen.conditions.surface, "packed");
  assert.equal(frozen.conditions.environment, ticket.environment); assert.equal(frozen.conditions.weatherDefault, 0);
});
test("Daily freezes morning world and server-selected trail over daytime selection", () => {
  const morning = { ...ticket, mode: "score_attack" as const, trailId: "daily-line", conditionsDate: "2026-09-05", environment: { ...ticket.environment!, morningIce: true } };
  const frozen = freeze(morning);
  assert.equal(frozen.trailId, "daily-line"); assert.equal(frozen.conditions.environment?.morningIce, true);
  assert.match(frozen.conditions.stamp, /2026-09-05/);
});
test("override, old versions, wrong resort and wrong TT trail remain offline", () => {
  assert.equal(freeze(ticket, "v1").ticket, null);
  for (const bad of [{ ...ticket, physicsVersion: 1 }, { ...ticket, courseVersion: 1 }, { ...ticket, tickHz: 20 }, { ...ticket, resortSlug: "heavenly" }, { ...ticket, trailId: "wrong" }]) assert.equal(freeze(bad).ticket, null);
});
