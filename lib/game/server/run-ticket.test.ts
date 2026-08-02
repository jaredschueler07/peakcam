import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { test } from "node:test";

import {
  MAX_TICKET_TTL_MS,
  RunTicketError,
  TICKET_ALG,
  TICKET_TYPE,
  activeKeyOf,
  issueTicket,
  parseTicketKeyring,
  verifyTicket,
  type RunTicketClaims,
  type TicketKeyring,
} from "./run-ticket";

const SECRET_A = Buffer.alloc(32, 0xa1).toString("base64");
const SECRET_B = Buffer.alloc(48, 0xb2).toString("base64");

const CLAIMS: RunTicketClaims = {
  resortSlug: "ski-portillo",
  mode: "time_trial",
  trailId: "roca-jack",
  seed: 1337,
  surface: "ice",
  physicsModel: "v2",
  physicsVersion: 3,
  courseVersion: 20260801,
};

const NOW = 1_754_000_000_000; // fixed clock; tickets must not depend on wall time
const TTL = 5 * 60 * 1000;

function keyring(raw = `k1:${SECRET_A}`): TicketKeyring {
  return parseTicketKeyring(raw);
}

function mint(overrides: Partial<RunTicketClaims> = {}, ring = keyring()): string {
  return issueTicket(
    { ...CLAIMS, ...overrides },
    { ...activeKeyOf(ring), ttlMs: TTL, now: NOW, nonce: "6f1a2b3c-0000-4000-8000-000000000001" },
  );
}

function ticketError(fn: () => unknown): RunTicketError {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof RunTicketError, `expected RunTicketError, got ${String(err)}`);
    return err;
  }
  throw new assert.AssertionError({ message: "expected verifyTicket to throw" });
}

// ─── Keyring ─────────────────────────────────────────────────

test("parses a single-key DROP_IN_TICKET_KEYS value", () => {
  const ring = keyring();
  assert.equal(ring.active.kid, "k1");
  assert.equal(ring.byKid.size, 1);
  assert.deepEqual(ring.active.key, new Uint8Array(Buffer.from(SECRET_A, "base64")));
});

test("treats the first key as active and keeps the rest for verification", () => {
  const ring = keyring(` k2:${SECRET_B} , k1:${SECRET_A} `);
  assert.equal(ring.active.kid, "k2");
  assert.deepEqual([...ring.byKid.keys()], ["k2", "k1"]);
});

test("rejects malformed keyring configuration", () => {
  assert.throws(() => parseTicketKeyring(undefined), /is empty/);
  assert.throws(() => parseTicketKeyring("   "), /is empty/);
  assert.throws(() => parseTicketKeyring("nocolon"), /kid:base64secret/);
  assert.throws(() => parseTicketKeyring(`:${SECRET_A}`), /kid:base64secret/);
  assert.throws(() => parseTicketKeyring("k1:"), /kid:base64secret/);
  assert.throws(() => parseTicketKeyring(`bad kid:${SECRET_A}`), /kid must be/);
  assert.throws(() => parseTicketKeyring(`k1:${SECRET_A},k1:${SECRET_B}`), /duplicate kid/);
  assert.throws(
    () => parseTicketKeyring(`k1:${Buffer.alloc(16).toString("base64")}`),
    /at least 32 are required/,
  );
});

// ─── Issue and verify ────────────────────────────────────────

test("issues a compact three-segment token carrying the kid", () => {
  const token = mint();
  const parts = token.split(".");
  assert.equal(parts.length, 3);
  for (const part of parts) assert.match(part, /^[A-Za-z0-9_-]+$/);

  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  assert.deepEqual(header, { alg: TICKET_ALG, typ: TICKET_TYPE, kid: "k1" });
});

test("round-trips every claim plus nonce, iat and exp", () => {
  const payload = verifyTicket(mint(), keyring(), { now: NOW + 1000 });
  assert.deepEqual(payload, {
    ...CLAIMS,
    nonce: "6f1a2b3c-0000-4000-8000-000000000001",
    iat: NOW,
    exp: NOW + TTL,
  });
});

test("carries an authenticated user id when one is bound", () => {
  const userId = "8f14e45f-ceea-467a-9f26-9a3f2b0f9e11";
  const payload = verifyTicket(mint({ userId }), keyring(), { now: NOW });
  assert.equal(payload.userId, userId);
});

test("generates a distinct nonce per ticket by default", () => {
  const ring = keyring();
  const opts = { ...activeKeyOf(ring), ttlMs: TTL, now: NOW };
  const a = verifyTicket(issueTicket(CLAIMS, opts), ring, { now: NOW });
  const b = verifyTicket(issueTicket(CLAIMS, opts), ring, { now: NOW });
  assert.notEqual(a.nonce, b.nonce);
  assert.match(a.nonce, /^[0-9a-f-]{36}$/);
});

test("verifies a ticket signed by a rotated-out key", () => {
  const oldRing = keyring(`k1:${SECRET_A}`);
  const token = mint({}, oldRing);
  // New key prepended; the old one is still present for outstanding tickets.
  const rotated = keyring(`k2:${SECRET_B},k1:${SECRET_A}`);
  assert.equal(verifyTicket(token, rotated, { now: NOW }).seed, CLAIMS.seed);
});

// ─── Rejection ───────────────────────────────────────────────

test("rejects an expired ticket", () => {
  const err = ticketError(() => verifyTicket(mint(), keyring(), { now: NOW + TTL }));
  assert.equal(err.code, "expired");
  // Still valid one millisecond earlier.
  assert.ok(verifyTicket(mint(), keyring(), { now: NOW + TTL - 1 }));
});

test("rejects a ticket issued in the future", () => {
  const err = ticketError(() => verifyTicket(mint(), keyring(), { now: NOW - 120_000 }));
  assert.equal(err.code, "malformed");
});

test("rejects a tampered payload", () => {
  const [header, payload, sig] = mint().split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  claims.seed = 9999;
  const forged = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const err = ticketError(() => verifyTicket(`${header}.${forged}.${sig}`, keyring(), { now: NOW }));
  assert.equal(err.code, "bad-sig");
});

test("rejects a ticket signed with a different secret", () => {
  const token = mint({}, keyring(`k1:${SECRET_B}`));
  const err = ticketError(() => verifyTicket(token, keyring(`k1:${SECRET_A}`), { now: NOW }));
  assert.equal(err.code, "bad-sig");
});

test("rejects a signature of the wrong length without throwing from timingSafeEqual", () => {
  const [header, payload] = mint().split(".");
  const short = randomBytes(16).toString("base64url");
  const err = ticketError(() => verifyTicket(`${header}.${payload}.${short}`, keyring(), { now: NOW }));
  assert.equal(err.code, "bad-sig");
});

test("rejects an unknown kid", () => {
  const token = mint({}, keyring(`k9:${SECRET_A}`));
  const err = ticketError(() => verifyTicket(token, keyring(`k1:${SECRET_A}`), { now: NOW }));
  assert.equal(err.code, "unknown-kid");
});

test("rejects structurally malformed tokens", () => {
  const ring = keyring();
  const [header, payload, sig] = mint().split(".");

  for (const bad of ["", "onlyonesegment", `${header}.${payload}`, `${header}..${sig}`, `a.b.c.d`]) {
    assert.equal(ticketError(() => verifyTicket(bad, ring, { now: NOW })).code, "malformed");
  }
});

test("rejects a token whose header is not our alg/typ", () => {
  const [, payload, sig] = mint().split(".");
  const noneAlg = Buffer.from(
    JSON.stringify({ alg: "none", typ: TICKET_TYPE, kid: "k1" }),
    "utf8",
  ).toString("base64url");
  const err = ticketError(() => verifyTicket(`${noneAlg}.${payload}.${sig}`, keyring(), { now: NOW }));
  assert.equal(err.code, "malformed");
});

test("rejects a correctly signed token whose payload lacks required claims", () => {
  const ring = keyring();
  // Sign a truthful-but-incomplete payload the way the issuer would.
  const header = Buffer.from(
    JSON.stringify({ alg: TICKET_ALG, typ: TICKET_TYPE, kid: "k1" }),
    "utf8",
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ nonce: "n", iat: NOW }), "utf8").toString(
    "base64url",
  );
  const sig = createHmac("sha256", ring.active.key)
    .update(`${header}.${payload}`, "utf8")
    .digest("base64url");

  const err = ticketError(() => verifyTicket(`${header}.${payload}.${sig}`, ring, { now: NOW }));
  assert.equal(err.code, "malformed");
});

test("issueTicket refuses an unusable ttl or key", () => {
  const ring = keyring();
  const base = activeKeyOf(ring);
  assert.throws(() => issueTicket(CLAIMS, { ...base, ttlMs: 0 }), /ttlMs must be/);
  assert.throws(
    () => issueTicket(CLAIMS, { ...base, ttlMs: MAX_TICKET_TTL_MS + 1 }),
    /ttlMs must be/,
  );
  assert.throws(
    () => issueTicket(CLAIMS, { key: new Uint8Array(8), kid: "k1", ttlMs: TTL }),
    /at least 32 bytes/,
  );
});
