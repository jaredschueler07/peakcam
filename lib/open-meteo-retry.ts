/**
 * Retry for one Open-Meteo request, used by scripts/forecast-sync.ts.
 *
 * Why: the forecast run made one request per point and gave up on any
 * failure. On 2026-11-24 about 80 resorts had no 07Z forecast because the
 * failed points (a block at the start of the 01:05 Central run, the run that
 * starts 20 minutes after model-sync) were never asked again. A short wait
 * that honours Retry-After, and a second pass at the end of the run, recovers
 * a minutely limit or a passing 5xx or timeout. A daily limit is not retried:
 * waiting minutes cannot clear it.
 *
 * Pure apart from the injected sleep, so the tests run without a network.
 */
import { rateLimitWindow, type OpenMeteoFailure, type OpenMeteoFailureHandler } from "./open-meteo-failure";

/** Tries per request, the first included. */
export const MAX_ATTEMPTS = 3;
/** First backoff for 5xx, timeout and network failures; doubled per retry. */
export const RETRY_BASE_MS = 2_000;
/** Longest single wait; a Retry-After beyond this is not waited for in-run. */
export const RETRY_MAX_MS = 65_000;
/** A minutely limit with no Retry-After waits for the next minute. */
export const MINUTELY_WAIT_MS = 60_000;

/** Retry-After as milliseconds: delta-seconds or an HTTP date; null when absent or unreadable. */
export function parseRetryAfterMs(value: string | null | undefined, now: Date): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now.getTime());
}

/**
 * How long to wait before retry number `retry` (1 for the first retry), or
 * null when this failure should not be retried.
 */
export function retryDelayMs(failure: OpenMeteoFailure | null, retry: number, now: Date): number | null {
  // A 200 with no usable run (null failure) or a 4xx other than 429 will not change on a retry.
  if (!failure || failure.kind === "other") return null;
  const backoff = Math.min(RETRY_BASE_MS * 2 ** (retry - 1), RETRY_MAX_MS);
  if (failure.kind !== "429") return backoff;
  const window = rateLimitWindow(failure.reason);
  if (window === "daily") return null;
  const asked = parseRetryAfterMs(failure.retryAfter, now);
  if (asked != null) return asked <= RETRY_MAX_MS ? Math.max(asked, backoff) : null;
  if (window === "hourly") return null;
  return MINUTELY_WAIT_MS;
}

export interface RetryResult<T> {
  value: T | null;
  /** Every failure seen, oldest first; the last one is why a null value failed. */
  failures: OpenMeteoFailure[];
  attempts: number;
}

export interface RetryOptions {
  maxAttempts?: number;
  sleep: (ms: number) => Promise<void>;
  now?: () => Date;
  /** Called before each wait, for the log. */
  onRetry?: (failure: OpenMeteoFailure, retry: number, waitMs: number) => void;
}

/**
 * Run `call` (a fetcher taking an onFailure handler and returning null on
 * failure) until it returns a value, the failure is not retryable, or
 * maxAttempts is reached.
 */
export async function withOpenMeteoRetry<T>(call: (onFailure: OpenMeteoFailureHandler) => Promise<T | null>, options: RetryOptions): Promise<RetryResult<T>> {
  const max = options.maxAttempts ?? MAX_ATTEMPTS;
  const now = options.now ?? (() => new Date());
  const failures: OpenMeteoFailure[] = [];
  for (let attempt = 1; ; attempt++) {
    let seen: OpenMeteoFailure | null = null;
    const value = await call((f) => {
      seen = f;
    });
    if (value != null) return { value, failures, attempts: attempt };
    const failure = seen as OpenMeteoFailure | null;
    if (failure) failures.push(failure);
    if (attempt >= max) return { value: null, failures, attempts: attempt };
    const wait = retryDelayMs(failure, attempt, now());
    if (wait == null) return { value: null, failures, attempts: attempt };
    if (failure) options.onRetry?.(failure, attempt, wait);
    await options.sleep(wait);
  }
}
