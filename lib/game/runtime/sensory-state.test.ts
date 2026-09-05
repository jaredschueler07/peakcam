import assert from "node:assert/strict";
import test from "node:test";
import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import { createSimulation } from "../core/simulation";
import { createProceduralWorld } from "../terrain/obstacles";
import { sampleSensoryState, sensoryLocalHour, type SensoryState } from "./sensory-state";
import { visibilityFogDensity, daylightWarmth } from "../rendering/WeatherRenderer";
const profile = DROP_IN_GAME_PROFILES.breckenridge;
test("signed local surface, exposure and station proximity fill stable scratch without mutating simulation", () => {
  const world = createProceduralWorld(profile, profile.seed), state = createSimulation(profile, profile.seed);
  let corridor = 0, ny = 1;
  const fixture = { ...world, config: { ...world.config, environment: { powderDepthCm: 40, windSpeedMps: 20, morningIce: true, visibilityM: 500, northSign: 1 as const } }, terrain: { ...world.terrain,
    trailField: () => corridor, normal: (_x: number, _z: number, out: {x:number;y:number;z:number}) => Object.assign(out, { x: 0, y: ny, z: 0.2 }),
    realLifts: [{ kind: "real" as const, name: "Chair", type: "chair_lift", lengthM: 10, points: [], stations: [{ ...state.pos, radiusM: 3 }] }],
  } };
  const out: SensoryState = { surface: "packed", windLevel: 0, liftProximity: 0, signContact: false }, before = JSON.stringify(state);
  assert.equal(sampleSensoryState(state, fixture, 99, out), out);
  assert.equal(out.surface, "powder"); assert.equal(out.windLevel, 0.3); assert.equal(out.liftProximity, 1);
  corridor = 1; ny = 0.5;
  sampleSensoryState(state, fixture, 0, out);
  assert.equal(out.surface, "ice"); assert.equal(out.windLevel, 1);
  assert.equal(JSON.stringify(state), before);
  state.pos.x += 56; sampleSensoryState(state, fixture, 0, out); assert.equal(out.liftProximity, 0);
});
test("post contact uses the rendered junction offset and is silent airborne", () => {
  const world = createProceduralWorld(profile, profile.seed), state = createSimulation(profile, profile.seed);
  const fixture = { ...world, terrain: { ...world.terrain, junctions: [{ id: "j", x: 0, y: 0, z: 0, heading: 0, halfWidthM: 10, choices: [] }] } };
  const out: SensoryState = { surface: "packed", windLevel: 0, liftProximity: 0, signContact: false };
  state.pos.x = 14; state.pos.z = -12; state.onGround = true;
  sampleSensoryState(state, fixture, 0, out); assert.equal(out.signContact, true);
  state.onGround = false; sampleSensoryState(state, fixture, 0, out); assert.equal(out.signContact, false);
});
test("visibility has 5 percent transmittance at its range and clear weather opens sight distance", () => {
  assert.equal(visibilityFogDensity(0.001), 0.001);
  const storm = visibilityFogDensity(0.001, 500), clear = visibilityFogDensity(0.001, 10000);
  assert.ok(storm > clear); assert.ok(Math.abs(Math.exp(-((storm * 500) ** 2)) - 0.05) < 1e-12);
});

test("Daily morning and Time Trial noon colors are stable while Free Ride uses resort-local clock", () => {
  const now = Date.parse("2026-01-01T23:00:00Z");
  assert.equal(sensoryLocalHour("breckenridge", "score_attack", now), 7);
  assert.equal(sensoryLocalHour("breckenridge", "time_trial", now), 12);
  assert.equal(sensoryLocalHour("breckenridge", "free_ski", now), 16);
  assert.equal(sensoryLocalHour("heavenly", "free_ski", now), 15);
  assert.equal(daylightWarmth(12), 0);
  assert.ok(daylightWarmth(7) > 0);
  assert.ok(daylightWarmth(16) > daylightWarmth(7));
});
