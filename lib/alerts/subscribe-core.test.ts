import { test } from "node:test";
import assert from "node:assert";
import { handleSubscribe, type SubscribeDeps, type Subscriber } from "./subscribe-core";

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
