import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveFavoritesUserId, runLockedFavoriteToggle } from "./useFavorites";

test("resolveFavoritesUserId normalizes user identity across auth events", () => {
  assert.equal(resolveFavoritesUserId(null), null);
  assert.equal(resolveFavoritesUserId(undefined), null);
  assert.equal(resolveFavoritesUserId({}), null);
  assert.equal(resolveFavoritesUserId({ id: "user-123" }), "user-123");
});

test("runLockedFavoriteToggle refuses unauthenticated callers without mutating state", async () => {
  let state = new Set<string>(["alta"]);
  const inFlight = new Set<string>();
  let calls = 0;

  const res = await runLockedFavoriteToggle({
    resortId: "vail",
    userId: null,
    inFlight,
    currentFavorites: state,
    applyFavorites: (updater) => { state = updater(state); },
    toggleRemote: async () => {
      calls += 1;
      return { favorited: true };
    },
  });

  assert.equal(res.error, "Sign in to save favorites");
  assert.equal(calls, 0);
  assert.deepEqual([...state], ["alta"]);
});

test("runLockedFavoriteToggle serializes per-resort clicks and reverts exact pre-click state on error", async () => {
  let state = new Set<string>(["alta"]);
  const inFlight = new Set<string>();
  let releaseFirst!: () => void;
  let remoteCalls = 0;

  const firstPromise = runLockedFavoriteToggle({
    resortId: "alta",
    userId: "u1",
    inFlight,
    currentFavorites: state,
    applyFavorites: (updater) => { state = updater(state); },
    toggleRemote: () =>
      new Promise((resolve) => {
        remoteCalls += 1;
        releaseFirst = () => resolve({ favorited: true, error: "Network failure" });
      }),
  });

  // Optimistically removed while in-flight
  assert.equal(state.has("alta"), false);
  assert.equal(inFlight.has("alta"), true);

  // Second concurrent tap on the same resort is ignored
  const secondRes = await runLockedFavoriteToggle({
    resortId: "alta",
    userId: "u1",
    inFlight,
    currentFavorites: state,
    applyFavorites: (updater) => { state = updater(state); },
    toggleRemote: async () => {
      remoteCalls += 1;
      return { favorited: true };
    },
  });
  assert.equal(remoteCalls, 1);
  assert.equal(secondRes.favorited, false);

  // Failing remote reverts back to pre-click favorited=true and releases lock
  releaseFirst();
  const firstRes = await firstPromise;
  assert.equal(firstRes.error, "Network failure");
  assert.equal(state.has("alta"), true);
  assert.equal(inFlight.has("alta"), false);

  // Throwing remote also reverts optimistic add cleanly
  const addFail = await runLockedFavoriteToggle({
    resortId: "snowbird",
    userId: "u1",
    inFlight,
    currentFavorites: state,
    applyFavorites: (updater) => { state = updater(state); },
    toggleRemote: async () => {
      throw new Error("500");
    },
  });
  assert.equal(addFail.favorited, false);
  assert.equal(addFail.error, "Could not update favorite");
  assert.equal(state.has("snowbird"), false);
  assert.equal(inFlight.has("snowbird"), false);
});
