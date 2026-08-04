/**
 * lib/game/server/rate-limit.ts
 * ─────────────────────────────
 * A sliding-window rate limiter held in process memory.
 *
 * ⚠️ Per-instance, not global. On Vercel each serverless instance keeps its own
 * counters, instances scale out under load, and a cold start forgets
 * everything — so the effective ceiling is `limit × live instances`, and a
 * determined attacker can dodge it by forcing new instances. That is an
 * accepted trade for launch: this exists to blunt accidental floods and casual
 * scripted submission spam, while the *real* controls on the leaderboard are
 * the single-use ticket nonce (enforced by a unique constraint in Postgres)
 * and the replay validator.
 *
 * To make it durable, replace {@link createSlidingWindowLimiter} with a store
 * implementing the same {@link RateLimiter} interface — Upstash Redis or a
 * Supabase table keyed on `(bucket, window_start)` both fit. Nothing outside
 * this module knows the counters are in memory, so the swap is local.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** Requests still available in the current window (0 when blocked). */
  remaining: number;
  /** Epoch ms at which the oldest hit leaves the window. */
  resetAtMs: number;
  /** Whole seconds a blocked caller should wait; 0 when allowed. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  /** Record a hit for `key` and decide whether it may proceed. */
  check(key: string, nowMs?: number): RateLimitDecision;
  /** Drop all state. Tests use it; production never calls it. */
  reset(): void;
}

export interface SlidingWindowOptions {
  /** Hits permitted per window. */
  limit: number;
  windowMs: number;
  /**
   * Distinct keys retained before the coldest are evicted. Bounds memory
   * against a spray of forged `x-forwarded-for` values.
   */
  maxKeys?: number;
}

const DEFAULT_MAX_KEYS = 10_000;

/**
 * A true sliding window: each key keeps the timestamps of its recent hits and
 * anything older than `windowMs` is discarded on access. More accurate than
 * fixed buckets (no double-rate burst across a boundary) and cheap at these
 * limits — the per-key array never exceeds `limit` entries.
 */
export function createSlidingWindowLimiter(options: SlidingWindowOptions): RateLimiter {
  const { limit, windowMs } = options;
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;

  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`createSlidingWindowLimiter: limit must be a positive integer, got ${limit}`);
  }
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error(`createSlidingWindowLimiter: windowMs must be positive, got ${windowMs}`);
  }

  // Map iteration order is insertion order, so re-inserting a key on every hit
  // turns this into an LRU: the first entry is always the coldest.
  const hits = new Map<string, number[]>();

  function evictIfFull(): void {
    while (hits.size >= maxKeys) {
      const coldest = hits.keys().next();
      if (coldest.done) break;
      hits.delete(coldest.value);
    }
  }

  return {
    check(key, nowMs = Date.now()) {
      const cutoff = nowMs - windowMs;
      const previous = hits.get(key);
      const recent = previous ? previous.filter((t) => t > cutoff) : [];

      if (recent.length >= limit) {
        // Refresh recency without recording the blocked hit — otherwise a
        // client hammering the endpoint would keep pushing its own reset out.
        hits.delete(key);
        hits.set(key, recent);
        const resetAtMs = recent[0] + windowMs;
        return {
          allowed: false,
          remaining: 0,
          resetAtMs,
          retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000)),
        };
      }

      recent.push(nowMs);
      hits.delete(key);
      if (!previous) evictIfFull();
      hits.set(key, recent);

      return {
        allowed: true,
        remaining: limit - recent.length,
        resetAtMs: recent[0] + windowMs,
        retryAfterSeconds: 0,
      };
    },

    reset() {
      hits.clear();
    },
  };
}

/**
 * Client IP for rate-limit keying. Vercel sets `x-forwarded-for` with the
 * original client first; the header is spoofable, which is another reason this
 * limiter is a speed bump rather than a control.
 */
export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}
