#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The retired iframe is no longer executable. Replay its frozen fixtures through
// the pure TypeScript compatibility integrator; never rewrite expected v1 data.
import { DROP_IN_GAME_PROFILES as rawProfiles } from "../lib/game/config/profiles.ts";
import { createProceduralWorld } from "../lib/game/terrain/obstacles.ts";
import { createSimulation, stepSimulation } from "../lib/game/core/simulation.ts";
import { simulationConfig } from "../lib/game/core/config.ts";
import { mulberry32 } from "../lib/game/core/rng.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const V1_RESORT_SLUGS = [
  "ski-portillo",
  "breckenridge",
  "heavenly",
];

export const PHYSICS_V2_SURFACES = ["powder", "packed", "firm", "ice"];
export const PHYSICS_V2_TAPES = ["slalom", "jump"];

const FIXED_DT = 1 / 120;
const TRACE_STEPS = 3600;
const HASH_INTERVAL_STEPS = 120;
const TERRAIN_GRID_SIZE = 33;
const TERRAIN_X_MIN = -800;
const TERRAIN_X_MAX = 800;
const TERRAIN_Z_MIN = 0;
const TERRAIN_Z_MAX = 4000;
const RANDOM_POINT_COUNT = 200;

function createEngineRuntime(profile) {
  const world = createProceduralWorld(profile, profile.seed, simulationConfig("packed", "v1"));
  const state = createSimulation(profile, profile.seed, world.terrain);
  return {
    state, mulberry32,
    terrainHeight: (x, z) => world.terrain.height(x, z),
    terrainNormal: (x, z, out) => world.terrain.normal(x, z, out),
    step(keys, dt) {
      stepSimulation(state, {
        steer: (keys.d ? 1 : 0) - (keys.a ? 1 : 0),
        tuck: keys.w ? 1 : 0, brake: keys.s ? 1 : 0,
        jumpHeld: Boolean(keys[" "]), jumpPressed: false,
        restartPressed: false, trailPressed: false,
      }, dt, world);
    },
  };
}

const inputTraces = [
  {
    name: "straight-tuck-run",
    input(step) {
      return { w: true, " ": step >= 720 && step < 768 };
    },
  },
  {
    name: "slalom-weave",
    input(step) {
      const phase = Math.floor(step / 54) % 2;
      return { w: true, a: phase === 0, d: phase === 1 };
    },
  },
  {
    name: "jump-crash-sequence",
    input(step) {
      const jumpHeld = (step >= 180 && step < 228) ||
        (step >= 900 && step < 948) ||
        (step >= 1620 && step < 1668);
      const weavePhase = Math.floor((step - 1800) / 54) % 2;
      return {
        w: step < 3000,
        a: step >= 1800 && weavePhase === 0,
        d: step >= 1800 && weavePhase === 1,
        s: step >= 3000 && step < 3300,
        " ": jumpHeld,
      };
    },
  },
];

function quantize(value) {
  const quantized = Math.round(value * 1_000_000);
  return Object.is(quantized, -0) ? 0 : quantized;
}

function stateHash(state) {
  const values = [
    state.pos.x,
    state.pos.y,
    state.pos.z,
    state.vel.x,
    state.vel.y,
    state.vel.z,
    state.yaw,
    state.score,
  ].map(quantize);
  return createHash("sha256").update(values.join(",")).digest("hex");
}

function sampleTerrain(runtime, profile) {
  const normal = { x: 0, y: 1, z: 0 };
  const grid = [];
  for (let zIndex = 0; zIndex < TERRAIN_GRID_SIZE; zIndex += 1) {
    const z = TERRAIN_Z_MIN +
      (zIndex / (TERRAIN_GRID_SIZE - 1)) * (TERRAIN_Z_MAX - TERRAIN_Z_MIN);
    for (let xIndex = 0; xIndex < TERRAIN_GRID_SIZE; xIndex += 1) {
      const x = TERRAIN_X_MIN +
        (xIndex / (TERRAIN_GRID_SIZE - 1)) * (TERRAIN_X_MAX - TERRAIN_X_MIN);
      runtime.terrainNormal(x, z, normal);
      grid.push({
        x,
        z,
        height: runtime.terrainHeight(x, z),
        normal: [normal.x, normal.y, normal.z],
      });
    }
  }

  const random = [];
  const rng = runtime.mulberry32(profile.seed ^ 0xa5a5a5a5);
  for (let index = 0; index < RANDOM_POINT_COUNT; index += 1) {
    const x = TERRAIN_X_MIN + rng() * (TERRAIN_X_MAX - TERRAIN_X_MIN);
    const z = TERRAIN_Z_MIN + rng() * (TERRAIN_Z_MAX - TERRAIN_Z_MIN);
    runtime.terrainNormal(x, z, normal);
    random.push({
      x,
      z,
      height: runtime.terrainHeight(x, z),
      normal: [normal.x, normal.y, normal.z],
    });
  }

  return { grid, random };
}

function captureTrace(profile, trace) {
  const runtime = createEngineRuntime(profile);
  const hashes = [];
  let crashCount = 0;
  let wasCrashed = false;

  for (let step = 0; step < TRACE_STEPS; step += 1) {
    runtime.step(trace.input(step), FIXED_DT);
    const isCrashed = runtime.state.crash > 0;
    if (isCrashed && !wasCrashed) crashCount += 1;
    wasCrashed = isCrashed;
    if ((step + 1) % HASH_INTERVAL_STEPS === 0) {
      hashes.push({ step: step + 1, hash: stateHash(runtime.state) });
    }
  }

  return {
    name: trace.name,
    steps: TRACE_STEPS,
    dt: FIXED_DT,
    hashes,
    final: {
      time: runtime.state.time,
      score: runtime.state.score,
      distance: runtime.state.distance,
    },
    crashCount,
  };
}

export function captureResortFixture(resortSlug) {
  const profile = rawProfiles[resortSlug];
  if (!profile) throw new Error(`Unknown v1 resort: ${resortSlug}`);
  const terrainRuntime = createEngineRuntime(profile);

  return {
    formatVersion: 1,
    source: "public/drop-in/engine.html",
    resortSlug,
    terrain: {
      bounds: {
        x: [TERRAIN_X_MIN, TERRAIN_X_MAX],
        z: [TERRAIN_Z_MIN, TERRAIN_Z_MAX],
      },
      gridSize: TERRAIN_GRID_SIZE,
      randomSeed: profile.seed ^ 0xa5a5a5a5,
      randomPointCount: RANDOM_POINT_COUNT,
      ...sampleTerrain(terrainRuntime, profile),
    },
    traces: inputTraces.map((trace) => captureTrace(profile, trace)),
  };
}

export function serializeFixture(fixture) {
  return `${JSON.stringify(fixture, null, 2)}\n`;
}

function physicsV2Input(tape, step) {
  if (tape === "slalom") {
    return {
      steer: Math.floor(step / 54) % 2 === 0 ? -1 : 1,
      tuck: 1,
      brake: 0,
      jumpHeld: false,
      jumpPressed: false,
      restartPressed: false,
      trailPressed: false,
    };
  }

  const jumpHeld = (step >= 180 && step < 228) ||
    (step >= 900 && step < 948) || (step >= 1620 && step < 1668);
  return {
    steer: step >= 1800
      ? (Math.floor((step - 1800) / 54) % 2 === 0 ? -1 : 1)
      : 0,
    tuck: step < 3000 ? 1 : 0,
    brake: step >= 3000 && step < 3300 ? 1 : 0,
    jumpHeld,
    jumpPressed: false,
    restartPressed: false,
    trailPressed: false,
  };
}

export async function capturePhysicsV2Fixture(surface, tape) {
  if (!PHYSICS_V2_SURFACES.includes(surface)) {
    throw new Error(`Unknown physicsV2 surface: ${surface}`);
  }
  if (!PHYSICS_V2_TAPES.includes(tape)) {
    throw new Error(`Unknown physicsV2 tape: ${tape}`);
  }

  const [{ DROP_IN_GAME_PROFILES }, { createProceduralWorld }, simulation, config] =
    await Promise.all([
      import("../lib/game/config/profiles.ts"),
      import("../lib/game/terrain/obstacles.ts"),
      import("../lib/game/core/simulation.ts"),
      import("../lib/game/core/config.ts"),
    ]);
  const profile = DROP_IN_GAME_PROFILES.heavenly;
  const world = createProceduralWorld(
    profile,
    profile.seed,
    config.simulationConfig(surface, "v2"),
  );
  const state = simulation.createSimulation(profile, profile.seed, world.terrain);
  const hashes = [];
  let crashCount = 0;
  let wasCrashed = false;

  for (let step = 0; step < TRACE_STEPS; step += 1) {
    simulation.stepSimulation(state, physicsV2Input(tape, step), FIXED_DT, world);
    const crashed = state.crash > 0;
    if (crashed && !wasCrashed) crashCount += 1;
    wasCrashed = crashed;
    if ((step + 1) % HASH_INTERVAL_STEPS === 0) {
      hashes.push({ step: step + 1, hash: stateHash(state) });
    }
  }

  return {
    formatVersion: 1,
    physicsModel: "v2",
    resortSlug: "heavenly",
    surface,
    tape,
    steps: TRACE_STEPS,
    dt: FIXED_DT,
    hashes,
    final: {
      time: state.time,
      score: state.score,
      distance: state.distance,
    },
    crashCount,
  };
}

export async function captureAllPhysicsV2Fixtures(outputDirectory = path.join(
  root,
  "lib",
  "game",
  "core",
  "fixtures",
  "physics-v2",
)) {
  mkdirSync(outputDirectory, { recursive: true });
  for (const surface of PHYSICS_V2_SURFACES) {
    for (const tape of PHYSICS_V2_TAPES) {
      const destination = path.join(outputDirectory, `${surface}-${tape}.json`);
      writeFileSync(
        destination,
        serializeFixture(await capturePhysicsV2Fixture(surface, tape)),
      );
    }
  }
}

export function captureAllFixtures(outputDirectory = path.join(
  root,
  "tests",
  "fixtures",
  "drop-in-v1",
)) {
  mkdirSync(outputDirectory, { recursive: true });
  for (const resortSlug of V1_RESORT_SLUGS) {
    const destination = path.join(outputDirectory, `${resortSlug}.json`);
    writeFileSync(destination, serializeFixture(captureResortFixture(resortSlug)));
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === invokedPath) {
  const args = process.argv.slice(2);
  const physicsIndex = args.indexOf("--physics");
  const physics = physicsIndex >= 0 ? args[physicsIndex + 1] : "v1";
  if (physics !== "v1" && physics !== "v2") {
    throw new Error(`Unknown --physics value: ${physics}`);
  }
  const loaderFlag = "--physics-v2-loader-active";
  if (physics === "v2" && !args.includes(loaderFlag)) {
    const result = spawnSync(process.execPath, [
      "--import", "tsx", fileURLToPath(import.meta.url), ...args, loaderFlag,
    ], { stdio: "inherit" });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  }
  const positional = args.filter((arg, index) =>
    index !== physicsIndex && index !== physicsIndex + 1 && arg !== loaderFlag);
  const outputDirectory = positional[0] ? path.resolve(positional[0]) : undefined;
  if (physics === "v2" && args.includes(loaderFlag)) {
    captureAllPhysicsV2Fixtures(outputDirectory).catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  } else if (physics === "v1") {
    captureAllFixtures(outputDirectory);
  }
}
