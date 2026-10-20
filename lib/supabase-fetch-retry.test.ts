import { test } from "node:test";
import assert from "node:assert";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "anon-test-key";

const mod = import("./supabase");
const retry = async (...args: Parameters<typeof import("./supabase").withFetchRetry>) => (await mod).withFetchRetry(...args);

type Call = { method: string };
function fakeFetch(outcomes: Array<number | Error>, calls: Call[]): typeof fetch {
  let i = 0;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ method: (init?.method ?? "GET").toUpperCase() });
    const outcome = outcomes[Math.min(i, outcomes.length - 1)];
    i += 1;
    if (outcome instanceof Error) throw outcome;
    return new Response(outcome >= 400 ? '{"code":"PGRST002"}' : "[]", { status: outcome });
  }) as typeof fetch;
}

const NO_DELAY = [0, 0, 0];

test("a GET that gets 503 twice then 200 returns the 200", async () => {
  const calls: Call[] = [];
  const f = await retry(fakeFetch([503, 503, 200], calls), NO_DELAY);
  const res = await f("http://x/rest/v1/resorts");
  assert.strictEqual(res.status, 200);
  assert.strictEqual(calls.length, 3);
});

test("a GET that keeps failing returns the last 503 after the retry budget", async () => {
  const calls: Call[] = [];
  const f = await retry(fakeFetch([503], calls), NO_DELAY);
  const res = await f("http://x/rest/v1/resorts");
  assert.strictEqual(res.status, 503);
  assert.strictEqual(calls.length, 4); // first attempt + 3 retries
});

test("a transient abort on a GET is retried", async () => {
  const calls: Call[] = [];
  const abort = new DOMException("The operation was aborted due to timeout", "TimeoutError");
  const f = await retry(fakeFetch([abort, 200], calls), NO_DELAY);
  const res = await f("http://x/rest/v1/resorts");
  assert.strictEqual(res.status, 200);
  assert.strictEqual(calls.length, 2);
});

test("a POST is never retried, even on 503", async () => {
  const calls: Call[] = [];
  const f = await retry(fakeFetch([503, 200], calls), NO_DELAY);
  const res = await f("http://x/rest/v1/snow_reports", { method: "POST" });
  assert.strictEqual(res.status, 503);
  assert.strictEqual(calls.length, 1);
});

test("a 4xx is returned as-is without retrying", async () => {
  const calls: Call[] = [];
  const f = await retry(fakeFetch([404, 200], calls), NO_DELAY);
  const res = await f("http://x/rest/v1/nothing");
  assert.strictEqual(res.status, 404);
  assert.strictEqual(calls.length, 1);
});

test("a caller-aborted signal stops retries", async () => {
  const calls: Call[] = [];
  const ctrl = new AbortController();
  ctrl.abort();
  const f = await retry(fakeFetch([new Error("aborted")], calls), NO_DELAY);
  await assert.rejects(f("http://x/rest/v1/resorts", { signal: ctrl.signal }));
  assert.strictEqual(calls.length, 1);
});
