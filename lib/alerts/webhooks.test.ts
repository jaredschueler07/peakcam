import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPowderAlertEvent,
  deliverWebhook,
  generateWebhookSecret,
  signWebhook,
  validateWebhookUrl,
  verifyWebhook,
  webhookHeaders,
  webhookSecretBytes,
  WEBHOOK_MAX_ATTEMPTS,
} from "./webhooks";

test("secret is whsec_ + base64 of 24 random bytes, unique per call", () => {
  const a = generateWebhookSecret();
  const b = generateWebhookSecret();
  assert.match(a, /^whsec_[A-Za-z0-9+/]{32}$/);
  assert.notEqual(a, b);
  assert.equal(webhookSecretBytes(a).length, 24);
  assert.throws(() => webhookSecretBytes("nope"), /whsec_/);
});

test("signature matches the Standard Webhooks reference vector", () => {
  // From the spec's examples: secret, id, timestamp, body → v1 signature.
  const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
  const signature = signWebhook(secret, "msg_p5jXN8AQM9LWM0D4loKWxJek", 1614265330, '{"test": 2432232314}');
  assert.equal(signature, "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=");
});

test("sign → verify round-trips, and rejects tampering, bad secrets and stale timestamps", () => {
  const secret = generateWebhookSecret();
  const body = JSON.stringify(buildPowderAlertEvent({
    resort: { slug: "alta", name: "Alta", url: "https://www.peakcam.io/resorts/alta" },
    inches: 11,
    kind: "measured",
    measuredAt: "2026-12-01T13:00:00.000Z",
    url: "https://www.peakcam.io/resorts/alta",
  }));
  const now = 1_765_000_000;
  const headers = webhookHeaders(secret, "msg_abc", now, body);
  assert.equal(headers["webhook-timestamp"], String(now));
  assert.match(headers["webhook-signature"], /^v1,[A-Za-z0-9+/=]+$/);

  assert.deepEqual(verifyWebhook(secret, headers, body, { nowSeconds: now + 10 }), { ok: true });
  // A Headers instance works too (what a receiver's framework hands over).
  assert.deepEqual(verifyWebhook(secret, new Headers(headers), body, { nowSeconds: now }), { ok: true });
  // Several space-separated signatures: any matching v1 entry passes.
  assert.deepEqual(
    verifyWebhook(secret, { ...headers, "webhook-signature": `v1,AAAA ${headers["webhook-signature"]}` }, body, { nowSeconds: now }),
    { ok: true },
  );

  assert.equal(verifyWebhook(secret, headers, body + " ", { nowSeconds: now }).ok, false);
  assert.equal(verifyWebhook(generateWebhookSecret(), headers, body, { nowSeconds: now }).ok, false);
  assert.deepEqual(verifyWebhook(secret, headers, body, { nowSeconds: now + 600 }), { ok: false, reason: "timestamp_out_of_tolerance" });
  assert.deepEqual(verifyWebhook(secret, { "webhook-id": "msg_abc" }, body, { nowSeconds: now }), { ok: false, reason: "missing_headers" });
  assert.deepEqual(verifyWebhook(secret, { ...headers, "webhook-timestamp": "soon" }, body, { nowSeconds: now }), { ok: false, reason: "bad_timestamp" });
  assert.deepEqual(verifyWebhook(secret, { ...headers, "webhook-signature": "v2,zzz" }, body, { nowSeconds: now }), { ok: false, reason: "no_matching_signature" });
});

test("payload carries the documented fields", () => {
  const event = buildPowderAlertEvent({
    resort: { slug: "alta", name: "Alta", url: "https://www.peakcam.io/resorts/alta" },
    inches: 14.5,
    kind: "forecast",
    measuredAt: "2026-12-01T13:00:00.000Z",
    url: "https://www.peakcam.io/resorts/alta",
    threshold: 8,
    stormStartDate: "2026-12-03",
    forecastDays: 3,
    leadDays: 2,
  });
  assert.equal(event.type, "powder.alert");
  assert.deepEqual(Object.keys(event).slice(0, 6), ["type", "resort", "inches", "kind", "measuredAt", "url"]);
  assert.equal(event.stormStartDate, "2026-12-03");
});

test("validateWebhookUrl: https public hosts only, loopback http only when allowed", () => {
  assert.deepEqual(validateWebhookUrl("https://hooks.example.com/peakcam#frag"), { ok: true, url: "https://hooks.example.com/peakcam" });
  assert.equal(validateWebhookUrl("http://hooks.example.com/x").ok, false);
  assert.equal(validateWebhookUrl("https://user:pw@hooks.example.com/x").ok, false);
  assert.equal(validateWebhookUrl("https://192.168.1.10/x").ok, false);
  assert.equal(validateWebhookUrl("https://10.0.0.5/x").ok, false);
  assert.equal(validateWebhookUrl("https://169.254.169.254/latest").ok, false);
  assert.equal(validateWebhookUrl("https://localhost/x").ok, false);
  assert.equal(validateWebhookUrl("https://mini.local/x").ok, false);
  assert.equal(validateWebhookUrl("ftp://hooks.example.com/x").ok, false);
  assert.equal(validateWebhookUrl("not a url").ok, false);
  assert.equal(validateWebhookUrl("").ok, false);
  assert.equal(validateWebhookUrl(42).ok, false);
  assert.equal(validateWebhookUrl("https://x.example/" + "a".repeat(2100)).ok, false);
  // Local e2e: ALERT_WEBHOOK_ALLOW_LOOPBACK=1 admits plain http to loopback only.
  assert.deepEqual(validateWebhookUrl("http://127.0.0.1:4321/hook", { allowInsecure: true }), { ok: true, url: "http://127.0.0.1:4321/hook" });
  assert.equal(validateWebhookUrl("http://hooks.example.com/x", { allowInsecure: true }).ok, false);
});

test("deliverWebhook: 2xx on the first try is one attempt, re-signed retries share the id, non-2xx exhausts", async () => {
  const secret = generateWebhookSecret();
  const body = '{"type":"powder.test"}';
  const seen: Array<{ id: string; ts: string; ok: boolean }> = [];
  const waits: number[] = [];
  let clock = 1_700_000_000_000;
  const fetchImpl: typeof fetch = async (_url, init) => {
    const headers = init!.headers as Record<string, string>;
    const ok = verifyWebhook(secret, headers, String(init!.body), { nowSeconds: Math.floor(clock / 1000) }).ok;
    seen.push({ id: headers["webhook-id"], ts: headers["webhook-timestamp"], ok });
    assert.equal(init!.redirect, "manual");
    return new Response("", { status: seen.length < 3 ? 503 : 200 });
  };
  const sleep = async (ms: number) => { waits.push(ms); clock += ms; };

  const result = await deliverWebhook({ url: "https://hooks.example.com/x", secret, body, fetchImpl, sleep, now: () => clock, id: "msg_fixed" });
  assert.deepEqual(result, { ok: true, id: "msg_fixed", attempts: 3, status: 200 });
  assert.deepEqual(waits, [1000, 5000]);
  assert.equal(seen.length, WEBHOOK_MAX_ATTEMPTS);
  assert.ok(seen.every((s) => s.id === "msg_fixed" && s.ok), "every retry is a valid signature over the same id");
  assert.notEqual(seen[0].ts, seen[2].ts, "retries are re-signed with a fresh timestamp");

  // All failures → not ok, last status reported.
  const failing = await deliverWebhook({
    url: "https://hooks.example.com/x", secret, body, id: "msg_2",
    fetchImpl: async () => new Response("", { status: 500 }), sleep: async () => {}, now: () => clock,
  });
  assert.deepEqual(failing, { ok: false, id: "msg_2", attempts: 3, status: 500, error: "http_500" });

  // Network errors carry the error name; 3xx is a failure (redirects are not followed).
  const thrown = await deliverWebhook({
    url: "https://hooks.example.com/x", secret, body, id: "msg_3",
    fetchImpl: async () => { const e = new Error("t"); e.name = "TimeoutError"; throw e; }, sleep: async () => {}, now: () => clock,
  });
  assert.equal(thrown.ok, false);
  assert.equal(thrown.error, "TimeoutError");
  assert.equal(thrown.status, null);
  const redirected = await deliverWebhook({
    url: "https://hooks.example.com/x", secret, body, id: "msg_4", maxAttempts: 1,
    fetchImpl: async () => new Response("", { status: 302 }), now: () => clock,
  });
  assert.deepEqual(redirected, { ok: false, id: "msg_4", attempts: 1, status: 302, error: "http_302" });
});

test("deliverWebhook: a retry that cannot finish before the deadline is skipped", async () => {
  const secret = generateWebhookSecret();
  let calls = 0;
  const waits: number[] = [];
  const result = await deliverWebhook({
    url: "https://hooks.example.com/x", secret, body: "{}", id: "msg_d",
    fetchImpl: async () => { calls++; return new Response("", { status: 500 }); },
    sleep: async (ms) => { waits.push(ms); },
    now: () => 1_000_000,
    attemptTimeoutMs: 5_000,
    // One attempt plus the 1 s wait and a 5 s timeout fits; the 5 s wait does not.
    deadline: 1_000_000 + 7_000,
  });
  assert.equal(calls, 2);
  assert.deepEqual(waits, [1000]);
  assert.deepEqual(result, { ok: false, id: "msg_d", attempts: 2, status: 500, error: "deadline" });
});
