import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_THRESHOLD,
  LEAD_SENT_KEY,
  THRESHOLD_OPTIONS,
  buildSubscribePayload,
  isValidEmail,
  markLeadSent,
  parseResortSlugsParam,
  parseThresholdParam,
  readLeadSent,
  subscribeErrorMessage,
  suggestMoreResorts,
  thresholdOptionsFor,
} from "./client";

test("buildSubscribePayload trims the email, dedupes ids and defaults thresholds", () => {
  assert.deepEqual(
    buildSubscribePayload({
      email: "  Skier@Example.com ",
      resortIds: ["r-alta", "r-brighton", "r-alta"],
      thresholds: { "r-alta": 12 },
    }),
    {
      email: "Skier@Example.com",
      resort_ids: ["r-alta", "r-brighton"],
      thresholds: { "r-alta": 12, "r-brighton": DEFAULT_THRESHOLD },
    }
  );
  // No thresholds at all → every resort gets the default.
  assert.deepEqual(buildSubscribePayload({ email: "a@b.co", resortIds: ["x"] }).thresholds, { x: 6 });
});

test("isValidEmail mirrors the server's shape check", () => {
  assert.equal(isValidEmail("skier@example.com"), true);
  assert.equal(isValidEmail("  skier@example.com  "), true);
  assert.equal(isValidEmail("skier@example"), false);
  assert.equal(isValidEmail("not an email"), false);
  assert.equal(isValidEmail(""), false);
});

test("subscribeErrorMessage maps statuses to friendly copy", () => {
  assert.equal(subscribeErrorMessage(400), "Check your email address and pick at least one resort");
  assert.equal(subscribeErrorMessage(429), "Too many attempts, try again in a minute");
  for (const status of [0, 500, 502, 503]) {
    assert.equal(subscribeErrorMessage(status), "Something went wrong. Please try again.", String(status));
  }
});

test("parseResortSlugsParam accepts a comma list and drops junk and repeats", () => {
  assert.deepEqual(parseResortSlugsParam("breckenridge,vail"), ["breckenridge", "vail"]);
  assert.deepEqual(parseResortSlugsParam(" Breckenridge , VAIL,,vail "), ["breckenridge", "vail"]);
  assert.deepEqual(parseResortSlugsParam("ok-slug,bad slug!,<script>,ski-portillo"), ["ok-slug", "ski-portillo"]);
  assert.deepEqual(parseResortSlugsParam(""), []);
  assert.deepEqual(parseResortSlugsParam(null), []);
  assert.deepEqual(parseResortSlugsParam(undefined), []);
});

test("parseThresholdParam snaps to the nearest picker option", () => {
  assert.equal(parseThresholdParam("12"), 12);
  assert.equal(parseThresholdParam("8"), 8, "the resort-page capture's 8″ round-trips");
  assert.equal(parseThresholdParam("7"), 6, "ties round down");
  assert.equal(parseThresholdParam("10"), 8, "ties round down");
  assert.equal(parseThresholdParam("11"), 12);
  assert.equal(parseThresholdParam("100"), 24);
  assert.equal(parseThresholdParam("-3"), 3);
  assert.equal(parseThresholdParam("abc"), undefined);
  assert.equal(parseThresholdParam(""), undefined);
  assert.equal(parseThresholdParam(null), undefined);
});

test("thresholdOptionsFor shows an out-of-list value without dropping the shared options", () => {
  assert.equal(thresholdOptionsFor(6), THRESHOLD_OPTIONS);
  assert.equal(thresholdOptionsFor(8), THRESHOLD_OPTIONS, "the resort-page capture's 8″ is a shared option");
  assert.deepEqual(thresholdOptionsFor(10), [3, 6, 8, 10, 12, 18, 24]);
  assert.deepEqual(thresholdOptionsFor(48), [3, 6, 8, 12, 18, 24, 48]);
  // The shared list itself is never mutated by the fallback.
  assert.deepEqual(THRESHOLD_OPTIONS, [3, 6, 8, 12, 18, 24]);
});

test("suggestMoreResorts leads with the subscriber's states, then popular elsewhere", () => {
  const resorts = [
    { id: "breck", name: "Breckenridge", slug: "breckenridge", state: "CO" },
    { id: "vail", name: "Vail", slug: "vail", state: "CO" },
    { id: "abasin", name: "Arapahoe Basin", slug: "arapahoe-basin", state: "CO" },
    { id: "copper", name: "Copper Mountain", slug: "copper-mountain", state: "CO" },
    { id: "alta", name: "Alta", slug: "alta", state: "UT" },
    { id: "pc", name: "Park City", slug: "park-city", state: "UT" },
    { id: "jh", name: "Jackson Hole", slug: "jackson-hole", state: "WY" },
    { id: "obscure", name: "Zed Hill", slug: "zed-hill", state: "MI" },
  ];
  // Subscribed to Breck: other CO resorts first (Vail is curated-popular, then
  // the rest alphabetically), then the curated list from other states.
  assert.deepEqual(
    suggestMoreResorts(resorts, ["breck"]).map((r) => r.id),
    ["vail", "abasin", "copper", "pc", "jh", "alta"]
  );
  // The subscribed resort itself is never suggested; limit is honoured.
  assert.deepEqual(suggestMoreResorts(resorts, ["breck", "vail"], 2).map((r) => r.id), ["abasin", "copper"]);
  // A state with nothing else falls straight through to the popular list; the
  // uncurated MI resort never appears.
  assert.deepEqual(suggestMoreResorts(resorts, ["obscure"]).map((r) => r.id), ["vail", "pc", "jh", "breck", "alta"]);
  // Nothing subscribed (defensive): just the curated list, in rank order.
  assert.deepEqual(suggestMoreResorts(resorts, []).map((r) => r.id), ["vail", "pc", "jh", "breck", "alta"]);
});

// ── Latch ────────────────────────────────────────────────────
// Node has no `window`; install a stub for the duration of `fn`, the same way
// lib/analytics-events.test.ts does.

type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

async function withWindow(storage: Storage | null, fn: () => void) {
  const g = globalThis as { window?: object };
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, "window");
  const prevWindow = g.window;
  g.window = storage
    ? { localStorage: storage }
    : {
        get localStorage(): Storage {
          throw new Error("SecurityError: storage disabled");
        },
      };
  try {
    fn();
  } finally {
    if (hadWindow) g.window = prevWindow;
    else Reflect.deleteProperty(g, "window");
  }
}

test("lead latch is unset until markLeadSent, then set for the browser", async () => {
  const store = new Map<string, string>();
  const storage: Storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
  };
  await withWindow(storage, () => {
    assert.equal(readLeadSent(), false);
    markLeadSent();
    assert.equal(readLeadSent(), true);
    assert.equal(store.get(LEAD_SENT_KEY), "1");
  });
});

test("lead latch fails open when storage is unavailable", async () => {
  await withWindow(null, () => {
    assert.equal(readLeadSent(), false);
    assert.doesNotThrow(() => markLeadSent());
    assert.equal(readLeadSent(), false);
  });
  // No window at all (server): same answer, no throw.
  assert.equal(typeof window, "undefined");
  assert.equal(readLeadSent(), false);
  assert.doesNotThrow(() => markLeadSent());
});
