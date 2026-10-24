import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LINEUP_CLAIM_TTL_MS,
  LINEUP_INTENT_TTL_MS,
  LINEUP_STORAGE_KEY,
  MAX_LINEUP_INTENT,
  MAX_LINEUP_SELECTION,
  claimLineupIntent,
  clearLineupIntent,
  completeLineupIntent,
  lineupEventProperties,
  lineupIntentNote,
  lineupItemKey,
  lineupSignupHeading,
  missingFavoriteIds,
  missingFavoriteItems,
  normalizeLineupIds,
  normalizeLineupItems,
  parseLineupIntent,
  readLineupAttribution,
  readLineupIntent,
  releaseLineupIntentClaim,
  sanitizeLineupSource,
  validateLineupIntent,
  writeLineupIntent,
  type LineupStorage,
} from "./lineup";

const NOW = Date.UTC(2026, 9, 24, 15, 0, 0);
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  const storage: LineupStorage & { map: Map<string, string> } = {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
  return storage;
}

function blockedStorage(): LineupStorage {
  return {
    getItem() {
      throw new DOMException("blocked", "SecurityError");
    },
    setItem() {
      throw new DOMException("blocked", "SecurityError");
    },
    removeItem() {
      throw new DOMException("blocked", "SecurityError");
    },
  };
}

function seed(storage: LineupStorage, items: unknown, source = "hub_lineup", now = NOW, id?: string) {
  const result = writeLineupIntent(storage, items, source, now, id);
  assert.equal(result.ok, true);
  return result.ok ? result.intent : assert.fail("write failed");
}

test("the chooser's UI limit is eight, while the pending/write bound preserves an alert-sized selection", () => {
  assert.equal(MAX_LINEUP_SELECTION, 8);
  assert.ok(MAX_LINEUP_INTENT >= 24, "the alert flow can select all 24 Colorado mountains");
  // Nine items are preserved: the write bound must not silently cap at eight.
  const nine = Array.from({ length: 9 }, (_, i) => id(i + 1));
  assert.equal(normalizeLineupItems(nine).length, 9);
  const storage = memoryStorage();
  const written = writeLineupIntent(storage, nine, "alert_done", NOW);
  assert.equal(written.ok, true);
  if (written.ok) assert.equal(written.intent.items.length, 9);
  // The overall bound still exists.
  const many = Array.from({ length: MAX_LINEUP_INTENT + 5 }, (_, i) => id(i + 1));
  assert.equal(normalizeLineupItems(many).length, MAX_LINEUP_INTENT);
});

test("typed items keep a camera a camera and dedupe by type + id", () => {
  const items = normalizeLineupItems([
    { item_type: "cam", item_id: id(1) },
    { item_type: "cam", item_id: id(1) },
    { item_type: "resort", item_id: id(1) },
    { item_type: "region", item_id: id(2) },
    { item_type: "cam", item_id: "not-a-uuid" },
    id(2),
  ]);
  assert.deepEqual(items, [
    { item_type: "cam", item_id: id(1) },
    { item_type: "resort", item_id: id(1) },
    { item_type: "resort", item_id: id(2) },
  ]);
  assert.equal(lineupItemKey(items[0]), `cam:${id(1)}`);
  assert.deepEqual(normalizeLineupIds([id(1), id(1), id(2)]), [id(1), id(2)]);
});

test("missing items never re-add or remove an existing favourite", () => {
  assert.deepEqual(missingFavoriteIds([id(1), id(2)], [id(2), id(3), id(3), id(4)]), [id(3), id(4)]);
  assert.deepEqual(
    missingFavoriteItems([`cam:${id(1)}`], [
      { item_type: "cam", item_id: id(1) },
      { item_type: "resort", item_id: id(1) },
    ]),
    [{ item_type: "resort", item_id: id(1) }],
  );
  assert.deepEqual(missingFavoriteIds(["junk", id(4)], [id(3), "junk", id(4), id(5)]), [id(3), id(5)]);
});

test("writeLineupIntent -> readLineupIntent round-trips a typed, versioned payload", () => {
  const storage = memoryStorage();
  const result = writeLineupIntent(
    storage,
    [{ item_type: "cam", item_id: id(1) }, { item_type: "resort", item_id: id(2) }],
    "cam_save",
    NOW,
    "intent-token-0001",
  );
  assert.equal(result.ok, true);
  assert.equal(storage.map.has(LINEUP_STORAGE_KEY), true);
  assert.deepEqual(readLineupIntent(storage, NOW), {
    version: 2,
    id: "intent-token-0001",
    items: [
      { item_type: "cam", item_id: id(1) },
      { item_type: "resort", item_id: id(2) },
    ],
    source: "cam_save",
    created_at: NOW,
    user_id: null,
    claim: null,
  });
});

test("an expired intent reads as absent and the first claim cleans it up", () => {
  const storage = memoryStorage();
  seed(storage, [id(1)]);
  assert.ok(readLineupIntent(storage, NOW + LINEUP_INTENT_TTL_MS));
  assert.equal(readLineupIntent(storage, NOW + LINEUP_INTENT_TTL_MS + 1), null);
  assert.deepEqual(claimLineupIntent(storage, USER_A, { now: NOW + LINEUP_INTENT_TTL_MS + 1, token: "tab-token-a" }), {
    ok: false,
    reason: "none",
    intent: null,
  });
  assert.equal(storage.map.has(LINEUP_STORAGE_KEY), false, "expired payload is cleaned up");
});

test("future-dated, malformed, wrong-version and oversized payloads are rejected", () => {
  const base = { version: 2, id: "intent-token-0001", items: [{ item_type: "resort", item_id: id(1) }], created_at: NOW, source: "hub_lineup", user_id: null, claim: null };
  assert.equal(validateLineupIntent({ ...base, created_at: NOW + 10 * 60 * 1000 }, NOW), null, "clock skew beyond five minutes");
  assert.equal(validateLineupIntent({ ...base, version: 1 }, NOW), null);
  assert.equal(validateLineupIntent({ ...base, items: [] }, NOW), null);
  assert.equal(validateLineupIntent({ ...base, created_at: "now" }, NOW), null);
  assert.equal(validateLineupIntent(null, NOW), null);
  assert.equal(parseLineupIntent("{", NOW), null);
  assert.equal(parseLineupIntent("x".repeat(32_769), NOW), null);
  // A small amount of skew in the future is tolerated, but the intent still expires normally.
  assert.ok(validateLineupIntent({ ...base, created_at: NOW + 60_000 }, NOW));
  // A bad claim is dropped rather than letting the whole record be unusable.
  assert.equal(validateLineupIntent({ ...base, claim: { token: "x", started_at: NOW } }, NOW)?.claim, null);
});

test("blocked storage is reported as blocked, not as an invalid empty selection", () => {
  const storage = blockedStorage();
  assert.deepEqual(writeLineupIntent(storage, [id(1)], "hub_lineup", NOW), { ok: false, reason: "blocked" });
  // No storage at all (server render, policy) is also a blocked write, not an
  // empty selection.
  assert.deepEqual(writeLineupIntent(null, [id(1)], "hub_lineup", NOW), { ok: false, reason: "blocked" });
  assert.deepEqual(writeLineupIntent(storage, [], "hub_lineup", NOW), { ok: false, reason: "invalid" });
  assert.equal(readLineupIntent(storage, NOW), null);
  assert.equal(clearLineupIntent(storage), false);
  assert.equal(claimLineupIntent(storage, USER_A).ok, false);
});

test("a claim is exclusive across tabs, reclaimable after reload or lease expiry, and user-bound", () => {
  const storage = memoryStorage();
  seed(storage, [id(1)], "hub_lineup", NOW, "intent-token-0001");

  const first = claimLineupIntent(storage, USER_A, { now: NOW, token: "tab-token-a" });
  assert.equal(first.ok, true);
  if (first.ok) assert.equal(first.intent.claim?.token, "tab-token-a");

  // Another tab sees a fresh claim and backs off.
  const second = claimLineupIntent(storage, USER_A, { now: NOW + 1_000, token: "tab-token-b" });
  assert.deepEqual(second, { ok: false, reason: "busy", intent: second.ok ? null : second.intent });

  // The same tab token is the reload/interrupted-work case: it may resume instantly.
  const resumed = claimLineupIntent(storage, USER_A, { now: NOW + 2_000, token: "tab-token-a" });
  assert.equal(resumed.ok, true);

  // After the lease, a different tab may take over (best effort — the DB
  // unique constraint is the final guard).
  const stale = claimLineupIntent(storage, USER_A, {
    now: NOW + 2_000 + LINEUP_CLAIM_TTL_MS + 1,
    token: "tab-token-b",
  });
  assert.equal(stale.ok, true);

  // A different signed-in account must not inherit the failed/pending work.
  const mismatch = claimLineupIntent(storage, USER_B, { now: NOW + 3_000, token: "tab-token-c" });
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) {
    assert.equal(mismatch.reason, "user_mismatch");
    assert.equal(mismatch.intent?.user_id, USER_A);
  }
});

test("a failure releases the claim and a retry after a reload finishes the same intent", () => {
  const storage = memoryStorage();
  seed(storage, [id(1), id(2)], "hub_lineup", NOW, "intent-token-0001");
  const claim = claimLineupIntent(storage, USER_A, { now: NOW, token: "tab-token-a" });
  assert.equal(claim.ok, true);
  if (!claim.ok) return;

  // The write failed: release, don't delete. The items and the user binding stay.
  assert.equal(releaseLineupIntentClaim(storage, claim.intent.id, claim.token), true);
  assert.deepEqual(readLineupIntent(storage, NOW + 1_000)?.items, [
    { item_type: "resort", item_id: id(1) },
    { item_type: "resort", item_id: id(2) },
  ]);
  assert.equal(readLineupIntent(storage, NOW + 1_000)?.user_id, USER_A);

  // A reload has a new in-memory guard but the same tab token; it can claim
  // and retry immediately (or with a fresh token after the lease).
  const retry = claimLineupIntent(storage, USER_A, { now: NOW + 2_000, token: "tab-token-a" });
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(completeLineupIntent(storage, retry.intent.id, retry.token), true);
  assert.equal(storage.map.has(LINEUP_STORAGE_KEY), false);
});

test("an old failure/success cannot overwrite or clear a newer selection", () => {
  const storage = memoryStorage();
  seed(storage, [id(1)], "hub_lineup", NOW, "intent-old-0001");
  const oldClaim = claimLineupIntent(storage, USER_A, { now: NOW, token: "tab-token-a" });
  assert.equal(oldClaim.ok, true);
  if (!oldClaim.ok) return;

  // A newer selection arrives while the old write is in flight.
  const newer = writeLineupIntent(storage, [id(2)], "hub_lineup", NOW + 500, "intent-new-0002");
  assert.equal(newer.ok, true);

  // The old save's failure release and its success clear are both no-ops.
  assert.equal(releaseLineupIntentClaim(storage, oldClaim.intent.id, oldClaim.token), false);
  assert.equal(completeLineupIntent(storage, oldClaim.intent.id, oldClaim.token), false);
  assert.deepEqual(readLineupIntent(storage, NOW + 1_000)?.items, [{ item_type: "resort", item_id: id(2) }]);

  // A stale tab holding the old token also cannot clear the new intent once
  // another tab has claimed it for the save.
  const newClaim = claimLineupIntent(storage, USER_A, { now: NOW + 600, token: "tab-token-b" });
  assert.equal(newClaim.ok, true);
  assert.equal(completeLineupIntent(storage, "intent-new-0002", oldClaim.token), false);
  assert.equal(storage.map.has(LINEUP_STORAGE_KEY), true);
  assert.equal(completeLineupIntent(storage, "intent-new-0002", "tab-token-b"), true);
});

test("attribution is bounded and only allowlisted labels survive", () => {
  const storage = memoryStorage();
  seed(storage, [id(1), id(2)], "hub_lineup", NOW);
  assert.deepEqual(readLineupAttribution(storage, NOW), { lineup_source: "hub_lineup", lineup_count: 2 });
  assert.equal(readLineupAttribution(null, NOW), null);

  assert.equal(sanitizeLineupSource("hub_lineup"), "hub_lineup");
  assert.equal(sanitizeLineupSource("Hub:Colorado"), "unknown");
  assert.equal(sanitizeLineupSource("skier@example.com"), "unknown");
  assert.equal(sanitizeLineupSource("https://peakcam.io/?email=a@b.co"), "unknown");
  assert.deepEqual(lineupEventProperties("skier@example.com", "https://peakcam.io", 999), {
    source: "unknown",
    surface: "unknown",
    selected_count: MAX_LINEUP_INTENT,
  });
});

test("signup headline and intent note use the real count", () => {
  assert.equal(lineupSignupHeading(1, "Breckenridge"), "Save Breckenridge.");
  assert.equal(lineupSignupHeading(1, "  "), "Save this mountain.");
  assert.equal(lineupSignupHeading(3, "Breckenridge"), "Save your 3 mountains.");
  assert.equal(lineupSignupHeading(0, "Breckenridge"), "Save Breckenridge.");
  assert.equal(lineupSignupHeading(999), `Save your ${MAX_LINEUP_INTENT} mountains.`);
  assert.match(lineupIntentNote(1), /this mountain/);
  assert.match(lineupIntentNote(9), /these 9 mountains/);
  assert.match(lineupIntentNote(1, "camera"), /this camera/);
});

test("clearLineupIntent removes the record unconditionally (explicit discard only)", () => {
  const storage = memoryStorage();
  seed(storage, [id(1)]);
  assert.equal(clearLineupIntent(storage), true);
  assert.equal(storage.map.has(LINEUP_STORAGE_KEY), false);
});
