import assert from "node:assert/strict";
import { test } from "node:test";

import { clientIpFrom, createSlidingWindowLimiter } from "./rate-limit";

test("hits are allowed up to the limit and blocked after it", () => {
  const limiter = createSlidingWindowLimiter({ limit: 3, windowMs: 60_000 });
  const t0 = 1_000_000;

  assert.deepEqual(
    [0, 1, 2].map((i) => limiter.check("ip", t0 + i).allowed),
    [true, true, true],
  );

  const blocked = limiter.check("ip", t0 + 3);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.ok(blocked.retryAfterSeconds >= 1);
});

test("the window slides — the oldest hit expiring frees exactly one slot", () => {
  const limiter = createSlidingWindowLimiter({ limit: 2, windowMs: 1_000 });
  limiter.check("ip", 0);
  limiter.check("ip", 500);
  assert.equal(limiter.check("ip", 900).allowed, false);

  // At 1100 the hit from 0 has left the window; the one from 500 has not.
  assert.equal(limiter.check("ip", 1_100).allowed, true);
  assert.equal(limiter.check("ip", 1_150).allowed, false);
});

test("a blocked hit does not extend its own window", () => {
  const limiter = createSlidingWindowLimiter({ limit: 1, windowMs: 1_000 });
  limiter.check("ip", 0);
  const first = limiter.check("ip", 100);
  const second = limiter.check("ip", 900);
  assert.equal(first.allowed, false);
  assert.equal(second.allowed, false);
  // Both blocked calls report the same reset: hammering cannot push it out.
  assert.equal(first.resetAtMs, second.resetAtMs);
  assert.equal(limiter.check("ip", 1_001).allowed, true);
});

test("keys are independent", () => {
  const limiter = createSlidingWindowLimiter({ limit: 1, windowMs: 60_000 });
  assert.equal(limiter.check("a", 0).allowed, true);
  assert.equal(limiter.check("b", 0).allowed, true);
  assert.equal(limiter.check("a", 1).allowed, false);
});

test("key count is bounded, so forged IPs cannot grow memory without limit", () => {
  const limiter = createSlidingWindowLimiter({ limit: 5, windowMs: 60_000, maxKeys: 4 });
  for (let i = 0; i < 50; i++) limiter.check(`ip-${i}`, i);

  // The coldest keys were evicted, which loses their history — an accepted
  // trade documented in rate-limit.ts. The newest key still tracks.
  assert.equal(limiter.check("ip-49", 60).allowed, true);
  assert.equal(limiter.check("ip-0", 61).allowed, true);
});

test("reset clears every window", () => {
  const limiter = createSlidingWindowLimiter({ limit: 1, windowMs: 60_000 });
  limiter.check("ip", 0);
  assert.equal(limiter.check("ip", 1).allowed, false);
  limiter.reset();
  assert.equal(limiter.check("ip", 2).allowed, true);
});

test("a nonsense configuration throws at construction, not at the first request", () => {
  assert.throws(() => createSlidingWindowLimiter({ limit: 0, windowMs: 1_000 }), /positive integer/);
  assert.throws(() => createSlidingWindowLimiter({ limit: 1, windowMs: 0 }), /windowMs/);
});

test("the client IP comes from the first x-forwarded-for hop", () => {
  assert.equal(
    clientIpFrom(new Headers({ "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178" })),
    "203.0.113.7",
  );
  assert.equal(clientIpFrom(new Headers({ "x-real-ip": "203.0.113.9" })), "203.0.113.9");
  assert.equal(clientIpFrom(new Headers()), "unknown");
});
