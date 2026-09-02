/**
 * Golden-trajectory lock for both integrators.
 *
 * `integrator.ts` (v1) and `integrator-v2.ts` (v2) are the physics both clients
 * run and the model the server-side anti-cheat path is written against, so any
 * numeric drift is a bug — not a rounding detail. This test pins full state
 * sequences for a spread of surfaces, inputs, and code paths (grounded carve,
 * jump/air, landing, crash recovery, lift ride) to a committed fixture and
 * asserts **Float64 equality**, not approximate equality.
 *
 * The world is built from a profile literal defined here rather than from
 * `lib/game/config/profiles.ts`, so retuning a resort cannot silently
 * invalidate the lock — this fixture is about the integrator, not the resorts.
 *
 * Regenerate deliberately (and review the diff) with:
 *   `UPDATE_GOLDEN=1 npx tsx --test lib/game/physics/integrator-golden.test.ts`
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { ResortGameProfile, ResortTrail } from "../config/schema";
import { FIXED_DT } from "../core/clock";
import { simulationConfig, type PhysicsModel, type SurfaceKind } from "../core/config";
import { beginLiftRide } from "../core/run-lifecycle";
import { mulberry32 } from "../core/rng";
import { createSimulation } from "../core/simulation";
import type { InputFrame, SimulationState, SimulationWorld } from "../core/types";
import { createProceduralWorld } from "../terrain/obstacles";
import { integrateSkierV2 } from "./integrator-v2";
import { integrateSkier } from "./integrator";

const FIXTURE_PATH = fileURLToPath(
  new URL("./__fixtures__/integrator-golden.json", import.meta.url),
);

function trail(name: string, off: number, amp: number, freq: number, phase: number): ResortTrail {
  return {
    name, grade: "blue", hex: "#3aa0ff", col: 0x3aa0ff,
    off, amp, freq, phase, half: 34, ramp: 0.5,
  };
}

/** Frozen stand-in for a resort profile: only the physics-relevant fields matter. */
const GOLDEN_PROFILE = {
  slug: "ski-portillo",
  name: "Golden Test Mountain",
  tagline: "golden", siteTagline: "golden",
  summitFt: 10000, verticalFt: 3000, seed: 1337,
  fall: 0.34, relief: 46,
  accent: "#ff8a3d", accent2: "#3aa0ff", logo: "GT", glow: "GT",
  trails: [
    trail("Alpha", 0, 26, 0.0042, 0.4),
    trail("Bravo", -120, 18, 0.0031, 1.9),
    trail("Charlie", 130, 22, 0.0055, 2.7),
    trail("Delta", -240, 30, 0.0026, 0.8),
    trail("Echo", 250, 14, 0.0061, 3.4),
    trail("Foxtrot", 60, 20, 0.0038, 5.1),
  ],
  forest: {
    treeline: 0.42, rockBias: 0.18, rockKeep: 0.6, treeScale: 1.1,
    trunk: 0x4a3524, cone: [0x1f4d2e, 0x2a6b3f, 0x14361f] as [number, number, number],
    cap: 0xeef4ff,
  },
  weather: [{
    name: "Bluebird", fog: 0.0009, fogCol: 0xdfeaff, top: 0x2f6fd0, hor: 0xbdd7ff,
    sun: 1.6, hemi: 0.7, amb: 0.4, snow: 0, wind: 0.2, haze: 0.2, exposure: 1,
  }],
  summitElevationFt: 10000,
  verticalDropFt: 3000,
  terrainSeed: 1337,
  trailNames: ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"],
} satisfies ResortGameProfile;

const SURFACES: readonly SurfaceKind[] = ["powder", "packed", "firm", "ice"];

function makeInput(values: Partial<InputFrame> = {}): InputFrame {
  return {
    steer: 0, tuck: 0, brake: 0, jumpHeld: false, jumpPressed: false,
    restartPressed: false, trailPressed: false, ...values,
  };
}

/** Deterministic input tapes. Each returns the frame for tick `i`. */
const TAPES: Readonly<Record<string, (i: number, random: () => number) => InputFrame>> = {
  glide: () => makeInput(),
  tuck: () => makeInput({ tuck: 1 }),
  carve: (i) => makeInput({ steer: Math.sin(i * 0.06), tuck: i % 90 < 45 ? 1 : 0 }),
  brakeSlalom: (i) => makeInput({ steer: i % 40 < 20 ? 1 : -1, brake: i % 120 < 30 ? 1 : 0 }),
  jumpSpam: (i) => makeInput({ steer: Math.cos(i * 0.11), jumpHeld: i % 50 < 30, tuck: 1 }),
  random: (_i, random) => makeInput({
    steer: random() * 2 - 1, tuck: random(), brake: random() < 0.2 ? random() : 0,
    jumpHeld: random() < 0.25,
  }),
};

type TapeName = keyof typeof TAPES;

interface Scenario {
  readonly name: string;
  readonly tape: TapeName;
  readonly ticks: number;
  readonly seed: number;
  /** Applied once before stepping, to reach paths a fresh state never enters. */
  readonly prepare?: (state: SimulationState, world: SimulationWorld) => void;
}

const SCENARIOS: readonly Scenario[] = [
  { name: "glide", tape: "glide", ticks: 240, seed: 1 },
  { name: "tuck", tape: "tuck", ticks: 240, seed: 2 },
  { name: "carve", tape: "carve", ticks: 360, seed: 3 },
  { name: "brake-slalom", tape: "brakeSlalom", ticks: 360, seed: 4 },
  { name: "jump-spam", tape: "jumpSpam", ticks: 420, seed: 5 },
  { name: "random-inputs", tape: "random", ticks: 480, seed: 6 },
  {
    name: "high-air-landing",
    tape: "carve",
    ticks: 300,
    seed: 7,
    prepare: (state) => {
      state.onGround = false;
      state.airTime = 0.6;
      state.pos.y += 40;
      state.vel.x = 6; state.vel.y = 12; state.vel.z = 26;
    },
  },
  {
    name: "crash-recovery",
    tape: "brakeSlalom",
    ticks: 240,
    seed: 8,
    prepare: (state) => {
      state.crash = 0.9;
      state.vel.x = 4; state.vel.y = -3; state.vel.z = 30;
    },
  },
  {
    name: "lift-ride",
    tape: "glide",
    ticks: 900,
    seed: 9,
    prepare: (state) => { beginLiftRide(state); },
  },
];

/** Every mutable numeric/boolean field the integrators touch, in a stable order. */
function snapshot(s: SimulationState): number[] {
  return [
    s.pos.x, s.pos.y, s.pos.z,
    s.vel.x, s.vel.y, s.vel.z,
    s.yaw, s.onGround ? 1 : 0, s.airTime, s.spin, s.crash,
    s.score, s.best, s.combo, s.comboTimer,
    s.carve, s.edgeAngle, s.landingTimer, s.jumpCharge,
    s.liftRide, s.liftFromZ, s.liftToZ, s.invuln,
    s.lastGateZ, s.distance, s.prevZ, s.prevX,
    s.courseProgress, s.prevCourseProgress, s.finished ? 1 : 0,
    s.passedGates.size, s.selectedTrail,
  ];
}

function runScenario(
  model: PhysicsModel, surface: SurfaceKind, scenario: Scenario,
): number[][] {
  const world = createProceduralWorld(
    GOLDEN_PROFILE, GOLDEN_PROFILE.seed, simulationConfig(surface, model),
  );
  const state = createSimulation(GOLDEN_PROFILE, GOLDEN_PROFILE.seed, world.terrain);
  scenario.prepare?.(state, world);
  const random = mulberry32(scenario.seed);
  const integrate = model === "v2" ? integrateSkierV2 : integrateSkier;
  const trace: number[][] = [snapshot(state)];
  for (let i = 0; i < scenario.ticks; i += 1) {
    integrate(state, TAPES[scenario.tape](i, random), FIXED_DT, world);
    if (i % 20 === 19) trace.push(snapshot(state));
  }
  trace.push(snapshot(state));
  return trace;
}

function key(model: PhysicsModel, surface: SurfaceKind, scenario: Scenario): string {
  return `${model}/${surface}/${scenario.name}`;
}

function computeAll(): Record<string, number[][]> {
  const out: Record<string, number[][]> = {};
  for (const model of ["v1", "v2"] as const) {
    for (const surface of SURFACES) {
      for (const scenario of SCENARIOS) {
        out[key(model, surface, scenario)] = runScenario(model, surface, scenario);
      }
    }
  }
  return out;
}

const computed = computeAll();

if (process.env.UPDATE_GOLDEN === "1") {
  writeFileSync(FIXTURE_PATH, `${JSON.stringify(computed, null, 1)}\n`);
}

const golden = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Record<string, number[][]>;

test("the golden fixture covers every model × surface × scenario", () => {
  assert.deepEqual(Object.keys(computed).sort(), Object.keys(golden).sort());
  assert.equal(Object.keys(golden).length, 2 * SURFACES.length * SCENARIOS.length);
});

for (const name of Object.keys(computed)) {
  test(`${name} reproduces the golden trajectory bit-for-bit`, () => {
    const expected = golden[name];
    const actual = computed[name];
    assert.ok(expected, `no golden trace for ${name}`);
    assert.equal(actual.length, expected.length, `trace length changed for ${name}`);
    for (let step = 0; step < expected.length; step += 1) {
      for (let field = 0; field < expected[step].length; field += 1) {
        // Object.is, not ===, so a drift into -0 or NaN also fails.
        assert.ok(
          Object.is(actual[step][field], expected[step][field]),
          `${name} step ${step} field ${field}: ` +
            `expected ${expected[step][field]}, got ${actual[step][field]}`,
        );
      }
    }
  });
}
