import { rankedTerrain } from "./ranked-terrain";
import { FIXED_DT } from "../core/clock";
import { resetRankedStart } from "../core/ranked-start";
import { createSimulation, stepSimulation } from "../core/simulation";
import type { InputFrame, SimulationWorld } from "../core/types";
import { MAX_INPUT_BYTES, readInputTick } from "../replay/input-tape";
import { GhostRecorder } from "../replay/recorder";
import type { DecodedGhost } from "../replay/codec";
import { createWorld } from "../terrain/obstacles";
import type { RunTicketPayload } from "./run-ticket";
import { simulationConfigForTicket } from "./validate-run";

export function rankedWorld(ticket: RunTicketPayload): SimulationWorld {
  const terrain = rankedTerrain(ticket.resortSlug);
  return createWorld(terrain.profile, ticket.seed, terrain, simulationConfigForTicket(ticket));
}

export interface InputReplayResult { accepted: boolean; reason?: string; score?: number; timeMs?: number }

/** Re-step the same core and DEM from server-selected spawn, compare every recorded field. */
export function replayInputs(
  ticket: RunTicketPayload, tape: Uint8Array, ghost: DecodedGhost,
  world: SimulationWorld = rankedWorld(ticket),
): InputReplayResult {
  const reject = (reason: string): InputReplayResult => ({ accepted: false, reason });
  if (!tape.length || tape.length % 4 || tape.length > MAX_INPUT_BYTES) return reject("Invalid input tape length");
  const runs = world.terrain.realRuns;
  const selected = runs?.findIndex(run => run.id === ticket.trailId) ?? -1;
  if (selected < 0) return reject("Signed trail is absent from terrain");
  const state = createSimulation(world.profile, ticket.seed, world.terrain);
  state.selectedTrail = selected;
  resetRankedStart(state, world);
  const recorder = new GhostRecorder(world.terrain);
  recorder.begin(0); recorder.sample(state, 0);
  const input: InputFrame = { steer: 0, tuck: 0, brake: 0, jumpHeld: false, jumpPressed: false, restartPressed: false, trailPressed: false };
  const ticks = tape.length / 4;
  for (let tick = 0; tick < ticks; tick++) {
    if (tape[tick * 4] === 128 || tape[tick * 4 + 3] > 1) return reject("Noncanonical input");
    readInputTick(tape, tick, input);
    stepSimulation(state, input, FIXED_DT, world);
    recorder.sample(state, state.time);
    if (state.finished && tick !== ticks - 1) return reject("Input continues after finish");
  }
  if (!state.finished) return reject("Input never reaches signed finish");
  const expected = recorder.finish()!;
  if (expected.length !== ghost.samples.length) return reject("Recorded sample count differs from input replay");
  for (let i = 0; i < expected.length; i++) {
    const a = expected[i], b = ghost.samples[i];
    if (a.tick !== b.tick || a.xCm !== b.xCm || a.zCm !== b.zCm ||
        a.groundOffsetCm !== b.groundOffsetCm || a.yaw !== b.yaw ||
        a.speedCms !== b.speedCms || a.poseFlags !== b.poseFlags) return reject(`Recorded sample ${i} differs from input replay`);
  }
  return { accepted: true, score: Math.round(state.score), timeMs: Math.round(ticks * FIXED_DT * 1000) };
}
