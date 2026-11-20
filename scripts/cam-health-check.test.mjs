import { test } from "node:test";
import assert from "node:assert";
import {
  computeCamUpdate,
  DISABLE_THRESHOLD,
  classifyFetchError,
  TLS_ERROR_CODES,
  ipcamliveStateUrl,
  ipcamliveVerdict,
  isOffSeasonAt,
  IPCAMLIVE_NO_STREAM,
} from "./cam-health-check.mjs";
// tsx hands a .ts module to an .mjs importer through CJS interop, so the named
// export may sit on `default`.
import * as mapUtils from "../lib/map-utils.ts";
const isOffSeason = mapUtils.isOffSeason ?? mapUtils.default.isOffSeason;

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

// ─── ipcamlive stream state ─────────────────────────────────────────────

test("ipcamliveStateUrl: player URL maps to the state endpoint on the same host", () => {
  assert.deepStrictEqual(ipcamliveStateUrl("https://g1.ipcamlive.com/player/player.php?alias=8h08e8bpagfd912"), {
    alias: "8h08e8bpagfd912",
    stateUrl: "https://g1.ipcamlive.com/player/getcamerastreamstate.php?alias=8h08e8bpagfd912",
  });
  assert.strictEqual(
    ipcamliveStateUrl("https://ipcamlive.com/player/player.php?alias=abc123&autoplay=1").stateUrl,
    "https://ipcamlive.com/player/getcamerastreamstate.php?alias=abc123",
  );
  // http players are upgraded: the state endpoint is asked over https.
  assert.strictEqual(
    ipcamliveStateUrl("http://G1.IPCAMLIVE.com/player/player.php?alias=abc123").stateUrl,
    "https://g1.ipcamlive.com/player/getcamerastreamstate.php?alias=abc123",
  );
});

test("ipcamliveStateUrl: everything that is not an ipcamlive player is null", () => {
  for (const url of [
    null,
    undefined,
    "",
    "not a url",
    "https://player.brownrice.com/embed/kirkwoodcornice",
    "https://evil-ipcamlive.com/player/player.php?alias=abc123",
    "https://ipcamlive.com.example.org/player/player.php?alias=abc123",
    "https://g1.ipcamlive.com/player/snapshot.php?alias=abc123",
    "https://g1.ipcamlive.com/player/player.php",
    "https://g1.ipcamlive.com/player/player.php?alias=",
    "https://g1.ipcamlive.com/player/player.php?alias=abc/../x",
    "ftp://g1.ipcamlive.com/player/player.php?alias=abc123",
  ]) {
    assert.strictEqual(ipcamliveStateUrl(url), null, String(url));
  }
});

test("ipcamliveVerdict: streamavailable 1 is up, 0 is down, as string or number", () => {
  assert.strictEqual(ipcamliveVerdict('{"details":{"alias":"x","streamavailable":"1","streamid":"abc"}}'), "up");
  assert.strictEqual(ipcamliveVerdict({ details: { streamavailable: 1 } }), "up");
  assert.strictEqual(ipcamliveVerdict('{"details":{"alias":"x","streamavailable":"0","streamid":null}}'), "down");
  assert.strictEqual(ipcamliveVerdict({ details: { streamavailable: 0 } }), "down");
});

test("ipcamliveVerdict: an unreadable answer is unknown, never a failure", () => {
  for (const payload of ["", "<html>404</html>", "{}", '{"details":{}}', '{"details":null}', '{"details":{"streamavailable":"2"}}', null, undefined, 42]) {
    assert.strictEqual(ipcamliveVerdict(payload), "unknown", String(payload));
  }
});

test("the no-stream reason string is stable (the run log and alerts key on it)", () => {
  assert.strictEqual(IPCAMLIVE_NO_STREAM, "ipcamlive: no stream");
});

test("isOffSeasonAt matches lib/map-utils isOffSeason for every month in both hemispheres", () => {
  for (const lat of [37.23, 46.9, -32.83, -41.15]) {
    for (let month = 0; month < 12; month++) {
      const date = new Date(2026, month, 15, 12);
      assert.strictEqual(isOffSeasonAt(lat, date), isOffSeason(lat, date), `lat ${lat}, month ${month + 1}`);
    }
  }
});

test("isOffSeasonAt: a missing latitude counts as in season, so the failure is counted", () => {
  const november = new Date(2026, 10, 20, 12);
  for (const lat of [undefined, null, NaN, "37.2"]) assert.strictEqual(isOffSeasonAt(lat, november), false);
  assert.strictEqual(isOffSeasonAt(-32.83, november), true, "Portillo in November");
  assert.strictEqual(isOffSeasonAt(37.23, november), false, "China Peak in November");
});

test("countFailure: false records the check and leaves the counter and the switches alone", () => {
  for (const state of [cam({ consecutive_failures: 2 }), cam({ is_active: false, auto_disabled: true, consecutive_failures: 3 }), cam({ is_active: false })]) {
    const { body, transition } = computeCamUpdate(state, false, { countFailure: false });
    assert.deepStrictEqual(Object.keys(body), ["last_checked_at"]);
    assert.strictEqual(transition, null);
  }
});

test("countFailure: false does not change what a healthy check does", () => {
  const { body, transition } = computeCamUpdate(cam({ is_active: false, auto_disabled: true, consecutive_failures: 3 }), true, { countFailure: false });
  assert.strictEqual(transition, "recovered");
  assert.strictEqual(body.is_active, true);
  assert.strictEqual(body.consecutive_failures, 0);
});
