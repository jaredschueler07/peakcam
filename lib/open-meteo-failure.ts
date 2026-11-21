/**
 * What went wrong with one Open-Meteo request, for the sync logs.
 *
 * Pure: no network, no clock of its own. `scripts/forecast-sync.ts` and
 * `scripts/model-sync.ts` pass an `onFailure` callback into the two fetchers
 * (`lib/forecast/open-meteo-models.ts fetchModelRuns`, `lib/open-meteo.ts
 * getOpenMeteoSnapshot`) and print one line per failure plus a per-class tally
 * in the run's last line. Added 2026-11-21 after a forecast run lost 254 of
 * 513 points in one block and the log could not say whether those were 429s,
 * 5xx or timeouts. Logging only: nothing here retries or changes a request.
 */

export const OPEN_METEO_FAILURE_CLASSES = ["429", "5xx", "timeout", "network", "other"] as const;
export type OpenMeteoFailureClass = (typeof OPEN_METEO_FAILURE_CLASSES)[number];

export interface OpenMeteoFailure {
  /** ISO time the failure was seen. */
  at: string;
  kind: OpenMeteoFailureClass;
  /** HTTP status, or null when no response arrived. */
  status: number | null;
  retryAfter: string | null;
  /** Only `x-ratelimit-*` headers; never the whole header set. */
  rateLimit: Record<string, string>;
  /** Open-Meteo's `{error: true, reason}` text, or the start of the body, at most REASON_MAX chars. */
  reason: string | null;
  /** Error name and message when the request threw. */
  error: string | null;
}

export type OpenMeteoFailureHandler = (failure: OpenMeteoFailure) => void;

export const REASON_MAX = 200;

const clip = (text: string, max = REASON_MAX): string => {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
};

export function classifyStatus(status: number): OpenMeteoFailureClass {
  if (status === 429) return "429";
  if (status >= 500 && status <= 599) return "5xx";
  return "other";
}

/** `reason` from Open-Meteo's JSON error body; the clipped raw body when it is not that shape. */
export function extractReason(body: string | null | undefined): string | null {
  if (!body || !body.trim()) return null;
  try {
    const parsed = JSON.parse(body) as { reason?: unknown };
    if (parsed && typeof parsed.reason === "string" && parsed.reason.trim()) return clip(parsed.reason);
  } catch {
    // not JSON: fall through to the raw text
  }
  return clip(body);
}

interface HeaderReader {
  get(name: string): string | null;
  forEach?(callback: (value: string, key: string) => void): void;
}

function rateLimitHeaders(headers: HeaderReader): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach?.((value, key) => {
    const name = key.toLowerCase();
    if (name.startsWith("x-ratelimit-") || name.startsWith("ratelimit-")) out[name] = clip(value, 80);
  });
  return out;
}

/** A response that arrived with a non-2xx status. */
export function describeHttpFailure(res: { status: number; headers: HeaderReader }, body: string | null, now: Date): OpenMeteoFailure {
  const retryAfter = res.headers.get("retry-after");
  return {
    at: now.toISOString(),
    kind: classifyStatus(res.status),
    status: res.status,
    retryAfter: retryAfter ? clip(retryAfter, 40) : null,
    rateLimit: rateLimitHeaders(res.headers),
    reason: extractReason(body),
    error: null,
  };
}

/** A request that threw: AbortSignal.timeout gives TimeoutError (or AbortError); the rest is network. */
export function describeThrownFailure(err: unknown, now: Date): OpenMeteoFailure {
  const name = err instanceof Error ? err.name : "Error";
  const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.name}: ${err.cause.message})` : "";
  const message = err instanceof Error ? err.message : String(err);
  const kind: OpenMeteoFailureClass = name === "TimeoutError" || name === "AbortError" ? "timeout" : name === "SyntaxError" ? "other" : "network";
  return { at: now.toISOString(), kind, status: null, retryAfter: null, rateLimit: {}, reason: null, error: clip(`${name}: ${message}${cause}`) };
}

/** One log line. `label` names the resort and point, e.g. `Alta summit`. */
export function formatFailureLine(failure: OpenMeteoFailure, label: string): string {
  const parts = [`${failure.at} Open-Meteo FAIL ${label}`, `class=${failure.kind}`, `status=${failure.status ?? "none"}`];
  if (failure.kind === "429") parts.push(`limit=${rateLimitWindow(failure.reason)}`);
  if (failure.retryAfter) parts.push(`retry-after=${failure.retryAfter}`);
  for (const [name, value] of Object.entries(failure.rateLimit).sort(([a], [b]) => a.localeCompare(b))) parts.push(`${name}=${value}`);
  if (failure.reason) parts.push(`reason="${failure.reason}"`);
  if (failure.error) parts.push(`error="${failure.error}"`);
  return parts.join(" ");
}

/** Which of Open-Meteo's limits a refusal names: its reasons read "Minutely / Hourly / Daily API request limit exceeded". */
export const RATE_LIMIT_WINDOWS = ["minutely", "hourly", "daily", "unstated"] as const;
export type RateLimitWindow = (typeof RATE_LIMIT_WINDOWS)[number];

export function rateLimitWindow(reason: string | null | undefined): RateLimitWindow {
  const text = (reason ?? "").toLowerCase();
  if (/\bminutely\b|per minute|one minute/.test(text)) return "minutely";
  if (/\bhourly\b|per hour|next hour/.test(text)) return "hourly";
  if (/\bdaily\b|per day|tomorrow/.test(text)) return "daily";
  return "unstated";
}

export interface OpenMeteoFailureTally extends Record<OpenMeteoFailureClass, number> {
  /** The 429s again, split by the limit their reason text names. */
  limitWindows: Record<RateLimitWindow, number>;
}

export function emptyTally(): OpenMeteoFailureTally {
  return { "429": 0, "5xx": 0, timeout: 0, network: 0, other: 0, limitWindows: { minutely: 0, hourly: 0, daily: 0, unstated: 0 } };
}

/** Count one failed request; `null` is a 200 whose body held nothing usable ("other"). */
export function countFailure(tally: OpenMeteoFailureTally, failure: OpenMeteoFailure | null): void {
  const kind = failure?.kind ?? "other";
  tally[kind]++;
  if (kind === "429") tally.limitWindows[rateLimitWindow(failure?.reason)]++;
}

/**
 * `429 12 (minutely 10, hourly 0, daily 2, unstated 0), 5xx 0, timeout 3, network 0, other 0`
 * — every class, so a zero is visible; the window split only when there were 429s.
 */
export function formatTally(tally: OpenMeteoFailureTally): string {
  return OPEN_METEO_FAILURE_CLASSES.map((kind) => {
    const base = `${kind} ${tally[kind]}`;
    if (kind !== "429" || tally["429"] === 0) return base;
    return `${base} (${RATE_LIMIT_WINDOWS.map((w) => `${w} ${tally.limitWindows[w]}`).join(", ")})`;
  }).join(", ");
}

/** `started 2026-11-21T07:05:05.000Z, ended 2026-11-21T07:21:40.000Z, took 16m 35s`. */
export function formatRunWindow(startedAt: Date, endedAt: Date): string {
  const seconds = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
  const took = seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
  return `started ${startedAt.toISOString()}, ended ${endedAt.toISOString()}, took ${took}`;
}

/** Read at most `max` characters of a failed response's body; never throws. */
export async function readFailureBody(res: { text(): Promise<string> }, max = 2000): Promise<string | null> {
  try {
    return (await res.text()).slice(0, max);
  } catch {
    return null;
  }
}
