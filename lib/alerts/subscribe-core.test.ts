import { test } from "node:test";
import assert from "node:assert";
import { NextRequest } from "next/server";
import {
  clampThreshold,
  handleSubscribe,
  parsePreferenceUpdate,
  type SubscribeDeps,
  type Subscriber,
} from "./subscribe-core";

const RESORTS = [
  { id: "r-alta", name: "Alta" },
  { id: "r-brighton", name: "Brighton" },
];

interface Calls {
  created: string[];
  prefsInserted: Array<{ subscriber_id: string; resort_id: string; threshold_inches: number }>;
  welcome: Array<{ email: string; manageToken: string }>;
  manageLink: Array<{ email: string; manageToken: string }>;
}

function makeDeps(existing: Subscriber | null): { deps: SubscribeDeps; calls: Calls } {
  const calls: Calls = { created: [], prefsInserted: [], welcome: [], manageLink: [] };
  const deps: SubscribeDeps = {
    async findSubscriberByEmail() {
      return existing;
    },
    async createSubscriber(email) {
      calls.created.push(email);
      return { id: "sub-new", email, manage_token: "tok-new" };
    },
    async findActiveResorts(ids) {
      return RESORTS.filter((r) => ids.includes(r.id));
    },
    async insertPreferences(prefs) {
      calls.prefsInserted.push(...prefs);
      return true;
    },
    async sendWelcomeEmail(p) {
      calls.welcome.push({ email: p.email, manageToken: p.manageToken });
    },
    async sendManageLinkEmail(p) {
      calls.manageLink.push(p);
    },
    logError() {},
  };
  return { deps, calls };
}

const NEW_BODY = {
  email: "New.Skier@Example.com",
  resort_ids: ["r-alta", "r-brighton"],
  thresholds: { "r-alta": 12 },
};

test("a new email creates the subscriber and its preferences", async () => {
  const { deps, calls } = makeDeps(null);
  const result = await handleSubscribe(NEW_BODY, deps);

  assert.strictEqual(result.status, 200);
  assert.deepStrictEqual(calls.created, ["new.skier@example.com"]);
  assert.deepStrictEqual(calls.prefsInserted, [
    { subscriber_id: "sub-new", resort_id: "r-alta", threshold_inches: 12 },
    { subscriber_id: "sub-new", resort_id: "r-brighton", threshold_inches: 6 },
  ]);
  assert.strictEqual(calls.welcome.length, 1);
  assert.strictEqual(calls.manageLink.length, 0);
});

test("an existing email is never mutated — no create, no preference writes", async () => {
  const existing: Subscriber = {
    id: "sub-victim",
    email: "victim@example.com",
    manage_token: "tok-victim",
  };
  const { deps, calls } = makeDeps(existing);

  const result = await handleSubscribe(
    { email: "victim@example.com", resort_ids: ["r-alta"], thresholds: { "r-alta": 1 } },
    deps
  );

  assert.strictEqual(result.status, 200);
  assert.deepStrictEqual(calls.created, []);
  assert.deepStrictEqual(calls.prefsInserted, []);
  assert.strictEqual(calls.welcome.length, 0);
  // The manage link goes to the subscriber's own address, not to anything the
  // caller supplied.
  assert.deepStrictEqual(calls.manageLink, [
    { email: "victim@example.com", manageToken: "tok-victim" },
  ]);
});

test("the response is byte-identical for a new and an existing address", async () => {
  const { deps: newDeps } = makeDeps(null);
  const { deps: existingDeps } = makeDeps({
    id: "sub-1",
    email: "taken@example.com",
    manage_token: "tok-1",
  });

  const forNew = await handleSubscribe(NEW_BODY, newDeps);
  const forExisting = await handleSubscribe(
    { email: "taken@example.com", resort_ids: ["r-alta"] },
    existingDeps
  );

  assert.strictEqual(forNew.status, forExisting.status);
  assert.deepStrictEqual(forNew.body, forExisting.body);
  // and it discloses nothing about the stored subscription
  assert.deepStrictEqual(Object.keys(forNew.body).sort(), ["message", "ok"]);
});

test("a lost create race is treated as an existing subscription, not a failure", async () => {
  const raced: Subscriber = { id: "sub-r", email: "race@example.com", manage_token: "tok-r" };
  let lookups = 0;
  const calls: string[] = [];
  const deps: SubscribeDeps = {
    ...makeDeps(null).deps,
    async findSubscriberByEmail() {
      // absent on the first look, present after the concurrent insert landed
      return lookups++ === 0 ? null : raced;
    },
    async createSubscriber() {
      return null; // unique violation on email
    },
    async insertPreferences() {
      calls.push("prefs");
      return true;
    },
    async sendManageLinkEmail() {
      calls.push("manage-link");
    },
  };

  const result = await handleSubscribe(
    { email: "race@example.com", resort_ids: ["r-alta"] },
    deps
  );

  assert.strictEqual(result.status, 200);
  assert.deepStrictEqual(calls, ["manage-link"]);
});

test("a genuine create failure still reports 500", async () => {
  const deps: SubscribeDeps = {
    ...makeDeps(null).deps,
    async createSubscriber() {
      return null;
    },
  };
  const result = await handleSubscribe({ email: "x@example.com", resort_ids: ["r-alta"] }, deps);
  assert.strictEqual(result.status, 500);
});

test("validation rejects bad input before any lookup", async () => {
  const { deps } = makeDeps(null);
  assert.strictEqual((await handleSubscribe({}, deps)).status, 400);
  assert.strictEqual((await handleSubscribe({ email: "a@b.co" }, deps)).status, 400);
  assert.strictEqual(
    (await handleSubscribe({ email: "nope", resort_ids: ["r-alta"] }, deps)).status,
    400
  );
  assert.strictEqual(
    (await handleSubscribe({ email: "a@b.co", resort_ids: ["ghost"] }, deps)).status,
    400
  );
});

test("unknown resort ids fail identically for new and existing addresses", async () => {
  const { deps: newDeps } = makeDeps(null);
  const { deps: existingDeps } = makeDeps({
    id: "s",
    email: "a@b.co",
    manage_token: "t",
  });
  const body = { email: "a@b.co", resort_ids: ["ghost"] };

  const forNew = await handleSubscribe(body, newDeps);
  const forExisting = await handleSubscribe(body, existingDeps);
  assert.strictEqual(forNew.status, forExisting.status);
  assert.deepStrictEqual(forNew.body, forExisting.body);
});

test("thresholds are clamped to 1-48", async () => {
  const { deps, calls } = makeDeps(null);
  await handleSubscribe(
    {
      email: "a@b.co",
      resort_ids: ["r-alta", "r-brighton"],
      thresholds: { "r-alta": 9999, "r-brighton": -5 },
    },
    deps
  );
  assert.deepStrictEqual(
    calls.prefsInserted.map((p) => p.threshold_inches),
    [48, 1]
  );
});

// ─── clampThreshold / PUT /api/alerts/manage body validation ──────────────────

const ALTA = "11111111-1111-4111-8111-111111111111";
const BRIGHTON = "22222222-2222-4222-8222-222222222222";

test("clampThreshold rounds, clamps to 1-48 and defaults anything non-numeric to 6", () => {
  assert.strictEqual(clampThreshold(12), 12);
  assert.strictEqual(clampThreshold(11.6), 12);
  assert.strictEqual(clampThreshold(9999), 48);
  assert.strictEqual(clampThreshold(-5), 1);
  assert.strictEqual(clampThreshold(0), 1);
  for (const bad of [undefined, null, "12", NaN, Infinity, {}]) {
    assert.strictEqual(clampThreshold(bad), 6, `clampThreshold(${String(bad)})`);
  }
});

test("parsePreferenceUpdate accepts a well-formed body, dedupes ids and clamps thresholds", () => {
  const parsed = parsePreferenceUpdate({
    token: "tok",
    resort_ids: [ALTA, BRIGHTON, ALTA],
    thresholds: { [ALTA]: 12.4, [BRIGHTON]: 500, "ghost": "ignored" },
  });
  assert.deepStrictEqual(parsed, {
    ok: true,
    value: { token: "tok", resortIds: [ALTA, BRIGHTON], thresholds: { [ALTA]: 12, [BRIGHTON]: 48 } },
  });
  // No thresholds at all, and an empty selection, are both valid saves.
  const bare = parsePreferenceUpdate({ token: "tok", resort_ids: [ALTA] });
  assert.ok(bare.ok);
  assert.deepStrictEqual(bare.value.thresholds, { [ALTA]: 6 });
  const none = parsePreferenceUpdate({ token: "tok", resort_ids: [], thresholds: null });
  assert.ok(none.ok);
  assert.deepStrictEqual(none.value, { token: "tok", resortIds: [], thresholds: {} });
});

test("parsePreferenceUpdate rejects every shape that used to reach the database", () => {
  const failures: Array<[unknown, RegExp]> = [
    [null, /token/],
    [{ resort_ids: [ALTA] }, /token/],
    [{ token: "", resort_ids: [ALTA] }, /token/],
    [{ token: "tok" }, /resort_ids/],
    [{ token: "tok", resort_ids: "alta" }, /resort_ids/],
    [{ token: "tok", resort_ids: [ALTA, 42] }, /resort_ids/],
    [{ token: "tok", resort_ids: ["not-a-uuid"] }, /resort_ids/],
    [{ token: "tok", resort_ids: [ALTA], thresholds: [] }, /thresholds/],
    // The original data-loss trigger: a non-numeric threshold became NaN.
    [{ token: "tok", resort_ids: [ALTA], thresholds: { [ALTA]: "six" } }, /threshold for/],
    [{ token: "tok", resort_ids: [ALTA], thresholds: { [ALTA]: NaN } }, /threshold for/],
    [{ token: "tok", resort_ids: [ALTA], thresholds: { [ALTA]: {} } }, /threshold for/],
  ];
  for (const [body, message] of failures) {
    const parsed = parsePreferenceUpdate(body);
    assert.strictEqual(parsed.ok, false, JSON.stringify(body));
    if (!parsed.ok) assert.match(parsed.error, message);
  }
  const tooMany = parsePreferenceUpdate({
    token: "tok",
    resort_ids: Array.from({ length: 201 }, (_, i) => `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`),
  });
  assert.strictEqual(tooMany.ok, false);
});

test("PUT /api/alerts/manage validates before any write and upserts before it prunes", async () => {
  const savedEnv = { ...process.env };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://db.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
  const { PUT } = await import("../../app/api/alerts/manage/route");
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; path: string; body?: unknown; prefer?: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    calls.push({
      method: init?.method ?? "GET",
      path: url.pathname.replace("/rest/v1", "") + url.search,
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      ...(headers.get("Prefer") ? { prefer: headers.get("Prefer")! } : {}),
    });
    if (url.pathname.endsWith("/alert_subscribers")) return new Response(JSON.stringify([{ id: "sub-1" }]));
    if (url.pathname.endsWith("/resorts")) return new Response(JSON.stringify([{ id: ALTA }]));
    return new Response("[]", { status: 200 });
  };
  const put = (body: unknown) => PUT(new NextRequest("https://peakcam.test/api/alerts/manage", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
  try {
    // A body the old code would have DELETEd for, then failed to re-insert.
    const bad = await put({ token: "tok", resort_ids: [ALTA], thresholds: { [ALTA]: "six" } });
    assert.strictEqual(bad.status, 400);
    assert.strictEqual(calls.length, 0, "no database call before validation passes");

    // A resort that no longer exists is dropped in validation, not by the FK.
    const good = await put({ token: "tok", resort_ids: [ALTA, BRIGHTON], thresholds: { [ALTA]: 12 } });
    assert.strictEqual(good.status, 200);
    assert.deepStrictEqual(await good.json(), { ok: true, resort_count: 1 });
    assert.deepStrictEqual(calls.map((c) => c.method), ["GET", "GET", "POST", "DELETE"]);
    assert.match(calls[0].path, /^\/alert_subscribers\?manage_token=eq\.tok/);
    assert.match(calls[1].path, /^\/resorts\?id=in\.\(.*\)&is_active=eq\.true/);
    assert.strictEqual(calls[2].path, "/alert_preferences?on_conflict=subscriber_id,resort_id");
    assert.strictEqual(calls[2].prefer, "resolution=merge-duplicates");
    assert.deepStrictEqual(calls[2].body, [{ subscriber_id: "sub-1", resort_id: ALTA, threshold_inches: 12 }]);
    // The prune keeps what was just upserted and only removes the rest.
    assert.strictEqual(calls[3].path, `/alert_preferences?subscriber_id=eq.sub-1&resort_id=not.in.(${encodeURIComponent(`"${ALTA}"`)})`);

    // Clearing every resort keeps the subscriber and deletes all their rows.
    calls.length = 0;
    const cleared = await put({ token: "tok", resort_ids: [] });
    assert.strictEqual(cleared.status, 200);
    assert.deepStrictEqual(calls.map((c) => `${c.method} ${c.path}`), [
      "GET /alert_subscribers?manage_token=eq.tok&select=id&limit=1",
      "DELETE /alert_preferences?subscriber_id=eq.sub-1",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
      if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key];
    }
  }
});
