import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import type { DropInResortSlug } from "../config/schema";
import { createProceduralWorld } from "../terrain/obstacles";
import { FIXED_DT, FixedStepClock } from "./clock";
import { createSimulation, stepSimulation } from "./simulation";
import type { InputFrame, SimulationState } from "./types";
import { simulationConfig, type SurfaceKind } from "./config";

const slugs: DropInResortSlug[] = ["ski-portillo", "breckenridge", "heavenly"];
const EMPTY_INPUT: InputFrame = {
  steer: 0, tuck: 0, brake: 0, jumpHeld: false, jumpPressed: false,
  restartPressed: false, trailPressed: false,
};

function traceInput(name: string, step: number): InputFrame {
  let steer = 0;
  let tuck = 0;
  let brake = 0;
  let jumpHeld = false;
  if (name === "straight-tuck-run") {
    tuck = 1;
    jumpHeld = step >= 720 && step < 768;
  } else if (name === "slalom-weave") {
    tuck = 1;
    steer = Math.floor(step / 54) % 2 === 0 ? -1 : 1;
  } else {
    jumpHeld = (step >= 180 && step < 228) ||
      (step >= 900 && step < 948) || (step >= 1620 && step < 1668);
    tuck = step < 3000 ? 1 : 0;
    if (step >= 1800) steer = Math.floor((step - 1800) / 54) % 2 === 0 ? -1 : 1;
    brake = step >= 3000 && step < 3300 ? 1 : 0;
  }
  return { ...EMPTY_INPUT, steer, tuck, brake, jumpHeld };
}

function quantize(value: number): number {
  const result = Math.round(value * 1_000_000);
  return Object.is(result, -0) ? 0 : result;
}

function stateHash(state: SimulationState): string {
  const values = [state.pos.x, state.pos.y, state.pos.z, state.vel.x, state.vel.y,
    state.vel.z, state.yaw, state.score].map(quantize);
  return createHash("sha256").update(values.join(",")).digest("hex");
}

for (const slug of slugs) {
  test(`new TypeScript core replays all v1 traces bit-identically for ${slug}`, () => {
    const fixture = JSON.parse(readFileSync(path.join(
      process.cwd(), "tests", "fixtures", "drop-in-v1", `${slug}.json`,
    ), "utf8"));
    const profile = DROP_IN_GAME_PROFILES[slug];

    for (const trace of fixture.traces) {
      const world = createProceduralWorld(profile, profile.seed, simulationConfig("packed"));
      const state = createSimulation(profile, profile.seed);
      let crashCount = 0;
      let wasCrashed = false;
      let hashIndex = 0;
      for (let step = 0; step < trace.steps; step += 1) {
        stepSimulation(state, traceInput(trace.name, step), trace.dt, world);
        const crashed = state.crash > 0;
        if (crashed && !wasCrashed) crashCount += 1;
        wasCrashed = crashed;
        if ((step + 1) % 120 === 0) {
          assert.strictEqual(stateHash(state), trace.hashes[hashIndex].hash,
            `${slug}/${trace.name} diverged at step ${step + 1}`);
          hashIndex += 1;
        }
      }
      assert.strictEqual(state.time, trace.final.time);
      assert.strictEqual(state.score, trace.final.score);
      assert.strictEqual(state.distance, trace.final.distance);
      assert.strictEqual(crashCount, trace.crashCount);
    }
  });
}

test("10k simulation steps are identical under three render pacing patterns", () => {
  const originalRandom = Math.random;
  const originalNow = Date.now;
  Math.random = () => { throw new Error("simulation used Math.random"); };
  Date.now = () => { throw new Error("simulation used Date.now"); };
  try {
    const patterns = [[FIXED_DT], [FIXED_DT * 2], [FIXED_DT * 3, FIXED_DT * 5]];
    const hashes = patterns.map((pattern) => {
      const profile = DROP_IN_GAME_PROFILES.heavenly;
      const world = createProceduralWorld(profile, profile.seed, simulationConfig("packed"));
      const state = createSimulation(profile, profile.seed);
      const clock = new FixedStepClock();
      let step = 0;
      let frame = 0;
      while (step < 10_000) {
        clock.advance(pattern[frame % pattern.length], () => {
          stepSimulation(state, traceInput("jump-crash-sequence", step), FIXED_DT, world);
          step += 1;
        });
        frame += 1;
      }
      assert.strictEqual(step, 10_000);
      return stateHash(state);
    });
    assert.deepStrictEqual(hashes, [hashes[0], hashes[0], hashes[0]]);
  } finally {
    Math.random = originalRandom;
    Date.now = originalNow;
  }
});

for (const surface of ["powder", "packed", "firm", "ice"] as const satisfies readonly SurfaceKind[]) {
  test(`${surface} surface remains deterministic across render pacing`, () => {
    const profile = DROP_IN_GAME_PROFILES.heavenly;
    const hashes = [[FIXED_DT], [FIXED_DT * 2, FIXED_DT * 5]].map((pattern) => {
      const world = createProceduralWorld(profile, profile.seed, simulationConfig(surface));
      const state = createSimulation(profile, profile.seed);
      const clock = new FixedStepClock();
      let step = 0, frame = 0;
      while (step < 2_000) {
        clock.advance(pattern[frame++ % pattern.length], () => {
          if (step < 2_000) stepSimulation(state, traceInput("slalom-weave", step), FIXED_DT, world);
          step += 1;
        });
      }
      return stateHash(state);
    });
    assert.equal(hashes[0], hashes[1]);
  });
}
