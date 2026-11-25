import { test } from "node:test";
import assert from "node:assert/strict";
import type { OpenMeteoFailure } from "./open-meteo-failure";
import { MINUTELY_WAIT_MS, RETRY_BASE_MS, parseRetryAfterMs, retryDelayMs, withOpenMeteoRetry } from "./open-meteo-retry";

const NOW = new Date("2026-11-24T07:05:00Z");
const fail = (over: Partial<OpenMeteoFailure> = {}): OpenMeteoFailure => ({ at: NOW.toISOString(), kind: "5xx", status: 502, retryAfter: null, rateLimit: {}, reason: null, error: null, ...over });

test("Retry-After reads as seconds or an HTTP date", () => {
  assert.equal(parseRetryAfterMs("12", NOW), 12_000);
  assert.equal(parseRetryAfterMs("Tue, 24 Nov 2026 07:05:30 GMT", NOW), 30_000);
  assert.equal(parseRetryAfterMs("soon", NOW), null);
  assert.equal(parseRetryAfterMs(null, NOW), null);
});

test("5xx, timeouts and network errors back off; an empty 200 and other 4xx are not retried", () => {
  assert.equal(retryDelayMs(fail(), 1, NOW), RETRY_BASE_MS);
  assert.equal(retryDelayMs(fail({ kind: "timeout", status: null }), 2, NOW), RETRY_BASE_MS * 2);
  assert.equal(retryDelayMs(fail({ kind: "network", status: null }), 1, NOW), RETRY_BASE_MS);
  assert.equal(retryDelayMs(null, 1, NOW), null);
  assert.equal(retryDelayMs(fail({ kind: "other", status: 400 }), 1, NOW), null);
});

test("a 429 honours Retry-After, waits a minute on a minutely limit, and gives up on hourly or daily limits", () => {
  assert.equal(retryDelayMs(fail({ kind: "429", status: 429, retryAfter: "20" }), 1, NOW), 20_000);
  assert.equal(retryDelayMs(fail({ kind: "429", status: 429, reason: "Minutely API request limit exceeded. Please try again in one minute." }), 1, NOW), MINUTELY_WAIT_MS);
  assert.equal(retryDelayMs(fail({ kind: "429", status: 429, reason: "Hourly API request limit exceeded. Please try again in the next hour." }), 1, NOW), null);
  assert.equal(retryDelayMs(fail({ kind: "429", status: 429, reason: "Daily API request limit exceeded. Please try again tomorrow." }), 1, NOW), null);
  assert.equal(retryDelayMs(fail({ kind: "429", status: 429, retryAfter: "3600" }), 1, NOW), null);
});

test("withOpenMeteoRetry: a point that fails twice with 502 and then answers is recovered, waiting as told", async () => {
  const waits: number[] = [];
  let calls = 0;
  const r = await withOpenMeteoRetry<string>(
    async (onFailure) => {
      calls++;
      if (calls < 3) {
        onFailure(fail());
        return null;
      }
      return "runs";
    },
    { sleep: async (ms) => void waits.push(ms), now: () => NOW },
  );
  assert.equal(r.value, "runs");
  assert.equal(r.attempts, 3);
  assert.equal(r.failures.length, 2);
  assert.deepEqual(waits, [RETRY_BASE_MS, RETRY_BASE_MS * 2]);
});

test("withOpenMeteoRetry: a daily limit stops after one try and keeps the failure for the log", async () => {
  let calls = 0;
  const r = await withOpenMeteoRetry<string>(
    async (onFailure) => {
      calls++;
      onFailure(fail({ kind: "429", status: 429, reason: "Daily API request limit exceeded." }));
      return null;
    },
    { sleep: async () => {}, now: () => NOW },
  );
  assert.equal(calls, 1);
  assert.equal(r.value, null);
  assert.equal(r.failures[0].kind, "429");
});

test("withOpenMeteoRetry: never more than maxAttempts tries", async () => {
  let calls = 0;
  const r = await withOpenMeteoRetry<string>(
    async (onFailure) => {
      calls++;
      onFailure(fail({ kind: "timeout", status: null }));
      return null;
    },
    { sleep: async () => {}, now: () => NOW, maxAttempts: 3 },
  );
  assert.equal(calls, 3);
  assert.equal(r.value, null);
});
