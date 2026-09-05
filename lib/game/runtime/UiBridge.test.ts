import assert from "node:assert/strict";
import test from "node:test";
import { createSimulation } from "../core/simulation";
import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import { UiBridge } from "./UiBridge";

test("HUD snapshots publish at 15Hz and contain a copied minimap position", () => {
  const profile = DROP_IN_GAME_PROFILES.heavenly;
  const state = createSimulation(profile, profile.seed);
  const bridge = new UiBridge(profile);
  state.vel.z = 10;
  state.pos.x = 4;
  state.pos.z = 9;
  assert.equal(bridge.publish(state, 0), true);
  assert.equal(bridge.publish(state, 20), false);
  state.pos.x = 8;
  assert.equal(bridge.store.getState().position.x, 4);
  assert.equal(bridge.publish(state, 67), true);
  assert.equal(bridge.store.getState().position.x, 8);
  assert.equal(bridge.store.getState().speedKmh, 36);
});
test("typed events update crash and pause state immediately", () => {
  const bridge = new UiBridge(DROP_IN_GAME_PROFILES.heavenly);
  bridge.emit({ type: "crashed", reason: "TREE" });
  bridge.setPaused(true);
  assert.equal(bridge.store.getState().crashReason, "TREE");
  assert.equal(bridge.store.getState().status, "paused");
});

test("finished recording availability is surfaced and can be cleared", () => {
  const bridge = new UiBridge(DROP_IN_GAME_PROFILES.heavenly);
  assert.equal(bridge.store.getState().runRecording, false);

  bridge.setRunRecordingAvailable(true);
  bridge.emit({ type: "finished", reason: "finish" });
  assert.equal(bridge.store.getState().status, "results");
  assert.equal(bridge.store.getState().runRecording, true);

  bridge.setRunRecordingAvailable(false);
  assert.equal(bridge.store.getState().runRecording, false);
});

test("real mountain HUD reports DEM altitude instead of a profile-relative summit", () => {
  const profile = DROP_IN_GAME_PROFILES.heavenly;
  const state = createSimulation(profile, profile.seed);
  const bridge = new UiBridge(profile);
  const terrain = {
    kind: "real" as const, profile, seed: profile.seed, noiseOffset: { x: 0, z: 0 },
    realRuns: [{kind: "real" as const, name: "Gunbarrel", sourceIndex: 0, difficulty: "advanced", halfWidthM: 14,
      points: [{x: 0, y: 2600, z: 0}, {x: 0, y: 2200, z: 1000}], lengthM: 1000, finishM: 1000, gates: [], ramps: []}],
    height: () => 2600, normal: (_x: number, _z: number, out: {x:number;y:number;z:number}) => out,
    trailField: () => 1, nearestTrail: (_x: number, _z: number, out: import("../core/types").NearestTrail) => out,
  };
  bridge.configureTerrain(terrain);
  state.pos.y = 2500; state.startY = 2600;
  bridge.publish(state, 0);
  const hud = bridge.store.getState();
  assert.equal(hud.altitudeFeet, 2500 * 3.28084);
  assert.equal(hud.trailTopFeet, 2600 * 3.28084);
  assert.equal(hud.trailBottomFeet, 2200 * 3.28084);
});
