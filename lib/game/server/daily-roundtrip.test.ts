import assert from "node:assert/strict";
import test from "node:test";
import { handleCreateSession, type SessionResponseBody } from "./handlers/sessions";
import { handleSubmitRun } from "./handlers/runs";
import { testKeyring } from "./__fixtures__/run";
import { verifyTicket } from "./run-ticket";
import { createSlidingWindowLimiter } from "./rate-limit";
import { lockMorningConditions, type MorningStore, type RankedConditions } from "./ranked-conditions";
import { rankedTerrain } from "./ranked-terrain";
import { replayInputs } from "./replay-inputs";
import { createWorld } from "../terrain/obstacles";
import { simulationConfigForConditions } from "../runtime/physics-selection";
import { createSimulation, stepSimulation } from "../core/simulation";
import { resetRankedStart } from "../core/ranked-start";
import { FIXED_DT } from "../core/clock";
import { InputTapeRecorder } from "../replay/input-tape";
import { GhostRecorder } from "../replay/recorder";
import { encodeGhost, decodeGhost } from "../replay/codec";
import { pointAtArcLength } from "../terrain/real-course";
import type { RunInsert } from "./run-repository";

const request = (endpoint: string, body: unknown) => new Request(`https://example.test/api/drop-in/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("Daily Line real issuance and replay accept a full run under immutable morning weather, rejecting changed signed weather", async t => {
  const slug = "breckenridge", keys = testKeyring(), terrain = rankedTerrain(slug), requestedRun = terrain.realRuns![1];
  const morning = Date.parse("2026-09-05T13:00:00Z");
  let now = Date.parse("2026-09-06T01:00:00Z"); // Same resort-local date, after UTC midnight.
  const rows = new Map<string, RankedConditions>();
  const store: MorningStore = {
    read: async (resort, date) => structuredClone(rows.get(`${resort}/${date}`) ?? null),
    insertOnce: async (resort, date, value) => { const key = `${resort}/${date}`; if (!rows.has(key)) rows.set(key, structuredClone(value)); },
  };
  const captured: RankedConditions = { surface: "packed", conditionsDate: "2026-09-05", environment: { powderDepthCm: 25, windSpeedMps: 8, morningIce: true, visibilityM: 1600, northSign: 1 } };
  await lockMorningConditions(slug, morning, store, async () => captured);
  // A second capture cannot replace the persisted snapshot, even during the capture hour.
  assert.deepEqual(await lockMorningConditions(slug, morning, store, async () => { throw new Error("must not recapture"); }), captured);
  const sessionResponse = await handleCreateSession(request("sessions", { resortSlug: slug, mode: "score_attack", trailId: requestedRun.id, surface: "powder", physicsModel: "v1" }), {
    keyring: () => keys, currentUserId: async () => null, now: () => now,
    limiter: createSlidingWindowLimiter({ limit: 100, windowMs: 60000 }),
    dailyConditions: (resort, timestamp) => lockMorningConditions(resort, timestamp, store, async () => { throw new Error("evening issuance must read morning snapshot"); }),
  });
  assert.equal(sessionResponse.status, 201, sessionResponse.status === 201 ? undefined : await sessionResponse.text());
  const session = await sessionResponse.json() as SessionResponseBody;
  const ticket = verifyTicket(session.ticket, keys, { now });
  assert.equal(ticket.mode, "score_attack"); assert.equal(ticket.physicsModel, "v2");
  assert.equal(ticket.surface, captured.surface); assert.deepEqual(ticket.environment, captured.environment);
  assert.equal(ticket.conditionsDate, "2026-09-05"); assert.notEqual(ticket.conditionsDate, new Date(now).toISOString().slice(0, 10));
  assert.deepEqual(session.environment, ticket.environment);
  const selected = terrain.realRuns!.findIndex(run => run.id === ticket.trailId), run = terrain.realRuns![selected];
  assert.ok(run);
  const world = createWorld(terrain.profile, ticket.seed, terrain, { ...simulationConfigForConditions(ticket), allowLifts: false });
  const state = createSimulation(world.profile, ticket.seed, terrain); state.selectedTrail = selected; resetRankedStart(state, world);
  assert.equal(state.time, 0); assert.equal(state.courseProgress, 0);
  const inputTape = new InputTapeRecorder(), recorder = new GhostRecorder(terrain);
  recorder.begin(0); recorder.sample(state, 0);
  for (let tick = 0; tick < 20000 && !state.finished; tick++) {
    const target = pointAtArcLength(run.points, state.courseProgress + 30);
    const heading = Math.atan2(target.x - state.pos.x, target.z - state.pos.z);
    const angle = Math.atan2(Math.sin(heading - state.yaw), Math.cos(heading - state.yaw));
    const input = { steer: Math.max(-1, Math.min(1, angle * 1.8)), tuck: 0.8, brake: 0, jumpHeld: false, jumpPressed: false, restartPressed: false, trailPressed: false };
    inputTape.record(input); stepSimulation(state, input, FIXED_DT, world); recorder.sample(state, state.time);
  }
  assert.equal(state.finished, true, `${run.name} ${state.courseProgress}/${run.lengthM}`);
  const tape = inputTape.finish()!, samples = recorder.finish()!;
  const ghost = encodeGhost(samples, { physicsVersion: ticket.physicsVersion, courseVersion: ticket.courseVersion, seed: ticket.seed, sampleHz: 30 });
  const decoded = decodeGhost(ghost), timeMs = Math.round(tape.length / 4 / 120 * 1000), score = Math.round(state.score);
  assert.equal(replayInputs(ticket, tape, decoded).accepted, true);
  assert.equal(replayInputs({ ...ticket, environment: { ...ticket.environment!, windSpeedMps: 0 } }, tape, decoded).accepted, false, "weather affects deterministic replay, not just the signature");
  const startedAt = now; now += timeMs;
  const body = { ticket: session.ticket, ghost: Buffer.from(ghost).toString("base64"), inputTape: Buffer.from(tape).toString("base64"), tickHz: 30, timeMs, score, startedAt: new Date(startedAt).toISOString(), finishedAt: new Date(now).toISOString() };
  const inserted: RunInsert[] = [];
  const deps = { keyring: () => keys, currentUserId: async () => null, now: () => now, limiter: createSlidingWindowLimiter({ limit: 100, windowMs: 60000 }), writer: () => ({ resortIdBySlug: async () => "11111111-1111-4111-8111-111111111111", insertRun: async (value: RunInsert) => { inserted.push(value); return { ok: true as const, id: "22222222-2222-4222-8222-222222222222", createdAt: new Date(now).toISOString() }; } }) };
  const accepted = await handleSubmitRun(request("runs", body), deps);
  assert.equal(accepted.status, 201, accepted.status === 201 ? undefined : await accepted.text());
  assert.equal(inserted.length, 1); assert.equal(inserted[0].mode, "score_attack");
  assert.equal(inserted[0].conditionsDate, captured.conditionsDate); assert.deepEqual(inserted[0].conditionsSnapshot, captured.environment);
  assert.equal(inserted[0].score, score); assert.deepEqual(inserted[0].inputTape, tape);
  const segments = session.ticket.split("."), payload = JSON.parse(Buffer.from(segments[1], "base64url").toString());
  payload.environment.windSpeedMps = 0; segments[1] = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const rejected = await handleSubmitRun(request("runs", { ...body, ticket: segments.join(".") }), deps);
  assert.equal(rejected.status, 401); assert.equal(inserted.length, 1, "tampered weather never reaches persistence");
  t.diagnostic(`${run.name}; seed ${ticket.seed}; ${tape.length / 4} fixed ticks; ${timeMs}ms; score ${score}; Daily HTTP201; tampered signature401`);
});
