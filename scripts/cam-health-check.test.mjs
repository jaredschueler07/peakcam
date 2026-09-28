import { test } from "node:test";
import assert from "node:assert";
import { computeCamUpdate, DISABLE_THRESHOLD, classifyFetchError, TLS_ERROR_CODES } from "./cam-health-check.mjs";

const cam = (over = {}) => ({ id: "c1", is_active: true, auto_disabled: false, consecutive_failures: 0, ...over });

test("threshold constant is 3", () => {
  assert.strictEqual(DISABLE_THRESHOLD, 3);
});

test("alive + healthy cam: resets counter, no transition", () => {
  const { body, transition } = computeCamUpdate(cam({ consecutive_failures: 2 }), true);
  assert.strictEqual(body.consecutive_failures, 0);
  assert.strictEqual(transition, null);
  assert.ok(!("is_active" in body));
});

test("dead cam below threshold: increments only", () => {
  const { body, transition } = computeCamUpdate(cam({ consecutive_failures: 1 }), false);
  assert.strictEqual(body.consecutive_failures, 2);
  assert.strictEqual(transition, null);
  assert.ok(!("is_active" in body));
});

test("dead cam reaching threshold: auto-disables", () => {
  const { body, transition } = computeCamUpdate(cam({ consecutive_failures: 2 }), false);
  assert.strictEqual(body.consecutive_failures, 3);
  assert.strictEqual(body.is_active, false);
  assert.strictEqual(body.auto_disabled, true);
  assert.strictEqual(transition, "disabled");
});

test("already auto-disabled + still dead: counts up, no re-transition", () => {
  const { body, transition } = computeCamUpdate(cam({ is_active: false, auto_disabled: true, consecutive_failures: 5 }), false);
  assert.strictEqual(body.consecutive_failures, undefined, "counter is frozen once auto-disabled");
  assert.ok(body.last_checked_at);
  assert.strictEqual(transition, null);
  assert.ok(!("is_active" in body));
});

test("auto-disabled cam comes back: recovers", () => {
  const { body, transition } = computeCamUpdate(cam({ is_active: false, auto_disabled: true, consecutive_failures: 4 }), true);
  assert.strictEqual(body.is_active, true);
  assert.strictEqual(body.auto_disabled, false);
  assert.strictEqual(body.consecutive_failures, 0);
  assert.strictEqual(transition, "recovered");
});

test("MANUALLY disabled cam is never re-enabled, alive or not", () => {
  const alive = computeCamUpdate(cam({ is_active: false, auto_disabled: false }), true);
  assert.ok(!("is_active" in alive.body));
  assert.strictEqual(alive.transition, null);
  const dead = computeCamUpdate(cam({ is_active: false, auto_disabled: false, consecutive_failures: 9 }), false);
  assert.ok(!("is_active" in dead.body));
  assert.strictEqual(dead.transition, null);
});

// ─── classifyFetchError ──────────────────────────────────────────────────
// undici wraps every transport failure as TypeError("fetch failed") with the
// real Node/OpenSSL error on `.cause`; build the fixtures the same way.

const fetchFailed = (cause) => new TypeError("fetch failed", { cause });
const nodeError = (message, code) => Object.assign(new Error(message), { code });

test("classifyFetchError: an expired certificate is a permanent TLS failure (A-Basin Base, browser-test D4)", () => {
  const c = classifyFetchError(fetchFailed(nodeError("certificate has expired", "CERT_HAS_EXPIRED")));
  assert.strictEqual(c.kind, "tls");
  assert.strictEqual(c.code, "CERT_HAS_EXPIRED");
  assert.strictEqual(c.retryable, false);
  assert.strictEqual(c.message, "TLS CERT_HAS_EXPIRED: certificate has expired");
});

test("classifyFetchError: every listed certificate code and the ERR_TLS_/ERR_SSL_/ERR_CERT_ prefixes are TLS", () => {
  for (const code of TLS_ERROR_CODES) {
    const c = classifyFetchError(fetchFailed(nodeError("boom", code)));
    assert.strictEqual(c.kind, "tls", code);
    assert.strictEqual(c.retryable, false, code);
  }
  for (const code of ["ERR_TLS_CERT_ALTNAME_INVALID", "ERR_CERT_DATE_INVALID", "ERR_SSL_PROTOCOL_ERROR"]) {
    const c = classifyFetchError(fetchFailed(nodeError("boom", code)));
    assert.strictEqual(c.kind, "tls", code);
    assert.strictEqual(c.code, code);
    assert.strictEqual(c.retryable, false, code);
  }
});

test("classifyFetchError: ECONNRESET during the handshake is TLS; a plain reset is a retryable network error", () => {
  const handshake = classifyFetchError(
    fetchFailed(nodeError("Client network socket disconnected before secure TLS connection was established", "ECONNRESET")),
  );
  assert.strictEqual(handshake.kind, "tls");
  assert.strictEqual(handshake.code, "ECONNRESET");
  assert.strictEqual(handshake.retryable, false);

  const plain = classifyFetchError(fetchFailed(nodeError("read ECONNRESET", "ECONNRESET")));
  assert.strictEqual(plain.kind, "network");
  assert.strictEqual(plain.code, "ECONNRESET");
  assert.strictEqual(plain.retryable, true);
  assert.strictEqual(plain.message, "network ECONNRESET: read ECONNRESET");
});

test("classifyFetchError: searches nested causes and AggregateError members", () => {
  const aggregate = new AggregateError(
    [nodeError("connect ECONNREFUSED ::1:443", "ECONNREFUSED"), nodeError("self signed certificate", "DEPTH_ZERO_SELF_SIGNED_CERT")],
    "multiple errors",
  );
  const viaAggregate = classifyFetchError(fetchFailed(aggregate));
  assert.strictEqual(viaAggregate.kind, "tls");
  assert.strictEqual(viaAggregate.code, "DEPTH_ZERO_SELF_SIGNED_CERT");
  assert.strictEqual(viaAggregate.message, "TLS DEPTH_ZERO_SELF_SIGNED_CERT: self signed certificate");

  const nested = fetchFailed(
    Object.assign(new Error("wrapper"), { cause: nodeError("unable to verify the first certificate", "UNABLE_TO_VERIFY_LEAF_SIGNATURE") }),
  );
  assert.strictEqual(classifyFetchError(nested).code, "UNABLE_TO_VERIFY_LEAF_SIGNATURE");

  // A cycle in the cause chain must not hang the classifier.
  const loop = new Error("a");
  loop.cause = loop;
  assert.strictEqual(classifyFetchError(loop).kind, "unknown");
});

test("classifyFetchError: a certificate complaint with no code is still TLS", () => {
  const c = classifyFetchError(fetchFailed(new Error("Hostname/IP does not match certificate's altnames")));
  assert.strictEqual(c.kind, "tls");
  assert.strictEqual(c.code, null);
  assert.strictEqual(c.retryable, false);
  assert.strictEqual(c.message, "TLS: Hostname/IP does not match certificate's altnames");
});

test("classifyFetchError: timeouts are retryable", () => {
  const abort = classifyFetchError(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
  assert.strictEqual(abort.kind, "timeout");
  assert.strictEqual(abort.retryable, true);
  assert.strictEqual(abort.message, "timeout: The operation was aborted due to timeout");

  const connect = classifyFetchError(fetchFailed(nodeError("Connect Timeout Error", "UND_ERR_CONNECT_TIMEOUT")));
  assert.strictEqual(connect.kind, "timeout");
  assert.strictEqual(connect.code, "UND_ERR_CONNECT_TIMEOUT");
  assert.strictEqual(connect.retryable, true);
});

test("classifyFetchError: DNS — NXDOMAIN is permanent, EAI_AGAIN is transient", () => {
  const missing = classifyFetchError(fetchFailed(nodeError("getaddrinfo ENOTFOUND photosskiloveland.com", "ENOTFOUND")));
  assert.strictEqual(missing.kind, "dns");
  assert.strictEqual(missing.retryable, false);
  const again = classifyFetchError(fetchFailed(nodeError("getaddrinfo EAI_AGAIN cam.example", "EAI_AGAIN")));
  assert.strictEqual(again.kind, "dns");
  assert.strictEqual(again.retryable, true);
});

test("classifyFetchError: unrecognised errors keep the old retry behaviour and never throw", () => {
  const bare = classifyFetchError(new TypeError("fetch failed"));
  assert.strictEqual(bare.kind, "unknown");
  assert.strictEqual(bare.retryable, true);
  assert.strictEqual(bare.message, "error: fetch failed");
  assert.strictEqual(classifyFetchError("string thrown").message, "error: string thrown");
  assert.strictEqual(classifyFetchError(null).message, "error: unknown error");
  assert.strictEqual(classifyFetchError(undefined).kind, "unknown");
});
