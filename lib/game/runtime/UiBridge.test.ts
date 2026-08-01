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

