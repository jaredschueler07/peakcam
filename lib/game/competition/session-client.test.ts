import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RUN_SESSIONS_ENDPOINT,
  isRunSessionFailure,
  requestRunSession,
  type RunSessionResult,
} from "./session-client";

const OK_BODY = {
  ticket: "hdr.payload.sig",
  seed: 12345,
  resortSlug: "ski-portillo",
  mode: "time_trial",
  trailId: "roca-jack",
  physicsVersion: 1,
  courseVersion: 1,
  tickHz: 10,
  expiresAt: "2026-08-01T00:30:00.000Z",
};

function jsonFetch(body: unknown, status = 201): typeof fetch {
  return (async () => Response.json(body, { status })) as unknown as typeof fetch;
}

function ticketOf(result: RunSessionResult) {
  assert.ok(!isRunSessionFailure(result), `expected a ticket, got ${JSON.stringify(result)}`);
  return result;
}

test("a 201 response is parsed into a ticket", async () => {
  const result = await requestRunSession(
    { resortSlug: "ski-portillo", mode: "time_trial", trailId: "roca-jack" },
    { fetchImpl: jsonFetch(OK_BODY) },
  );
  assert.deepEqual(ticketOf(result), OK_BODY);
});

test("the request posts JSON to the sessions endpoint with no-store", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const spy = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return Response.json(OK_BODY, { status: 201 });
  }) as unknown as typeof fetch;

  await requestRunSession(
    { resortSlug: "breckenridge", mode: "score_attack", trailId: "peak-8" },
    { fetchImpl: spy },
  );

  assert.ok(seen);
  const call = seen as { url: string; init: RequestInit };
  assert.equal(call.url, RUN_SESSIONS_ENDPOINT);
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.cache, "no-store");
  assert.equal((call.init.headers as Record<string, string>)["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(String(call.init.body)), {
    resortSlug: "breckenridge",
    mode: "score_attack",
    trailId: "peak-8",
  });
});

test("a server error body surfaces its message, not an exception", async () => {
  const result = await requestRunSession(
    { resortSlug: "ski-portillo", mode: "time_trial", trailId: "nope" },
    { fetchImpl: jsonFetch({ error: "Unknown resort or trail" }, 404) },
  );
  assert.ok(isRunSessionFailure(result));
  assert.equal(result.error, "Unknown resort or trail");
  assert.equal(result.aborted, undefined);
});

test("an error status with an unreadable body still fails cleanly", async () => {
  const broken = (async () => new Response("<html>502</html>", { status: 502 })) as unknown as typeof fetch;
  const result = await requestRunSession(
    { resortSlug: "ski-portillo", mode: "time_trial", trailId: "roca-jack" },
    { fetchImpl: broken },
  );
  assert.ok(isRunSessionFailure(result));
  assert.match(result.error, /502/);
});

test("a 2xx body that does not match the ticket schema is a failure, not a bad ticket", async () => {
  const result = await requestRunSession(
    { resortSlug: "ski-portillo", mode: "time_trial", trailId: "roca-jack" },
    { fetchImpl: jsonFetch({ ...OK_BODY, seed: "not-a-number" }) },
  );
  assert.ok(isRunSessionFailure(result));
  assert.match(result.error, /unexpected/i);
});

test("a mode outside the competitive enum is rejected by the client parser", async () => {
  const result = await requestRunSession(
    { resortSlug: "ski-portillo", mode: "time_trial", trailId: "roca-jack" },
    { fetchImpl: jsonFetch({ ...OK_BODY, mode: "free_ski" }) },
  );
  assert.ok(isRunSessionFailure(result));
});

test("a network rejection is reported as offline, never thrown", async () => {
  const offline = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;
  const result = await requestRunSession(
    { resortSlug: "heavenly", mode: "time_trial", trailId: "gunbarrel" },
    { fetchImpl: offline },
  );
  assert.ok(isRunSessionFailure(result));
  assert.match(result.error, /Failed to fetch/);
});

test("an aborted request resolves to a flagged failure the caller can ignore", async () => {
  const controller = new AbortController();
  const hang = ((_url: string, init: RequestInit) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })) as unknown as typeof fetch;

  const pending = requestRunSession(
    { resortSlug: "heavenly", mode: "time_trial", trailId: "gunbarrel" },
    { fetchImpl: hang, signal: controller.signal },
  );
  controller.abort();

  const result = await pending;
  assert.ok(isRunSessionFailure(result));
  assert.equal(result.aborted, true);
});

test("a signal already aborted short-circuits without calling fetch", async () => {
  let calls = 0;
  const spy = (async () => {
    calls++;
    return Response.json(OK_BODY, { status: 201 });
  }) as unknown as typeof fetch;

  const result = await requestRunSession(
    { resortSlug: "heavenly", mode: "time_trial", trailId: "gunbarrel" },
    { fetchImpl: spy, signal: AbortSignal.abort() },
  );
  assert.equal(calls, 0);
  assert.ok(isRunSessionFailure(result));
  assert.equal(result.aborted, true);
});
