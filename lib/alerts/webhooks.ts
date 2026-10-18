// ─────────────────────────────────────────────────────────────
// Standard Webhooks (https://www.standardwebhooks.com) for powder alerts.
//
// Secret: `whsec_` + base64 of 24 random bytes, generated once per
// destination and shown to the subscriber exactly once. Every delivery is
// signed with HMAC-SHA256 over `${id}.${timestamp}.${body}` and carries
//   webhook-id         msg_… (stable across the retries of one event)
//   webhook-timestamp  unix seconds
//   webhook-signature  v1,<base64 signature>
// Receivers verify with any Standard Webhooks library or verifyWebhook()
// below (which the e2e script and the manage route's test delivery use).
//
// Everything here is pure or injectable (fetch, sleep, clock) so the
// retry ladder and the signature round-trip are unit-tested without I/O.
// ─────────────────────────────────────────────────────────────

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const WEBHOOK_SECRET_PREFIX = "whsec_";
export const WEBHOOK_SIGNATURE_VERSION = "v1";
/** Receivers should reject deliveries whose timestamp is further out than this. */
export const WEBHOOK_TIMESTAMP_TOLERANCE_S = 5 * 60;

/** Attempts per event per destination, including the first. */
export const WEBHOOK_MAX_ATTEMPTS = 3;
/** Wait before attempt 2, 3, 4… Only the first MAX_ATTEMPTS-1 apply. */
export const WEBHOOK_RETRY_BACKOFF_MS: readonly number[] = [1_000, 5_000, 25_000];
/** Per-attempt HTTP timeout. */
export const WEBHOOK_ATTEMPT_TIMEOUT_MS = 5_000;
/** Consecutive failed runs after which a destination is switched off. */
export const WEBHOOK_DISABLE_AFTER_FAILURES = 10;
/** Webhooks a subscriber may register. */
export const MAX_WEBHOOKS_PER_SUBSCRIBER = 5;

export function generateWebhookSecret(): string {
  return WEBHOOK_SECRET_PREFIX + randomBytes(24).toString("base64");
}

export function generateWebhookId(): string {
  return `msg_${randomBytes(12).toString("hex")}`;
}

/** The raw HMAC key behind a `whsec_` secret. Throws on a malformed secret. */
export function webhookSecretBytes(secret: string): Buffer {
  if (!secret.startsWith(WEBHOOK_SECRET_PREFIX)) {
    throw new Error("webhook secret must start with whsec_");
  }
  const key = Buffer.from(secret.slice(WEBHOOK_SECRET_PREFIX.length), "base64");
  if (key.length === 0) throw new Error("webhook secret is empty");
  return key;
}

/** `v1,<base64>` for one delivery. `timestamp` is unix seconds. */
export function signWebhook(secret: string, id: string, timestamp: number, body: string): string {
  const mac = createHmac("sha256", webhookSecretBytes(secret))
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return `${WEBHOOK_SIGNATURE_VERSION},${mac}`;
}

export type WebhookHeaders = Record<"webhook-id" | "webhook-timestamp" | "webhook-signature" | "content-type" | "user-agent", string>;

export function webhookHeaders(secret: string, id: string, timestamp: number, body: string): WebhookHeaders {
  return {
    "webhook-id": id,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": signWebhook(secret, id, timestamp, body),
    "content-type": "application/json",
    "user-agent": "PeakCam-Webhooks/1.0 (+https://www.peakcam.io/alerts)",
  };
}

export type WebhookVerification =
  | { ok: true }
  | { ok: false; reason: "missing_headers" | "bad_timestamp" | "timestamp_out_of_tolerance" | "no_matching_signature" };

/**
 * Verifies a received delivery. `headers` is a case-insensitive lookup
 * (any object with lower-cased keys, or a Headers instance via `.get`).
 * Accepts a space-separated list of signatures and matches any `v1` entry,
 * per the Standard Webhooks spec, in constant time.
 */
export function verifyWebhook(
  secret: string,
  headers: { get(name: string): string | null | undefined } | Record<string, string | string[] | undefined>,
  body: string,
  options: { nowSeconds?: number; toleranceSeconds?: number } = {},
): WebhookVerification {
  const read = (name: string): string | undefined => {
    if (typeof (headers as { get?: unknown }).get === "function") {
      return (headers as { get(name: string): string | null | undefined }).get(name) ?? undefined;
    }
    const value = (headers as Record<string, string | string[] | undefined>)[name];
    return Array.isArray(value) ? value[0] : value;
  };
  const id = read("webhook-id");
  const timestampRaw = read("webhook-timestamp");
  const signatures = read("webhook-signature");
  if (!id || !timestampRaw || !signatures) return { ok: false, reason: "missing_headers" };

  const timestamp = Number(timestampRaw);
  if (!Number.isInteger(timestamp)) return { ok: false, reason: "bad_timestamp" };
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = options.toleranceSeconds ?? WEBHOOK_TIMESTAMP_TOLERANCE_S;
  if (Math.abs(now - timestamp) > tolerance) return { ok: false, reason: "timestamp_out_of_tolerance" };

  const expected = Buffer.from(signWebhook(secret, id, timestamp, body).slice(WEBHOOK_SIGNATURE_VERSION.length + 1), "base64");
  for (const candidate of signatures.split(" ")) {
    const [version, value] = candidate.split(",", 2);
    if (version !== WEBHOOK_SIGNATURE_VERSION || !value) continue;
    const given = Buffer.from(value, "base64");
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true };
  }
  return { ok: false, reason: "no_matching_signature" };
}

// ── Payloads ─────────────────────────────────────────────────

export interface PowderAlertEventInput {
  resort: { slug: string; name: string; url: string };
  /** New snow (measured) or storm total (forecast), inches. */
  inches: number;
  kind: "measured" | "forecast";
  /** ISO timestamp: the snow report's updated_at, or when the forecast was read. */
  measuredAt: string;
  url: string;
  /** The subscriber's threshold that this alert crossed. */
  threshold?: number;
  /** Forecast only: first snowy day (YYYY-MM-DD) and how many days the total spans. */
  stormStartDate?: string | null;
  forecastDays?: number;
  leadDays?: number;
}

export interface PowderAlertEvent extends PowderAlertEventInput {
  type: "powder.alert";
}

export interface PowderTestEvent {
  type: "powder.test";
  message: string;
  sentAt: string;
  url: string;
}

export function buildPowderAlertEvent(input: PowderAlertEventInput): PowderAlertEvent {
  return { type: "powder.alert", ...input };
}

export function buildPowderTestEvent(sentAt: string): PowderTestEvent {
  return {
    type: "powder.test",
    message: "PeakCam webhook test delivery. Real alerts arrive as type powder.alert.",
    sentAt,
    url: "https://www.peakcam.io/alerts",
  };
}

// ── URL validation ────────────────────────────────────────────

export type WebhookUrlCheck = { ok: true; url: string } | { ok: false; error: string };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function isPrivateIPv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * A webhook target the trigger will POST to from the server, so this is an
 * SSRF boundary: https only, no credentials, no private or link-local
 * address, at most 2 KB. `allowInsecure` admits plain http to loopback
 * hosts for the local e2e run (ALERT_WEBHOOK_ALLOW_LOOPBACK=1); production
 * never sets it. Hostnames that resolve to private ranges are not checked
 * here (no DNS in a pure function) — the runtime fetch is the second gate.
 */
export function validateWebhookUrl(raw: unknown, options: { allowInsecure?: boolean } = {}): WebhookUrlCheck {
  if (typeof raw !== "string" || raw.trim().length === 0) return { ok: false, error: "url is required" };
  const trimmed = raw.trim();
  if (trimmed.length > 2048) return { ok: false, error: "url is too long" };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: "url must be an absolute URL" };
  }
  if (url.username || url.password) return { ok: false, error: "url must not include credentials" };
  const host = url.hostname.toLowerCase();
  const loopback = LOOPBACK_HOSTS.has(host);
  if (url.protocol === "http:") {
    if (!(options.allowInsecure && loopback)) return { ok: false, error: "url must use https" };
  } else if (url.protocol !== "https:") {
    return { ok: false, error: "url must use https" };
  }
  if (!options.allowInsecure && (loopback || isPrivateIPv4(host) || host.endsWith(".local") || host.endsWith(".internal"))) {
    return { ok: false, error: "url must be a public host" };
  }
  url.hash = "";
  return { ok: true, url: url.toString() };
}

// ── Delivery with retries ─────────────────────────────────────

export interface WebhookDeliveryOptions {
  url: string;
  secret: string;
  /** Serialized JSON body — signed byte-for-byte, so the caller serializes once. */
  body: string;
  /** Stable per event; the same id is sent on every retry. */
  id?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxAttempts?: number;
  backoffMs?: readonly number[];
  attemptTimeoutMs?: number;
  /** Epoch ms. A retry whose wait plus timeout would pass this is skipped. */
  deadline?: number;
}

export interface WebhookDeliveryResult {
  ok: boolean;
  id: string;
  attempts: number;
  /** Last HTTP status, or null when the last attempt never got a response. */
  status: number | null;
  /** Last failure, e.g. "http_500", "TimeoutError", "deadline". */
  error?: string;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * POSTs one signed event, retrying on any non-2xx, network error or
 * timeout. Each attempt is re-signed with a fresh timestamp but the same
 * id, so a receiver that stores ids dedupes retries. Never throws.
 */
export async function deliverWebhook(options: WebhookDeliveryOptions): Promise<WebhookDeliveryResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const maxAttempts = options.maxAttempts ?? WEBHOOK_MAX_ATTEMPTS;
  const backoff = options.backoffMs ?? WEBHOOK_RETRY_BACKOFF_MS;
  const attemptTimeout = options.attemptTimeoutMs ?? WEBHOOK_ATTEMPT_TIMEOUT_MS;
  const id = options.id ?? generateWebhookId();

  let status: number | null = null;
  let error: string | undefined;
  let attempts = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const wait = backoff[Math.min(attempt - 1, backoff.length - 1)] ?? 0;
      if (options.deadline !== undefined && now() + wait + attemptTimeout > options.deadline) {
        error = "deadline";
        break;
      }
      await sleep(wait);
    }
    attempts++;
    const timestamp = Math.floor(now() / 1000);
    try {
      const response = await fetchImpl(options.url, {
        method: "POST",
        headers: webhookHeaders(options.secret, id, timestamp, options.body),
        body: options.body,
        redirect: "manual",
        signal: AbortSignal.timeout(attemptTimeout),
      });
      status = response.status;
      if (response.status >= 200 && response.status < 300) {
        return { ok: true, id, attempts, status };
      }
      error = `http_${response.status}`;
    } catch (err) {
      status = null;
      error = err instanceof Error && err.name !== "Error" ? err.name : "fetch_failed";
    }
  }
  return { ok: false, id, attempts, status, error };
}
