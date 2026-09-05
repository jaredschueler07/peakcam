import { handleSubmitRun } from "./handlers/runs";
import { issueTicket, activeKeyOf } from "./run-ticket";
import { testKeyring } from "./__fixtures__/run";
import { createSlidingWindowLimiter } from "./rate-limit";
import type { RunInsert } from "./run-repository";

import assert from "node:assert/strict";
import { test } from "node:test";
import { createSimulation, stepSimulation } from "../core/simulation";
import { resetRankedStart } from "../core/ranked-start";
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
import { CHUNK_SIZE, createWorld, getChunk } from "../terrain/obstacles";
import { simulationConfigForConditions } from "../runtime/physics-selection";

for (const [slug, index] of [["breckenridge", 1], ["heavenly", 2], ["ski-portillo", 2]] as const) for (const controller of ["keyboard", "touch"] as const) {
  const terrain = rankedTerrain(slug);
  const run = terrain.realRuns![index];
  const ticket: RunTicketPayload = { ...fixedTrialConditions(), resortSlug: slug, mode: "time_trial", trailId: run.id!, seed: 123,
    physicsModel: "v2", physicsVersion: PHYSICS_VERSION, courseVersion: COURSE_VERSION, nonce: "test", iat: 0, exp: 10000000 };

  function record() {
    // Construct the client world through the runtime config seam; replay builds its own server world.
    const world = createWorld(terrain.profile, ticket.seed, terrain, {
      ...simulationConfigForConditions(ticket), allowLifts: false,
    });
    const state = createSimulation(world.profile, ticket.seed, world.terrain);
    state.selectedTrail = world.terrain.realRuns!.findIndex(r => r.id === ticket.trailId);
    resetRankedStart(state, world);
    assert.equal(state.time, 0);
    assert.equal(state.courseProgress, 0, "full run starts at canonical top, never a debug arc offset");
    const recorder = new GhostRecorder(world.terrain); recorder.begin(0); recorder.sample(state, 0);
    const inputs = new InputTapeRecorder();
    for (let tick = 0; tick < 20000 && !state.finished; tick++) {
      const target = pointAtArcLength(run.points, state.courseProgress + 30);
      const heading = Math.atan2(target.x - state.pos.x, target.z - state.pos.z);
      const angle = Math.atan2(Math.sin(heading - state.yaw), Math.cos(heading - state.yaw));
      const input = { steer: controller === "keyboard" ? (Math.abs(angle) < 0.02 ? 0 : Math.sign(angle)) : Math.max(-1, Math.min(1, angle * 1.8)), tuck: controller === "keyboard" ? 1 : 0.8, brake: 0,
        jumpHeld: false, jumpPressed: false, restartPressed: false, trailPressed: false };
      inputs.record(input); stepSimulation(state, input, FIXED_DT, world); recorder.sample(state, state.time);
    }
    assert.ok(state.finished, `autopilot did not finish ${run.name}: ${state.courseProgress}/${run.lengthM}`);
    const ghost = decodeGhost(encodeGhost(recorder.finish()!, { physicsVersion: PHYSICS_VERSION, courseVersion: COURSE_VERSION, sampleHz: 30, seed: ticket.seed }));
    const tape = inputs.finish()!;
    const steering = new Set(Array.from(tape).filter((_, i) => i % 4 === 0));
    if (controller === "keyboard") assert.ok([...steering].every(value => value === 0 || value === 127 || value === 129));
    else assert.ok([...steering].some(value => value !== 0 && value !== 127 && value !== 129), "touch path exercises fractional steering");
    return { ghost, tape, score: Math.round(state.score) };
  }
  const recorded = record();

  test(`${slug}/${controller}: v2 recorded inputs on committed real terrain replay exactly and reach the finish`, (t) => {
    const result = replayInputs(ticket, recorded.tape, recorded.ghost);
    assert.equal(result.accepted, true, result.reason);
    assert.equal(result.score, recorded.score);
    t.diagnostic(`${run.name}: ${run.id}; ${Math.round(run.lengthM)}m; ${recorded.tape.length / 4} fixed ticks; ${result.timeMs}ms; score ${result.score}`);
  });
  test(`${slug}/${controller}: v2 replay rejects a changed input and a changed displayed ghost`, () => {
    const tape = recorded.tape.slice(); tape[0] = 127;
    assert.equal(replayInputs(ticket, tape, recorded.ghost).accepted, false);
    const ghost = structuredClone(recorded.ghost); ghost.samples[5].xCm += 1;
    assert.equal(replayInputs(ticket, recorded.tape, ghost).accepted, false);
  });
  test(`${slug}/${controller}: v2 replay rejects a truncated tape, extra ticks, and changed signed conditions`, () => {
    assert.equal(replayInputs(ticket, recorded.tape.slice(0, -4), recorded.ghost).accepted, false);
    const extra = new Uint8Array(recorded.tape.length + 4); extra.set(recorded.tape);
    assert.equal(replayInputs(ticket, extra, recorded.ghost).accepted, false);
    assert.equal(replayInputs({ ...ticket, environment: { ...ticket.environment!, windSpeedMps: 40 } }, recorded.tape, recorded.ghost).accepted, false);
  });


  test(`${slug}/${controller}: ranked HTTP accepts the real v2 run and rejects score, input, and absent-tape tampering`, async () => {
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

}

for (const slug of ["breckenridge", "heavenly", "ski-portillo"] as const) test(`${slug}: client and validator share mapped forest collision placement`, () => {
  const terrain = rankedTerrain(slug);
  const ticket: RunTicketPayload = { ...fixedTrialConditions(), resortSlug: slug, mode: "time_trial", trailId: terrain.realRuns![0].id!, seed: 123,
    physicsModel: "v2", physicsVersion: PHYSICS_VERSION, courseVersion: COURSE_VERSION, nonce: "forest", iat: 0, exp: 10000000 };
  const client = createWorld(terrain.profile, ticket.seed, terrain, { ...simulationConfigForConditions(ticket), allowLifts: false });
  const server = rankedWorld(ticket);
  assert.ok(terrain.treeSites, "committed source forest inventory must be loaded, including empty Portillo forest");
  for (const site of terrain.treeSites) {
    const cx = Math.floor(site.x / CHUNK_SIZE), cz = Math.floor(site.z / CHUNK_SIZE);
    const a = getChunk(client, cx, cz), b = getChunk(server, cx, cz);
    assert.deepEqual(a, b);
    assert.ok(a.some(tree => tree.type === "tree" && tree.x === site.x && tree.z === site.z && tree.y === site.y));
  }
});
