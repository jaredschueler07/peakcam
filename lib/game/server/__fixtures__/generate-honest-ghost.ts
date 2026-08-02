/**
 * Generate an honest competitive ghost by running the pure simulation core
 * (`createSimulation` / `stepSimulation`) with a scripted InputFrame tape,
 * sampling every 4th fixed step, quantising through the codec, and mapping the
 * trajectory onto the fixture course's start/finish gates.
 *
 * Used to (re)write `honest-ghost.json` / `honest-ghost.pcgh`. Not imported by
 * production code.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DROP_IN_GAME_PROFILES } from "../../config/profiles";
import { COURSE_VERSION, PHYSICS_VERSION } from "../../config/versions";
import { FIXED_DT } from "../../core/clock";
import { simulationConfig } from "../../core/config";
import { createSimulation, stepSimulation } from "../../core/simulation";
import type { InputFrame } from "../../core/types";
import {
  encodeGhost,
  quantizeGhostSample,
  type GhostSample,
} from "../../replay/codec";
import { createProceduralWorld } from "../../terrain/obstacles";
import { courseSeed, utcDateStamp } from "../courses";
import {
  FIXTURE_NOW_MS,
  FIXTURE_RESORT_SLUG,
  resolveCourseOrThrow,
} from "./run";

/** Physics steps between ghost samples (120 Hz / 4 = 30 Hz). */
export const HONEST_SAMPLE_EVERY = 4;
export const HONEST_SAMPLE_HZ = Math.round(1 / (FIXED_DT * HONEST_SAMPLE_EVERY));

const EMPTY: InputFrame = {
  steer: 0,
  tuck: 0,
  brake: 0,
  jumpHeld: false,
  jumpPressed: false,
  restartPressed: false,
  trailPressed: false,
};

/**
 * Scripted tape: light brake + mild tuck keeps peak speed and accel inside the
 * baseline envelopes while still covering the course distance.
 */
function tape(step: number): InputFrame {
  const tuck = step > 200 ? 0.15 : 0;
  const brake = step > 200 ? 0.08 : 0.25;
  const steer = Math.sin(step / 600) * 0.06;
  return { ...EMPTY, tuck, brake, steer };
}

/**
 * Run the pure sim and return quantised samples already placed on the fixture
 * course (Breckenridge first trail) start → finish gates.
 */
export function generateHonestSamples(): GhostSample[] {
  const course = resolveCourseOrThrow();
  const profile = DROP_IN_GAME_PROFILES[FIXTURE_RESORT_SLUG];
  const world = createProceduralWorld(profile, profile.seed, simulationConfig("packed"));
  const state = createSimulation(profile, profile.seed);
  // Standstill at the gate — the spawn helper seeds 15 m/s for free-ski feel,
  // which is above MAX_START_SPEED_CMS; competitive recording starts still.
  state.vel.x = 0;
  state.vel.y = 0;
  state.vel.z = 0;

  const needDz = Math.abs(course.finishZ - course.startZ) + 5;
  const raw: GhostSample[] = [];

  for (let step = 0; step < 40_000; step++) {
    stepSimulation(state, tape(step), FIXED_DT, world);
    if (step % HONEST_SAMPLE_EVERY === 0) {
      const speed = Math.hypot(state.vel.x, state.vel.y, state.vel.z);
      raw.push(
        quantizeGhostSample({
          tick: raw.length,
          xCm: state.pos.x * 100,
          zCm: state.pos.z * 100,
          groundOffsetCm: Math.round(
            (state.pos.y - world.terrain.height(state.pos.x, state.pos.z)) * 100,
          ),
          yaw: state.yaw,
          speedCms: Math.round(speed * 100),
          poseFlags: 0,
        }),
      );
    }
    if (raw.length > 10 && state.pos.z - raw[0].zCm / 100 >= needDz) break;
  }

  if (raw.length < 2) {
    throw new Error("honest ghost generator: sim produced fewer than 2 samples");
  }

  // Procedural terrain skis +Z; map rigidly onto the course fall line so the
  // trajectory satisfies start/finish gates without altering per-step speeds.
  const z0 = raw[0].zCm / 100;
  const fallDir = course.finishZ >= course.startZ ? 1 : -1;
  const mapped = raw.map((s) =>
    quantizeGhostSample({
      ...s,
      zCm: Math.round((course.startZ + fallDir * (s.zCm / 100 - z0)) * 100),
      yaw: fallDir >= 0 ? s.yaw : s.yaw + Math.PI,
    }),
  );

  const crossed = (zM: number): boolean =>
    course.finishZ >= course.startZ ? zM >= course.finishZ : zM <= course.finishZ;

  let endIdx = mapped.findIndex((s) => crossed(s.zCm / 100));
  if (endIdx < 0) endIdx = mapped.length - 1;
  // Keep one sample past the line when available so "crossed" is unambiguous.
  if (endIdx < mapped.length - 1) endIdx += 1;

  const samples = mapped.slice(0, endIdx + 1).map((s, i) => ({ ...s, tick: i }));
  return samples;
}

export function encodeHonestGhost(samples: GhostSample[] = generateHonestSamples()): {
  samples: GhostSample[];
  bytes: Uint8Array;
  sampleHz: number;
  seed: number;
} {
  const course = resolveCourseOrThrow();
  const seed = courseSeed(
    "time_trial",
    FIXTURE_RESORT_SLUG,
    course.trailId,
    COURSE_VERSION,
    utcDateStamp(FIXTURE_NOW_MS),
  );
  const bytes = encodeGhost(samples, {
    physicsVersion: PHYSICS_VERSION,
    courseVersion: COURSE_VERSION,
    sampleHz: HONEST_SAMPLE_HZ,
    seed,
  });
  return { samples, bytes, sampleHz: HONEST_SAMPLE_HZ, seed };
}

// ─── CLI: write commit-able fixtures ─────────────────────────

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const { samples, bytes, sampleHz, seed } = encodeHonestGhost();
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const pcghPath = path.join(dir, "honest-ghost.pcgh");
  const jsonPath = path.join(dir, "honest-ghost.json");
  writeFileSync(pcghPath, bytes);
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        description:
          "Honest Drop In ghost: pure sim (packed) + every-4th-step sample, mapped to horseshoe-bowl gates",
        resortSlug: FIXTURE_RESORT_SLUG,
        trailId: resolveCourseOrThrow().trailId,
        sampleHz,
        seed,
        physicsVersion: PHYSICS_VERSION,
        courseVersion: COURSE_VERSION,
        keyframes: samples.length,
        ghostBase64: Buffer.from(bytes).toString("base64"),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `wrote ${pcghPath} (${bytes.byteLength} B, ${samples.length} keyframes @ ${sampleHz} Hz)`,
  );
  console.log(`wrote ${jsonPath}`);
}
