#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as THREE from "../public/drop-in/three.module.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const enginePath = path.join(root, "public", "drop-in", "engine.html");
const engineSource = readFileSync(enginePath, "utf8");

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

function findBalancedEnd(source, start, open, close) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === open) depth += 1;
    if (char === close) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  throw new Error(`Unbalanced ${open}${close} block at offset ${start}`);
}

function extractObjectInitializer(constName) {
  const marker = `const ${constName} =`;
  const declarationStart = engineSource.indexOf(marker);
  if (declarationStart < 0) throw new Error(`Missing ${marker}`);
  const objectStart = engineSource.indexOf("{", declarationStart + marker.length);
  const objectEnd = findBalancedEnd(engineSource, objectStart, "{", "}");
  return engineSource.slice(objectStart, objectEnd);
}

function extractFunction(functionName) {
  const marker = `function ${functionName}`;
  const functionStart = engineSource.indexOf(marker);
  if (functionStart < 0) throw new Error(`Missing ${marker}`);
  const bodyStart = engineSource.indexOf("{", functionStart + marker.length);
  const functionEnd = findBalancedEnd(engineSource, bodyStart, "{", "}");
  return engineSource.slice(functionStart, functionEnd);
}

const rawProfiles = Function(
  `"use strict"; return (${extractObjectInitializer("RESORT_PROFILES")});`,
)();

export function readV1ResortProfiles() {
  return structuredClone(rawProfiles);
}

const extractedFunctions = [
  "hashInt",
  "mulberry32",
  "vnoise",
  "fbm",
  "trailCenter",
  "trailField",
  "nearestTrail",
  "rampHeight",
  "baseHeight",
  "terrainHeight",
  "terrainNormal",
  "getChunk",
  "forEachObstacleNear",
  "gateAt",
  "liftX",
  "towerBaseY",
  "cableY",
  "resetRun",
  "physics",
  "onLand",
  "doCrash",
  "bumpCombo",
  "addScore",
  "checkGates",
].map(extractFunction).join("\n\n");

function createEngineRuntime(profile) {
  const buildRuntime = Function(
    "THREE",
    "PROFILE",
    `
      "use strict";
      const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
      const clamp01 = (v) => v < 0 ? 0 : (v > 1 ? 1 : v);
      const lerp = (a, b, t) => a + (b - a) * t;
      const smoothstep = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
      const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
      const TAU = Math.PI * 2;
      const hash2 = (x, y) => hashInt(x, y) / 4294967295;

      const FALL = PROFILE.fall;
      const RELIEF = PROFILE.relief;
      const NOISE_OFF = (() => {
        const rng = mulberry32(PROFILE.seed);
        return { x: 1000 + rng() * 90000, z: 1000 + rng() * 90000 };
      })();
      const TRAILS = PROFILE.trails.map((trail) => ({ ...trail }));
      const FOREST = PROFILE.forest;
      const _n = new THREE.Vector3();
      const RAMP_SPACING = 430, RAMP_LEN = 22, RAMP_W = 10.5, RAMP_H = 7.0;

      const CHUNK = 120;
      const chunkCache = new Map();
      const GATE_SPACING = 96;
      const passedGates = new Set();
      const LIFT_OFF = 78;

      const keys = Object.create(null);
      let mouseSteer = 0;
      const state = {
        started: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        yaw: 0,
        onGround: true,
        airTime: 0,
        spin: 0,
        crash: 0,
        score: 0, best: 0,
        combo: 1, comboTimer: 0,
        time: 0,
        startY: 0,
        carve: 0,
        lean: 0,
        crouch: 0,
        jumpCharge: 0,
        selectedTrail: 0,
        liftRide: 0,
        liftFromZ: 0,
        liftToZ: 0,
        invuln: 0,
        lastGateZ: -1e9,
        distance: 0
      };
      const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(),
            _nrm = new THREE.Vector3(), _tmp = new THREE.Vector3(), _tmp2 = new THREE.Vector3();
      const GRAVITY = 26.5;
      const camPos = new THREE.Vector3(0, 10, -14);

      const Sound = { burst() {}, blip() {} };
      const noop = () => {};
      const clearTracks = noop;
      const updateTiles = noop;
      const updateProps = noop;
      const updateMarkers = noop;
      const updateGates = noop;
      const updateRamps = noop;
      const emitSpray = noop;
      const popup = noop;
      const requestAnimationFrame = noop;
      const style = Object.create(null);
      const document = {
        getElementById() {
          return { style, querySelector() { return { textContent: "" }; } };
        }
      };

      let prevZ = 0, prevX = 0;

      ${extractedFunctions}

      function applyInput(input) {
        for (const key of Object.keys(keys)) delete keys[key];
        for (const [key, value] of Object.entries(input)) keys[key] = value;
      }

      function step(input, dt) {
        applyInput(input);
        state.time += dt;
        if (state.comboTimer > 0) {
          state.comboTimer -= dt;
          if (state.comboTimer <= 0) state.combo = 1;
        }
        physics(dt);
      }

      return {
        fbm,
        hashInt,
        mulberry32,
        nearestTrail,
        physics,
        rampHeight,
        resetRun,
        state,
        step,
        terrainHeight,
        terrainNormal,
        trailCenter,
        trailField,
        vnoise,
      };
    `,
  );

  const runtime = buildRuntime(THREE, profile);
  runtime.resetRun(0);
  return runtime;
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
  const normal = new THREE.Vector3();
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
