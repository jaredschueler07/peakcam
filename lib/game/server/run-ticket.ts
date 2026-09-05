/**
 * lib/game/server/run-ticket.ts
 * ─────────────────────────────
 * Server-issued HMAC-SHA256 run tickets for Drop In v2 (architecture report §9
 * "Anti-cheat", DESIGN.md §3.7).
 *
 * ⚠️ SERVER ONLY. This module imports `node:crypto` and handles the signing
 * secret. It must never be imported from a Client Component, from anything
 * under `components/`, or from `lib/game/{core,physics,terrain,replay}`. The
 * repo does not use the `server-only` package, so this comment plus import
 * discipline is the boundary — check callers when you touch it.
 *
 * A ticket proves the *server* issued a particular challenge (course, seed,
 * versions, expiry, and the signed-in user it was issued to). It proves nothing
 * about how the client played; authoritative re-simulation of the input trace
 * is the real anti-cheat control. Client-signed payloads are security theater —
 * the player owns the JavaScript.
 *
 * ## Token format
 *
 * `base64url(headerJson).base64url(payloadJson).base64url(hmac)`
 *
 * JWT-shaped but deliberately not a JWT: no library, no `alg: none` foot-gun
 * (the header's `alg` is validated, never dispatched on), and the claim set is
 * ours. The header carries `kid` so keys can rotate — see
 * {@link parseTicketKeyring} and the `DROP_IN_TICKET_KEYS` env var.
 */

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { PhysicsModel, SurfaceKind, SimulationEnvironment } from "../core/config";

// ─── Types ───────────────────────────────────────────────────

export const TICKET_ALG = "HS256";
export const TICKET_TYPE = "pcdi-run";

/** Longest TTL a caller may request. Tickets are for one run, not a session. */
export const MAX_TICKET_TTL_MS = 30 * 60 * 1000;

/** What the caller asks the server to bind into a ticket. */
export interface RunTicketClaims {
  environment?: SimulationEnvironment;
  conditionsDate?: string;
  resortSlug: string;
  mode: "time_trial" | "score_attack";
  trailId: string;
  seed: number;
  surface: SurfaceKind;
  physicsModel: PhysicsModel;
  physicsVersion: number;
  courseVersion: number;
  /** Supabase `auth.users.id` when the run was started signed-in. */
  userId?: string;
}

/** The verified payload, including the fields the issuer adds. */
export interface RunTicketPayload extends RunTicketClaims {
  /** One-time-use identifier; `drop_in_runs.run_nonce` enforces uniqueness. */
  nonce: string;
  /** Issued-at, epoch milliseconds. */
  iat: number;
  /** Expiry, epoch milliseconds. */
  exp: number;
}

export interface TicketKey {
  kid: string;
  /** Raw HMAC secret bytes. */
  key: Uint8Array;
}

export interface TicketKeyring {
  /** The key new tickets are signed with. */
  active: TicketKey;
  /** Every key that may still verify, including rotated-out ones, by `kid`. */
  byKid: ReadonlyMap<string, TicketKey>;
}

export interface IssueTicketOptions {
  /** Raw HMAC secret bytes (see {@link activeKeyOf}). */
  key: Uint8Array;
  kid: string;
  ttlMs: number;
  /** Injectable clock for tests; defaults to `Date.now()`. */
  now?: number;
  /** Injectable nonce for tests; defaults to `crypto.randomUUID()`. */
  nonce?: string;
}

export type RunTicketErrorCode = "malformed" | "unknown-kid" | "bad-sig" | "expired";

/**
 * Thrown by {@link verifyTicket}. `code` is a stable enum safe to log and to
 * store as a `rejection_code`; `message` is for server logs only — never
 * echo it to the client, it distinguishes failure modes an attacker can probe.
 */
export class RunTicketError extends Error {
  readonly code: RunTicketErrorCode;

  constructor(code: RunTicketErrorCode, message: string) {
    super(message);
    this.name = "RunTicketError";
    this.code = code;
  }
}

// ─── base64url ───────────────────────────────────────────────

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeJson(segment: string): unknown {
  // base64url is decoded strictly: Buffer is lenient, so re-encoding must be a
  // fixed point or the segment was padded/mutated.
  const bytes = Buffer.from(segment, "base64url");
  if (bytes.toString("base64url") !== segment) {
    throw new RunTicketError("malformed", "ticket segment is not canonical base64url");
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new RunTicketError("malformed", "ticket segment is not valid JSON");
  }
}

// ─── Key handling ────────────────────────────────────────────

/**
 * Parse `DROP_IN_TICKET_KEYS` — `kid1:base64secret,kid2:base64secret,…`.
 * The **first** entry is the active signing key; the rest verify only, which is
 * how a rotation works: prepend the new key, keep the old one until every
 * outstanding ticket has expired, then drop it.
 *
 * Throws a plain `Error` (misconfiguration, not untrusted input).
 */
export function parseTicketKeyring(raw: string | undefined): TicketKeyring {
  if (!raw || raw.trim() === "") {
    throw new Error("DROP_IN_TICKET_KEYS is empty; run tickets cannot be issued or verified");
  }

  const byKid = new Map<string, TicketKey>();
  let active: TicketKey | undefined;

  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;

    const sep = trimmed.indexOf(":");
    if (sep <= 0 || sep === trimmed.length - 1) {
      throw new Error(`DROP_IN_TICKET_KEYS entry is not "kid:base64secret": ${trimmed}`);
    }

    const kid = trimmed.slice(0, sep);
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(kid)) {
      throw new Error(`DROP_IN_TICKET_KEYS kid must be 1-32 chars of [A-Za-z0-9_-]: ${kid}`);
    }
    if (byKid.has(kid)) {
      throw new Error(`DROP_IN_TICKET_KEYS contains duplicate kid: ${kid}`);
    }

    const key = new Uint8Array(Buffer.from(trimmed.slice(sep + 1), "base64"));
    if (key.byteLength < 32) {
      throw new Error(
        `DROP_IN_TICKET_KEYS secret for kid "${kid}" decodes to ${key.byteLength} bytes; ` +
          "at least 32 are required (openssl rand -base64 32)",
      );
    }

    const entryKey: TicketKey = { kid, key };
    byKid.set(kid, entryKey);
    active ??= entryKey;
  }

  if (!active) {
    throw new Error("DROP_IN_TICKET_KEYS contained no usable entries");
  }
  return { active, byKid };
}

/** The signing key of a keyring, shaped for {@link issueTicket}. */
export function activeKeyOf(keyring: TicketKeyring): { key: Uint8Array; kid: string } {
  return { key: keyring.active.key, kid: keyring.active.kid };
}

// ─── Issue ───────────────────────────────────────────────────

function sign(key: Uint8Array, signingInput: string): Uint8Array {
  return new Uint8Array(createHmac("sha256", key).update(signingInput, "utf8").digest());
}

/** Mint a signed, short-lived ticket for one competitive run. */
export function issueTicket(claims: RunTicketClaims, options: IssueTicketOptions): string {
  const { key, kid, ttlMs } = options;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TICKET_TTL_MS) {
    throw new Error(`issueTicket: ttlMs must be in 1..${MAX_TICKET_TTL_MS}, got ${ttlMs}`);
  }
  if (key.byteLength < 32) {
    throw new Error(`issueTicket: signing key must be at least 32 bytes, got ${key.byteLength}`);
  }

  const now = options.now ?? Date.now();
  const payload: RunTicketPayload = {
    ...claims,
    nonce: options.nonce ?? randomUUID(),
    iat: now,
    exp: now + ttlMs,
  };

  const header = encodeJson({ alg: TICKET_ALG, typ: TICKET_TYPE, kid });
  const body = encodeJson(payload);
  const signingInput = `${header}.${body}`;
  return `${signingInput}.${toBase64Url(sign(key, signingInput))}`;
}

// ─── Verify ──────────────────────────────────────────────────

function isTicketHeader(value: unknown): value is { alg: string; typ: string; kid: string } {
  if (typeof value !== "object" || value === null) return false;
  const h = value as Record<string, unknown>;
  return typeof h.alg === "string" && typeof h.typ === "string" && typeof h.kid === "string";
}

function isTicketPayload(value: unknown): value is RunTicketPayload {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.nonce === "string" &&
    p.nonce.length > 0 &&
    typeof p.resortSlug === "string" &&
    (p.mode === "time_trial" || p.mode === "score_attack") &&
    typeof p.trailId === "string" &&
    Number.isFinite(p.seed) &&
    (p.surface === "powder" || p.surface === "packed" || p.surface === "firm" || p.surface === "ice") &&
    (p.physicsModel === "v1" || p.physicsModel === "v2") &&
    Number.isFinite(p.physicsVersion) &&
    Number.isFinite(p.courseVersion) &&
    Number.isFinite(p.iat) &&
    Number.isFinite(p.exp) &&
    (p.userId === undefined || typeof p.userId === "string")
  );
}

/**
 * Verify a ticket against a keyring and return its payload.
 *
 * Order matters: the signature is checked before the expiry, so an attacker
 * cannot learn anything about the claim set from an unsigned token. Comparison
 * is constant-time.
 *
 * @throws {RunTicketError} `malformed` | `unknown-kid` | `bad-sig` | `expired`
 */
export function verifyTicket(
  token: string,
  keyring: TicketKeyring,
  options: { now?: number } = {},
): RunTicketPayload {
  if (typeof token !== "string" || token.length === 0 || token.length > 4096) {
    throw new RunTicketError("malformed", "ticket is empty or implausibly long");
  }

  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
    throw new RunTicketError("malformed", `ticket has ${parts.length} segments, expected 3`);
  }
  const [headerSegment, payloadSegment, signatureSegment] = parts;

  const header = decodeJson(headerSegment);
  if (!isTicketHeader(header)) {
    throw new RunTicketError("malformed", "ticket header is missing alg/typ/kid");
  }
  // `alg` is validated, never used to choose an algorithm — no "alg: none".
  if (header.alg !== TICKET_ALG || header.typ !== TICKET_TYPE) {
    throw new RunTicketError("malformed", `unexpected header alg/typ: ${header.alg}/${header.typ}`);
  }

  const entry = keyring.byKid.get(header.kid);
  if (!entry) {
    throw new RunTicketError("unknown-kid", `no key in the keyring for kid "${header.kid}"`);
  }

  const expected = sign(entry.key, `${headerSegment}.${payloadSegment}`);
  const provided = Buffer.from(signatureSegment, "base64url");
  // timingSafeEqual throws on a length mismatch; a wrong length is a bad
  // signature and leaks nothing, so short-circuit it explicitly.
  if (provided.byteLength !== expected.byteLength || !timingSafeEqual(provided, expected)) {
    throw new RunTicketError("bad-sig", "ticket signature does not verify");
  }

  const payload = decodeJson(payloadSegment);
  if (!isTicketPayload(payload)) {
    throw new RunTicketError("malformed", "ticket payload is missing required claims");
  }

  const now = options.now ?? Date.now();
  if (payload.exp <= now) {
    throw new RunTicketError("expired", `ticket expired at ${payload.exp}, now ${now}`);
  }
  if (payload.iat > now + 60_000) {
    throw new RunTicketError("malformed", `ticket is issued ${payload.iat - now}ms in the future`);
  }

  return payload;
}
