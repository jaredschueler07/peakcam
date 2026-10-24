import { test } from "node:test";
import assert from "node:assert/strict";
import { addFavoriteItems, addFavoriteResorts, type FavoriteStore } from "./lineup-favorites";

const USER = { id: "user-1" };
const IDS = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
];
const CAM = "10000000-0000-4000-8000-000000000001";

function fakeStore(options: {
  user?: { id: string } | null;
  existing?: Array<{ item_type: string; item_id: string }>;
  insertError?: { code?: string; message?: string };
  throwOnInsert?: boolean;
  hang?: boolean;
  failAfter?: number;
  onInsert?: (itemType: string, itemId: string) => void;
} = {}) {
  const inserts: Array<{ userId: string; itemType: string; itemId: string }> = [];
  const saved = new Map((options.existing ?? []).map((item) => [`${item.item_type}:${item.item_id}`, item]));
  let listCalls = 0;
  const store: FavoriteStore = {
    async getUser() {
      return options.user === undefined ? USER : options.user;
    },
    async listFavoriteItems() {
      listCalls += 1;
      return { items: [...saved.values()] };
    },
    async insertFavorite(userId, itemType, itemId) {
      inserts.push({ userId, itemType, itemId });
      options.onInsert?.(itemType, itemId);
      if (options.throwOnInsert) throw new Error("provider connection reset");
      if (options.insertError) return { error: options.insertError };
      if (options.hang) return new Promise(() => {});
      if (options.failAfter !== undefined && inserts.length > options.failAfter) {
        return { error: { code: "500", message: "Provider unavailable" } };
      }
      saved.set(`${itemType}:${itemId}`, { item_type: itemType, item_id: itemId });
      return {};
    },
  };
  return { store, inserts, saved, listCalls: () => listCalls };
}

test("addFavoriteItems inserts only the missing items and leaves existing favourites alone", async () => {
  const { store, inserts } = fakeStore({ existing: [{ item_type: "resort", item_id: IDS[0] }] });
  const result = await addFavoriteItems([IDS[0], IDS[1], IDS[2], IDS[1]], { store, source: "hub_lineup" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.added, [IDS[1], IDS[2]]);
  assert.deepEqual(result.already, [IDS[0]]);
  assert.equal(result.existingCount, 1);
  assert.equal(result.firstSave, false, "existing favourites are not a first save");
  assert.deepEqual(inserts.map((row) => row.itemId), [IDS[1], IDS[2]]);
  assert.equal(inserts.every((row) => row.userId === USER.id), true);
});

test("addFavoriteItems is idempotent: a second call inserts nothing", async () => {
  const { store, inserts } = fakeStore();
  const first = await addFavoriteItems(IDS, { store });
  assert.deepEqual(first.added, IDS);
  assert.equal(first.firstSave, true);
  assert.equal(inserts.length, IDS.length);

  const second = await addFavoriteItems(IDS, { store });
  assert.equal(second.ok, true);
  assert.deepEqual(second.added, []);
  assert.deepEqual(second.already, IDS);
  assert.equal(second.existingCount, IDS.length);
  assert.equal(second.firstSave, false);
  assert.equal(inserts.length, IDS.length, "no duplicate insert request");
});

test("typed items save a camera as a camera, not as a resort", async () => {
  const { store, inserts } = fakeStore();
  const result = await addFavoriteItems([{ item_type: "cam", item_id: CAM }], { store, source: "cam_save" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.added, [CAM]);
  assert.deepEqual(inserts, [{ userId: USER.id, itemType: "cam", itemId: CAM }]);
});

test("more than eight items are written without truncation", async () => {
  const nine = Array.from({ length: 9 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
  const { store, inserts } = fakeStore();
  const result = await addFavoriteItems(nine, { store, source: "alert_done" });
  assert.equal(result.ok, true);
  assert.equal(result.added.length, 9);
  assert.equal(inserts.length, 9);
});

test("a unique-constraint race is treated as already saved, without a duplicate event path", async () => {
  const { store } = fakeStore({ insertError: { code: "23505", message: "duplicate key value" } });
  const result = await addFavoriteItems([IDS[0]], { store });
  assert.equal(result.ok, true);
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.already, [IDS[0]]);
});

test("a write failure reports the rows that were already saved for an idempotent retry", async () => {
  const first = fakeStore({ failAfter: 1 });
  const result = await addFavoriteItems(IDS, { store: first.store, source: "alert_done" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "write_failed");
  assert.deepEqual(result.added, [IDS[0]]);
  assert.equal(result.error, "Provider unavailable");
  assert.equal(first.inserts.length, 2);

  // A retry (new store call) reads the rows that did save and inserts only
  // the missing one; nothing is duplicated.
  const retryStore = fakeStore({ existing: [...first.saved.values()] });
  const retry = await addFavoriteItems(IDS, { store: retryStore.store });
  assert.equal(retry.ok, true);
  assert.deepEqual(retry.added, [IDS[1], IDS[2]]);
});

test("a thrown provider error is a recoverable failure that keeps partial inserts", async () => {
  const { store, inserts } = fakeStore({ throwOnInsert: true });
  const result = await addFavoriteItems(IDS, { store });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "write_failed");
  assert.deepEqual(result.added, []);
  assert.match(result.error ?? "", /provider connection reset/);
  assert.equal(inserts.length, 1, "the loop stopped at the thrown insert");
});

test("a hung store call times out instead of leaving the caller saving forever", async () => {
  const { store } = fakeStore({ hang: true });
  const result = await addFavoriteItems([IDS[0]], { store, timeoutMs: 25 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "write_failed");
  assert.match(result.error ?? "", /timed out/);
});

test("a read failure is reported separately from a write failure", async () => {
  const store: FavoriteStore = {
    async getUser() {
      return USER;
    },
    async listFavoriteItems() {
      return { items: [], error: { code: "PGRST", message: "permission denied" } };
    },
    async insertFavorite() {
      return {};
    },
  };
  const result = await addFavoriteItems(IDS, { store });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "read_failed");
  assert.equal(result.error, "permission denied");
});

test("a session that changed mid-flight is not written into the new account", async () => {
  const { store, inserts, listCalls } = fakeStore({ user: { id: "user-2" } });
  const result = await addFavoriteItems(IDS, { store, expectedUserId: ` ${USER.id.toUpperCase()} ` });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "user_changed");
  assert.deepEqual(result.added, []);
  assert.equal(inserts.length, 0, "no row may be written for the wrong account");
  assert.equal(listCalls(), 0, "the mismatch is rejected before reading the new account");
});

test("signed-out and invalid calls never touch the favourites table", async () => {
  const signedOut = fakeStore({ user: null });
  const result = await addFavoriteItems(IDS, { store: signedOut.store });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "signed_out");
  assert.equal(signedOut.inserts.length, 0);

  const invalid = fakeStore();
  const bad = await addFavoriteItems(["not-a-uuid"], { store: invalid.store });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, "invalid");
  assert.equal(invalid.inserts.length, 0);
});

test("addFavoriteResorts keeps the resort-only convenience shape", async () => {
  const { store, inserts } = fakeStore();
  const result = await addFavoriteResorts(IDS, { store, source: "hub_lineup" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.added, IDS);
  assert.equal(inserts.every((row) => row.itemType === "resort"), true);
});
