import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyStatus,
  describeHttpFailure,
  describeThrownFailure,
  emptyTally,
  extractReason,
  formatFailureLine,
  formatRunWindow,
  formatTally,
  readFailureBody,
  REASON_MAX,
} from "./open-meteo-failure";
import { fetchModelRuns } from "./forecast/open-meteo-models";
import { getOpenMeteoSnapshot } from "./open-meteo";

const NOW = new Date("2026-11-21T07:12:30.000Z");

test("classifyStatus: 429, the 5xx range, everything else", () => {
  const cases: Array<[number, string]> = [
    [429, "429"],
    [500, "5xx"],
    [502, "5xx"],
    [503, "5xx"],
    [599, "5xx"],
    [400, "other"],
    [403, "other"],
    [404, "other"],
    [600, "other"],
  ];
  for (const [status, kind] of cases) assert.equal(classifyStatus(status), kind, String(status));
});

test("extractReason: Open-Meteo's JSON reason, raw text otherwise, clipped", () => {
  assert.equal(extractReason('{"error":true,"reason":"Daily API request limit exceeded. Please try again tomorrow."}'), "Daily API request limit exceeded. Please try again tomorrow.");
  assert.equal(extractReason("<html>\n  502 Bad Gateway\n</html>"), "<html> 502 Bad Gateway </html>");
  assert.equal(extractReason(""), null);
  assert.equal(extractReason(null), null);
  assert.equal(extractReason('{"error":true}'), '{"error":true}');
  const long = extractReason(JSON.stringify({ reason: "x".repeat(500) }));
  assert.equal(long?.length, REASON_MAX + 1);
  assert.ok(long?.endsWith("…"));
});

test("describeHttpFailure keeps Retry-After and rate-limit headers only", () => {
  const headers = new Headers({
    "Retry-After": "60",
    "X-RateLimit-Limit": "10000",
    "X-RateLimit-Remaining": "0",
    "RateLimit-Reset": "38211",
    "Set-Cookie": "session=secret",
    "Content-Type": "application/json",
  });
  const f = describeHttpFailure({ status: 429, headers }, '{"error":true,"reason":"Minutely API request limit exceeded. Please try again in one minute."}', NOW);
  assert.deepEqual(f, {
    at: "2026-11-21T07:12:30.000Z",
    kind: "429",
    status: 429,
    retryAfter: "60",
    rateLimit: { "ratelimit-reset": "38211", "x-ratelimit-limit": "10000", "x-ratelimit-remaining": "0" },
    reason: "Minutely API request limit exceeded. Please try again in one minute.",
    error: null,
  });
  const line = formatFailureLine(f, "Alta summit");
  assert.equal(
    line,
    '2026-11-21T07:12:30.000Z Open-Meteo FAIL Alta summit class=429 status=429 retry-after=60 ratelimit-reset=38211 x-ratelimit-limit=10000 x-ratelimit-remaining=0 reason="Minutely API request limit exceeded. Please try again in one minute."',
  );
  assert.ok(!line.includes("secret"));
  assert.ok(!line.includes("content-type"));
});

test("describeHttpFailure: a 5xx with an HTML body and no headers", () => {
  const f = describeHttpFailure({ status: 503, headers: new Headers() }, "<html>Service Unavailable</html>", NOW);
  assert.equal(f.kind, "5xx");
  assert.equal(f.retryAfter, null);
  assert.deepEqual(f.rateLimit, {});
  assert.equal(formatFailureLine(f, "Mt. Norquay base"), '2026-11-21T07:12:30.000Z Open-Meteo FAIL Mt. Norquay base class=5xx status=503 reason="<html>Service Unavailable</html>"');
});

test("describeThrownFailure: timeout, network, unparseable body", () => {
  const timeout = describeThrownFailure(new DOMException("The operation was aborted due to timeout", "TimeoutError"), NOW);
  assert.equal(timeout.kind, "timeout");
  assert.equal(timeout.status, null);
  assert.equal(formatFailureLine(timeout, "Cerro Catedral"), '2026-11-21T07:12:30.000Z Open-Meteo FAIL Cerro Catedral class=timeout status=none error="TimeoutError: The operation was aborted due to timeout"');

  const network = describeThrownFailure(new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND api.open-meteo.com") }), NOW);
  assert.equal(network.kind, "network");
  assert.equal(network.error, "TypeError: fetch failed (Error: getaddrinfo ENOTFOUND api.open-meteo.com)");

  assert.equal(describeThrownFailure(new SyntaxError("Unexpected token < in JSON"), NOW).kind, "other");
  assert.equal(describeThrownFailure("boom", NOW).error, "Error: boom");
});

test("tally and run window", () => {
  const tally = emptyTally();
  tally["429"] += 250;
  tally.timeout += 4;
  assert.equal(formatTally(tally), "429 250, 5xx 0, timeout 4, network 0, other 0");
  assert.equal(formatRunWindow(new Date("2026-11-21T07:05:05.000Z"), new Date("2026-11-21T07:21:40.400Z")), "started 2026-11-21T07:05:05.000Z, ended 2026-11-21T07:21:40.400Z, took 16m 35s");
  assert.equal(formatRunWindow(NOW, new Date(NOW.getTime() + 42_000)), "started 2026-11-21T07:12:30.000Z, ended 2026-11-21T07:13:12.000Z, took 42s");
});

test("readFailureBody never throws and caps what it keeps", async () => {
  assert.equal(await readFailureBody({ text: async () => "y".repeat(5000) }, 100), "y".repeat(100));
  assert.equal(
    await readFailureBody({
      text: async () => {
        throw new Error("stream closed");
      },
    }),
    null,
  );
});

// The two fetchers, with fetch stubbed: no request leaves the machine.
async function withFetch<T>(stub: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("fetchModelRuns reports a 429 to onFailure and still returns null; one request, no retry", async () => {
  let calls = 0;
  const seen: unknown[] = [];
  const result = await withFetch(
    (async () => {
      calls++;
      return new Response('{"error":true,"reason":"Hourly API request limit exceeded."}', { status: 429, headers: { "Retry-After": "3600" } });
    }) as typeof fetch,
    () => fetchModelRuns({ lat: 40.5, lng: -111.6, elevationFt: 10000, models: ["ecmwf_ifs025"] as never }, {}, (f) => seen.push(f)),
  );
  assert.equal(result, null);
  assert.equal(calls, 1);
  assert.equal(seen.length, 1);
  const f = seen[0] as { kind: string; status: number; retryAfter: string; reason: string };
  assert.deepEqual([f.kind, f.status, f.retryAfter, f.reason], ["429", 429, "3600", "Hourly API request limit exceeded."]);
});

test("fetchModelRuns without a handler behaves as before on failure", async () => {
  const result = await withFetch((async () => new Response("nope", { status: 500 })) as typeof fetch, () => fetchModelRuns({ lat: 40.5, lng: -111.6, elevationFt: null, models: ["gfs_seamless"] as never }));
  assert.equal(result, null);
});

test("getOpenMeteoSnapshot reports a thrown timeout to onFailure and returns null", async () => {
  const seen: Array<{ kind: string; status: number | null }> = [];
  const result = await withFetch(
    (async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }) as typeof fetch,
    () => getOpenMeteoSnapshot(-41.17, -71.44, 3380, (f) => seen.push(f)),
  );
  assert.equal(result, null);
  assert.deepEqual(seen.map((f) => [f.kind, f.status]), [["timeout", null]]);
});
