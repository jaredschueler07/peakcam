/**
 * Generate honest competitive ghosts by running the pure simulation core
 * (`createSimulation` / `stepSimulation`) with scripted InputFrame tapes,
 * sampling every Nth fixed step, emitting absolute 120 Hz ticks (matching the
 * real recorder), real poseFlags, and mapping trajectories onto the fixture
 * course start/finish gates.
 *
 * Writes commit-able fixtures:
 *   - honest-ghost.pcgh / .json          (braked crawl — default)
 *   - honest-ghost-neutral.pcgh / .json  (neutral input)
 *   - honest-ghost-full-tuck.pcgh / .json
 *   - honest-ghost-jump.pcgh / .json     (jumpHeld pulses → real POSE_AIRBORNE)
 *
 * Not imported by production code.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DROP_IN_GAME_PROFILES } from "../../config/profiles";
import { COURSE_VERSION, PHYSICS_VERSION } from "../../config/versions";
import { FIXED_DT, FIXED_HZ } from "../../core/clock";
import { simulationConfig } from "../../core/config";
import { createSimulation, stepSimulation } from "../../core/simulation";
import type { InputFrame, SimulationState } from "../../core/types";
import {
  encodeGhost,
  POSE_AIRBORNE,
  POSE_BRAKING,
  POSE_CRASHED,
  POSE_TUCKED,
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

/** Physics steps between ghost samples (120 / 30 = 4). */
export const HONEST_SAMPLE_EVERY = 4;
export const HONEST_SAMPLE_HZ = FIXED_HZ / HONEST_SAMPLE_EVERY;

export type HonestTapeKind = "braked" | "neutral" | "full-tuck" | "jump";

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
 * Jump charge windows (physics steps). Integrator launches on RELEASE of
 * jumpHeld after charge builds (`jumpCharge` up to 0.4 s ≈ 48 steps), so each
 * window holds then releases for a real airborne stretch.
 * Longest honest airborne stretch in the committed jump fixture is far under
 * the 4 s validator cap (see honest-ghost-jump.json longestAirborneSeconds).
 */
const JUMP_CHARGE_WINDOWS: ReadonlyArray<readonly [number, number]> = [
  [600, 660],
  [1400, 1460],
  [2200, 2260],
];

function tapeFor(kind: HonestTapeKind, step: number): InputFrame {
  if (kind === "neutral") {
    // Near-zero input — coast the fall line with a tiny steer to stay oriented.
    return { ...EMPTY, steer: Math.sin(step / 800) * 0.04 };
  }
  if (kind === "full-tuck") {
    return {
      ...EMPTY,
      tuck: step > 60 ? 1 : 0,
      steer: Math.sin(step / 500) * 0.08,
    };
  }
  if (kind === "jump") {
    // Charge jumpHeld for ~0.5 s then release → onGround===false + real offset.
    const charging = JUMP_CHARGE_WINDOWS.some(([a, b]) => step >= a && step < b);
    const chargeStart = JUMP_CHARGE_WINDOWS.some(([a]) => step === a);
    return {
      ...EMPTY,
      tuck: step > 100 ? 0.55 : 0,
      steer: Math.sin(step / 400) * 0.1,
      jumpHeld: charging,
      jumpPressed: chargeStart,
    };
  }
  // Braked crawl: light tuck/brake stays well inside envelopes.
  const tuck = step > 200 ? 0.15 : 0;
  const brake = step > 200 ? 0.08 : 0.25;
  const steer = Math.sin(step / 600) * 0.06;
  return { ...EMPTY, tuck, brake, steer };
}

function poseFlagsFrom(state: SimulationState, input: InputFrame): number {
  let pose = 0;
  if (!state.onGround) pose |= POSE_AIRBORNE;
  if (input.tuck > 0.5) pose |= POSE_TUCKED;
  if (input.brake > 0.5) pose |= POSE_BRAKING;
  if (state.crash > 0) pose |= POSE_CRASHED;
  return pose;
}

/**
 * Run the pure sim and return quantised samples placed on the fixture course
 * (Breckenridge first trail) start → finish gates. Ticks are absolute 120 Hz
 * indices: `i * (FIXED_HZ / sampleHz)`.
 */
export function generateHonestSamples(kind: HonestTapeKind = "braked"): GhostSample[] {
  const course = resolveCourseOrThrow();
  const profile = DROP_IN_GAME_PROFILES[FIXTURE_RESORT_SLUG];
  const world = createProceduralWorld(profile, profile.seed, simulationConfig("packed"));
  const state = createSimulation(profile, profile.seed);
  // Competitive recording starts still (spawn seeds 15 m/s for free-ski feel).
  state.vel.x = 0;
  state.vel.y = 0;
  state.vel.z = 0;

  const needDz = Math.abs(course.finishZ - course.startZ) + 5;
  const raw: GhostSample[] = [];
  const maxSteps =
    kind === "full-tuck" ? 25_000 : kind === "jump" ? 30_000 : kind === "neutral" ? 35_000 : 40_000;

  for (let step = 0; step < maxSteps; step++) {
    const input = tapeFor(kind, step);
    stepSimulation(state, input, FIXED_DT, world);
    if (step % HONEST_SAMPLE_EVERY === 0) {
      const sampleIndex = raw.length;
      const speed = Math.hypot(state.vel.x, state.vel.y, state.vel.z);
      raw.push(
        quantizeGhostSample({
          // Absolute 120 Hz tick — matches the real recorder cadence.
          tick: sampleIndex * HONEST_SAMPLE_EVERY,
          xCm: state.pos.x * 100,
          zCm: state.pos.z * 100,
          groundOffsetCm: Math.round(
            (state.pos.y - world.terrain.height(state.pos.x, state.pos.z)) * 100,
          ),
          yaw: state.yaw,
          speedCms: Math.round(speed * 100),
          poseFlags: poseFlagsFrom(state, input),
        }),
      );
    }
    if (raw.length > 10 && state.pos.z - raw[0].zCm / 100 >= needDz) break;
  }

  if (raw.length < 2) {
    throw new Error(`honest ghost generator (${kind}): sim produced fewer than 2 samples`);
  }

  return mapOntoCourseGates(raw, course.startZ, course.finishZ);
}

function mapOntoCourseGates(
  raw: GhostSample[],
  startZ: number,
  finishZ: number,
): GhostSample[] {
  const z0 = raw[0].zCm / 100;
  const fallDir = finishZ >= startZ ? 1 : -1;
  const mapped = raw.map((s) =>
    quantizeGhostSample({
      ...s,
      zCm: Math.round((startZ + fallDir * (s.zCm / 100 - z0)) * 100),
      yaw: fallDir >= 0 ? s.yaw : s.yaw + Math.PI,
    }),
  );

  const crossed = (zM: number): boolean =>
    finishZ >= startZ ? zM >= finishZ : zM <= finishZ;

  let endIdx = mapped.findIndex((s) => crossed(s.zCm / 100));
  if (endIdx < 0) endIdx = mapped.length - 1;
  if (endIdx < mapped.length - 1) endIdx += 1;

  // Preserve absolute ticks from the raw run (do not re-index to 0..n).
  return mapped.slice(0, endIdx + 1);
}

export function encodeHonestGhost(
  kind: HonestTapeKind = "braked",
  samples: GhostSample[] = generateHonestSamples(kind),
): {
  samples: GhostSample[];
  bytes: Uint8Array;
  sampleHz: number;
  seed: number;
  kind: HonestTapeKind;
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
  return { samples, bytes, sampleHz: HONEST_SAMPLE_HZ, seed, kind };
}

function fixtureStem(kind: HonestTapeKind): string {
  if (kind === "braked") return "honest-ghost";
  return `honest-ghost-${kind}`;
}

function longestAirborneSamples(samples: readonly GhostSample[]): number {
  let best = 0;
  let run = 0;
  for (const s of samples) {
    if (s.poseFlags & POSE_AIRBORNE) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  return best;
}

function writeFixture(kind: HonestTapeKind, dir: string): void {
  const { samples, bytes, sampleHz, seed } = encodeHonestGhost(kind);
  const stem = fixtureStem(kind);
  const pcghPath = path.join(dir, `${stem}.pcgh`);
  const jsonPath = path.join(dir, `${stem}.json`);
  const maxAir = longestAirborneSamples(samples);
  const airCount = samples.filter((s) => s.poseFlags & POSE_AIRBORNE).length;
  writeFileSync(pcghPath, bytes);
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        description:
          `Honest Drop In ghost (${kind}): pure sim packed, absolute 120Hz ticks, ` +
          `every-${HONEST_SAMPLE_EVERY}th step, real poseFlags, horseshoe-bowl gates`,
        kind,
        resortSlug: FIXTURE_RESORT_SLUG,
        trailId: resolveCourseOrThrow().trailId,
        sampleHz,
        seed,
        physicsVersion: PHYSICS_VERSION,
        courseVersion: COURSE_VERSION,
        keyframes: samples.length,
        firstTick: samples[0].tick,
        lastTick: samples[samples.length - 1].tick,
        maxSpeedCms: Math.max(...samples.map((s) => s.speedCms)),
        airborneSamples: airCount,
        // Longest continuous airborne stretch (samples). Validator caps at
        // MAX_AIRBORNE_SECONDS * sampleHz (4s); honest jump is well under that.
        longestAirborneSamples: maxAir,
        longestAirborneSeconds: maxAir / sampleHz,
        ghostBase64: Buffer.from(bytes).toString("base64"),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `wrote ${pcghPath} (${bytes.byteLength} B, ${samples.length} keyframes @ ${sampleHz} Hz, ` +
      `kind=${kind}, airborne=${airCount}, maxAirStretch=${maxAir})`,
  );
}

// ─── CLI ─────────────────────────────────────────────────────

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  for (const kind of ["braked", "neutral", "full-tuck", "jump"] as const) {
    writeFixture(kind, dir);
  }
}
