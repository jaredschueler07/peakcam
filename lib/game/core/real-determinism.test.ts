import assert from "node:assert/strict";
import { brotliDecompressSync } from "node:zlib";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import { FIXED_DT, FixedStepClock } from "./clock";
import { createSimulation, stepSimulation } from "./simulation";
import { createWorld } from "../terrain/obstacles";
import { createTerrainSource } from "../terrain/terrain-source";
import type { TerrainMeta, TrailsFile } from "../terrain/formats";
import type { InputFrame, SimulationState } from "./types";

const input: InputFrame = { steer: 0.16, tuck: 1, brake: 0, jumpHeld: false,
  jumpPressed: false, restartPressed: false, trailPressed: false };
const hash = (state: SimulationState) => createHash("sha256").update([
  state.pos.x, state.pos.y, state.pos.z, state.vel.x, state.vel.y, state.vel.z,
  state.yaw, state.score,
].map((value) => Math.round(value * 1e6)).join(",")).digest("hex");

for (const slug of ["ski-portillo", "breckenridge", "heavenly"] as const) {
  test(`real ${slug} simulation is identical across render frame pacings`, () => {
    const profile = DROP_IN_GAME_PROFILES[slug];
    const dir = path.join(process.cwd(), "public/game/terrain");
    const packed = brotliDecompressSync(readFileSync(path.join(dir, `${slug}.height.u16.br`)));
    const source = createTerrainSource({ profile, mode: "real", assets: {
      heightfield: packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength) as ArrayBuffer,
      meta: JSON.parse(readFileSync(path.join(dir, `${slug}.meta.json`), "utf8")) as TerrainMeta,
      trails: JSON.parse(readFileSync(path.join(dir, `${slug}.trails.json`), "utf8")) as TrailsFile,
    } });
    const results = [[FIXED_DT], [FIXED_DT * 2, FIXED_DT * 5]].map((pattern) => {
      const world = createWorld(profile, profile.seed, source.sampler);
      const state = createSimulation(profile, profile.seed, source.sampler);
      const clock = new FixedStepClock(); let steps = 0; let frame = 0;
      while (steps < 1200) {
        clock.advance(pattern[frame++ % pattern.length], () => {
          if (steps < 1200) stepSimulation(state, input, FIXED_DT, world);
          steps += 1;
        });
      }
      assert.equal(source.kind, "real");
      assert.equal(state.selectedTrail, 0);
      return hash(state);
    });
    assert.equal(results[0], results[1]);
  });
}
