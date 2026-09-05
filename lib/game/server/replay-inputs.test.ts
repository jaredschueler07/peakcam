import assert from "node:assert/strict";
import { test } from "node:test";
import { createSimulation, stepSimulation } from "../core/simulation";
import { resetSimulationOnTerrain } from "../core/run-lifecycle";
import { FIXED_DT } from "../core/clock";
import { InputTapeRecorder } from "../replay/input-tape";
import { GhostRecorder } from "../replay/recorder";
import { decodeGhost, encodeGhost } from "../replay/codec";
import { COURSE_VERSION, PHYSICS_VERSION } from "../config/versions";
import { pointAtArcLength } from "../terrain/real-course";
import { rankedWorld, replayInputs } from "./replay-inputs";
import { fixedTrialConditions } from "./ranked-conditions";
import type { RunTicketPayload } from "./run-ticket";
import { rankedTerrain } from "./ranked-terrain";

const terrain = rankedTerrain("breckenridge");
const run = terrain.realRuns![1];
const ticket: RunTicketPayload = { ...fixedTrialConditions(), resortSlug: "breckenridge", mode: "time_trial", trailId: run.id!, seed: 123,
  physicsModel: "v2", physicsVersion: PHYSICS_VERSION, courseVersion: COURSE_VERSION, nonce: "test", iat: 0, exp: 10000000 };

function record() {
  const world = rankedWorld(ticket);
  const state = createSimulation(world.profile, ticket.seed, world.terrain);
  state.selectedTrail = world.terrain.realRuns!.findIndex(r => r.id === ticket.trailId);
  resetSimulationOnTerrain(state, world.terrain);
  const recorder = new GhostRecorder(world.terrain); recorder.begin(0); recorder.sample(state, 0);
  const inputs = new InputTapeRecorder();
  for (let tick = 0; tick < 20000 && !state.finished; tick++) {
    const target = pointAtArcLength(run.points, state.courseProgress + 30);
    const heading = Math.atan2(target.x - state.pos.x, target.z - state.pos.z);
    const angle = Math.atan2(Math.sin(heading - state.yaw), Math.cos(heading - state.yaw));
    const input = { steer: Math.max(-1, Math.min(1, angle * 1.8)), tuck: 1, brake: 0,
      jumpHeld: false, jumpPressed: false, restartPressed: false, trailPressed: false };
    inputs.record(input); stepSimulation(state, input, FIXED_DT, world); recorder.sample(state, state.time);
  }
  assert.ok(state.finished, `autopilot did not finish ${run.name}: ${state.courseProgress}/${run.lengthM}`);
  const ghost = decodeGhost(encodeGhost(recorder.finish()!, { physicsVersion: PHYSICS_VERSION, courseVersion: COURSE_VERSION, sampleHz: 30, seed: ticket.seed }));
  return { ghost, tape: inputs.finish()!, score: Math.round(state.score) };
}
const recorded = record();

test("v2 recorded inputs on committed real terrain replay exactly and reach the finish", () => {
  const result = replayInputs(ticket, recorded.tape, recorded.ghost);
  assert.equal(result.accepted, true, result.reason);
  assert.equal(result.score, recorded.score);
});
test("v2 replay rejects a changed input and a changed displayed ghost", () => {
  const tape = recorded.tape.slice(); tape[0] = 127;
  assert.equal(replayInputs(ticket, tape, recorded.ghost).accepted, false);
  const ghost = structuredClone(recorded.ghost); ghost.samples[5].xCm += 1;
  assert.equal(replayInputs(ticket, recorded.tape, ghost).accepted, false);
});
test("v2 replay rejects a truncated tape, extra ticks, and changed signed conditions", () => {
  assert.equal(replayInputs(ticket, recorded.tape.slice(0, -4), recorded.ghost).accepted, false);
  const extra = new Uint8Array(recorded.tape.length + 4); extra.set(recorded.tape);
  assert.equal(replayInputs(ticket, extra, recorded.ghost).accepted, false);
  assert.equal(replayInputs({ ...ticket, environment: { ...ticket.environment!, windSpeedMps: 40 } }, recorded.tape, recorded.ghost).accepted, false);
});

import { handleSubmitRun } from "./handlers/runs";
import { issueTicket, activeKeyOf } from "./run-ticket";
import { testKeyring } from "./__fixtures__/run";
import { createSlidingWindowLimiter } from "./rate-limit";
import type { RunInsert } from "./run-repository";

test("ranked HTTP accepts the real v2 run and rejects score, input, and absent-tape tampering", async () => {
  const now = Date.UTC(2026, 8, 5, 18);
  const keys = testKeyring();
  const token = issueTicket(ticket, { ...activeKeyOf(keys), now, ttlMs: 1800000 });
  const timeMs = Math.round(recorded.tape.length / 4 / 120 * 1000);
  const body = {
    ticket: token,
    ghost: Buffer.from(encodeGhost(recorded.ghost.samples, recorded.ghost.meta)).toString("base64"),
    inputTape: Buffer.from(recorded.tape).toString("base64"),
    tickHz: 30, timeMs, score: recorded.score,
    startedAt: new Date(now - timeMs).toISOString(), finishedAt: new Date(now).toISOString(),
  };
  const inserted: RunInsert[] = [];
  const deps = { keyring: () => keys, now: () => now, currentUserId: async () => null,
    limiter: createSlidingWindowLimiter({ limit: 100, windowMs: 60000 }),
    writer: () => ({ resortIdBySlug: async () => "11111111-1111-4111-8111-111111111111", insertRun: async (run: RunInsert) => {
      inserted.push(run); return { ok: true as const, id: "22222222-2222-4222-8222-222222222222", createdAt: new Date(now).toISOString() };
    } }),
  };
  const submit = (value: unknown) => handleSubmitRun(new Request("https://example.test/api/drop-in/runs", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value),
  }), deps);
  const honest = await submit(body);
  assert.equal(honest.status, 201, await honest.text());
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].score, recorded.score);
  assert.deepEqual(inserted[0].inputTape, recorded.tape);
  assert.equal((await submit({ ...body, score: recorded.score + 1 })).status, 422);
  const changed = recorded.tape.slice(); changed[0] = 127;
  assert.equal((await submit({ ...body, inputTape: Buffer.from(changed).toString("base64") })).status, 422);
  assert.equal((await submit({ ...body, inputTape: undefined })).status, 422);
  assert.equal(inserted.length, 1, "tampering must never reach persistence");
});
