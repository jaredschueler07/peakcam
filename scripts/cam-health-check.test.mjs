import { test } from "node:test";
import assert from "node:assert";
import {
  CAMS_PAGE_SIZE,
  fetchAllPaged,
  computeCamUpdate,
  DISABLE_THRESHOLD,
  classifyFetchError,
  TLS_ERROR_CODES,
  ipcamliveStateUrl,
  ipcamliveVerdict,
  isOffSeasonAt,
  IPCAMLIVE_NO_STREAM,
  youtubeLiveness,
  YOUTUBE_ENDED,
  YOUTUBE_UNAVAILABLE,
  YOUTUBE_LOGIN_REQUIRED,
  YOUTUBE_NOT_EMBEDDABLE,
  YOUTUBE_NOT_LIVE,
  isCamstreamerUrl,
  youtubeIdFromEmbedPage,
  sniffImage,
  imageVerdict,
  IMAGE_STALE_DAYS,
  countsTowardDisable,
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

// ─── YouTube liveness ───────────────────────────────────────────────────
// Fixtures are the relevant slices of real watch pages fetched 2026-11-20
// (ids in the comments), trimmed to the fields the parser reads.

const YT = {
  // awxz_oIlJE0 — Mammoth "Summit", broadcasting
  live: 'var ytInitialPlayerResponse = {"playabilityStatus":{"status":"OK","playableInEmbed":true,"liveStreamability":{"liveStreamabilityRenderer":{"videoId":"awxz_oIlJE0","broadcastId":"3","pollDelayMs":"15000"}}},"videoDetails":{"videoId":"awxz_oIlJE0","isLiveContent":true,"isLive":true},"microformat":{"playerMicroformatRenderer":{"liveBroadcastDetails":{"isLiveNow":true,"startTimestamp":"2026-11-13T15:02:11+00:00"}}}};',
  // UpfvBbw6kSY — Mammoth "Main Lodge", ended 2026-03-09
  ended: 'var ytInitialPlayerResponse = {"playabilityStatus":{"status":"UNPLAYABLE","reason":"This live stream recording is not available.","errorScreen":{"playerInterstitialRenderer":{"content":{"interstitialViewModel":{"title":{"content":"Video unavailable"}}}}},"playableInEmbed":true},"videoDetails":{"videoId":"UpfvBbw6kSY","isLiveContent":true},"microformat":{"playerMicroformatRenderer":{"liveBroadcastDetails":{"isLiveNow":false,"startTimestamp":"2026-02-27T16:40:00+00:00","endTimestamp":"2026-03-09T18:11:25+00:00"}}}};',
  // Ljumxb0U2b0 — Nordic Valley, a finished stream left up as a playable recording
  recording: 'var ytInitialPlayerResponse = {"playabilityStatus":{"status":"OK","playableInEmbed":true,"miniplayer":{"miniplayerRenderer":{"playbackMode":"PLAYBACK_MODE_ALLOW"}}},"videoDetails":{"videoId":"Ljumxb0U2b0","isLiveContent":true},"microformat":{"playerMicroformatRenderer":{"liveBroadcastDetails":{"isLiveNow":false,"endTimestamp":"2026-10-20T23:01:00+00:00"}}}};',
  // C_QzeJSA-uw — Dodge Ridge "Base Area", removed by the uploader
  removed: 'var ytInitialPlayerResponse = {"playabilityStatus":{"status":"ERROR","reason":"Video unavailable","errorScreen":{"playerInterstitialRenderer":{"content":{"interstitialViewModel":{"title":{"content":"Video unavailable"},"description":{"content":"This video has been removed by the uploader"}}}}}}};',
  // kchqCAOHweY — Nakiska, made private
  private: 'var ytInitialPlayerResponse = {"playabilityStatus":{"status":"LOGIN_REQUIRED","reason":"Private video","messages":["This is a private video. Please sign in to verify that you may see it."]}};',
};

test("youtubeLiveness: a broadcasting, embeddable stream is live", () => {
  assert.deepStrictEqual(youtubeLiveness(YT.live), { verdict: "live", reason: null });
});

test("youtubeLiveness: an ended stream is dead, whether YouTube calls it unplayable or leaves the recording up", () => {
  assert.deepStrictEqual(youtubeLiveness(YT.ended), { verdict: "dead", reason: YOUTUBE_ENDED });
  assert.deepStrictEqual(youtubeLiveness(YT.recording), { verdict: "dead", reason: YOUTUBE_ENDED });
  const offline = '{"playabilityStatus":{"status":"LIVE_STREAM_OFFLINE","reason":"This live event will begin in a few moments."}}';
  assert.deepStrictEqual(youtubeLiveness(offline), { verdict: "dead", reason: YOUTUBE_ENDED });
});

test("youtubeLiveness: removed and private videos carry their own reasons", () => {
  assert.deepStrictEqual(youtubeLiveness(YT.removed), { verdict: "dead", reason: YOUTUBE_UNAVAILABLE });
  assert.deepStrictEqual(youtubeLiveness(YT.private), { verdict: "dead", reason: YOUTUBE_LOGIN_REQUIRED });
  const unplayableUpload = '{"playabilityStatus":{"status":"UNPLAYABLE","reason":"Video unavailable in your country"},"videoDetails":{"isLiveContent":false}}';
  assert.deepStrictEqual(youtubeLiveness(unplayableUpload), { verdict: "dead", reason: YOUTUBE_UNAVAILABLE });
});

test("youtubeLiveness: live but blocked from embedding is dead for a site that only embeds", () => {
  const html = YT.live.replace('"playableInEmbed":true', '"playableInEmbed":false');
  assert.deepStrictEqual(youtubeLiveness(html), { verdict: "dead", reason: YOUTUBE_NOT_EMBEDDABLE });
});

test("youtubeLiveness: a plain upload is not a webcam", () => {
  const upload = '{"playabilityStatus":{"status":"OK","playableInEmbed":true},"videoDetails":{"videoId":"abcdefghijk","isLiveContent":false}}';
  assert.deepStrictEqual(youtubeLiveness(upload), { verdict: "dead", reason: YOUTUBE_NOT_LIVE });
});

test("youtubeLiveness: anything it cannot read is unknown, never a failure", () => {
  const botWall = '{"playabilityStatus":{"status":"LOGIN_REQUIRED","reason":"Sign in to confirm you’re not a bot"}}';
  const botWallAscii = '{"playabilityStatus":{"status":"UNPLAYABLE","reason":"Sign in to confirm you\'re not a bot"}}';
  const noLiveFields = '{"playabilityStatus":{"status":"OK","playableInEmbed":true}}';
  const newStatus = '{"playabilityStatus":{"status":"SOMETHING_NEW"}}';
  for (const html of [botWall, botWallAscii, noLiveFields, newStatus, "<html>Before you continue to YouTube</html>", "", null, undefined, 42]) {
    assert.deepStrictEqual(youtubeLiveness(html), { verdict: "unknown", reason: null }, String(html).slice(0, 60));
  }
});

test("the YouTube reason strings are stable (the run log and the daily report key on them)", () => {
  assert.strictEqual(YOUTUBE_ENDED, "youtube: stream ended");
  assert.strictEqual(YOUTUBE_UNAVAILABLE, "youtube: unavailable");
  assert.strictEqual(YOUTUBE_LOGIN_REQUIRED, "youtube: login required");
  assert.strictEqual(YOUTUBE_NOT_EMBEDDABLE, "youtube: not embeddable");
});

// ─── camstreamer ────────────────────────────────────────────────────────

test("isCamstreamerUrl: embed and live pages on camstreamer.com only", () => {
  assert.ok(isCamstreamerUrl("https://camstreamer.com/embed/qNANAbY1LFNjIC2aSgnh9Rh688XN31WQnGM1PmyD"));
  assert.ok(isCamstreamerUrl("https://camstreamer.com/embed/4caf8cbab6999c9/S-16675"));
  assert.ok(isCamstreamerUrl("https://camstreamer.com/live/stream/1865"));
  for (const url of ["https://camstreamer.com/", "https://camstreamer.com.evil.example/embed/x", "https://www.youtube.com/embed/awxz_oIlJE0", "not a url", "", null]) {
    assert.strictEqual(isCamstreamerUrl(url), false, String(url));
  }
});

test("youtubeIdFromEmbedPage: prefers the URL the request ended on, then the body", () => {
  assert.strictEqual(youtubeIdFromEmbedPage("https://www.youtube.com/embed/RjXOWYVMqA0?autoplay=1&mute=1", "<html></html>"), "RjXOWYVMqA0");
  assert.strictEqual(youtubeIdFromEmbedPage("https://www.youtube-nocookie.com/embed/cuMEPeePwjY", ""), "cuMEPeePwjY");
  const wrapped = '<iframe src="https://www.youtube.com/embed/DMVtrxOK-JM?rel=0" allowfullscreen></iframe>';
  assert.strictEqual(youtubeIdFromEmbedPage("https://camstreamer.com/embed/T2Fr", wrapped), "DMVtrxOK-JM");
  assert.strictEqual(youtubeIdFromEmbedPage("https://camstreamer.com/embed/x", '<a href="https://www.youtube.com/watch?v=QDGBc2xzH1w">'), "QDGBc2xzH1w");
  assert.strictEqual(youtubeIdFromEmbedPage("https://camstreamer.com/embed/x", '{"videoId":"Tu2d8gii-tE"}'), "Tu2d8gii-tE");
});

test("youtubeIdFromEmbedPage: no id is null (channel live_stream embeds, other players, junk)", () => {
  assert.strictEqual(youtubeIdFromEmbedPage("https://www.youtube.com/embed/live_stream?channel=UC8PLnOk6bqpOBUpIjgGGPhQ", ""), null);
  assert.strictEqual(youtubeIdFromEmbedPage("https://camstreamer.com/embed/x", "<video src=stream.m3u8>"), null);
  assert.strictEqual(youtubeIdFromEmbedPage(null, null), null);
});

// ─── Image cams ─────────────────────────────────────────────────────────

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
const HTML = new TextEncoder().encode("<!DOCTYPE html><html>");
const NOW = new Date("2026-11-20T16:00:00Z");
const img = (over = {}) => ({ ok: true, status: 200, contentType: "image/jpeg", lastModified: null, head: JPEG, now: NOW, ...over });

test("sniffImage: JPEG, PNG, GIF and WebP by their first bytes; everything else is null", () => {
  assert.strictEqual(sniffImage(JPEG), "jpeg");
  assert.strictEqual(sniffImage(PNG), "png");
  assert.strictEqual(sniffImage(GIF), "gif");
  assert.strictEqual(sniffImage(WEBP), "webp");
  assert.strictEqual(sniffImage(HTML), null);
  assert.strictEqual(sniffImage(new Uint8Array(0)), null);
  assert.strictEqual(sniffImage(null), null);
});

test("imageVerdict: a fresh picture is healthy, with or without a Last-Modified header", () => {
  assert.deepStrictEqual(imageVerdict(img()), { ok: true });
  assert.deepStrictEqual(imageVerdict(img({ lastModified: "Fri, 20 Nov 2026 15:31:04 GMT" })), { ok: true, ageDays: 0 });
  assert.strictEqual(imageVerdict(img({ lastModified: "not a date" })).ok, true);
  // A clock that runs ahead (Winter Park's Town cam sends times 6 h fast) is not stale.
  assert.deepStrictEqual(imageVerdict(img({ lastModified: "Fri, 20 Nov 2026 22:00:00 GMT" })), { ok: true, ageDays: 0 });
});

test("imageVerdict: a frame older than the threshold fails with its age (A-Basin Summit, frozen since Oct 27)", () => {
  const v = imageVerdict(img({ lastModified: "Tue, 27 Oct 2026 22:10:02 GMT" }));
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.kind, "stale");
  assert.strictEqual(v.ageDays, 23);
  assert.strictEqual(v.error, "image: frame 23 days old");
});

test("imageVerdict: the threshold is exclusive — exactly IMAGE_STALE_DAYS old still passes", () => {
  assert.strictEqual(IMAGE_STALE_DAYS, 5);
  const at = (days, hours = 0) => new Date(NOW.getTime() - days * 86_400_000 - hours * 3_600_000).toUTCString();
  assert.strictEqual(imageVerdict(img({ lastModified: at(5, 23) })).ok, true);
  assert.strictEqual(imageVerdict(img({ lastModified: at(6) })).ok, false);
});

test("imageVerdict: 200 text/html is not an image, however long the page (Loveland, three rows)", () => {
  const v = imageVerdict(img({ contentType: "text/html; charset=UTF-8", head: HTML }));
  assert.deepStrictEqual(v, { ok: false, kind: "not_image", error: "image: not an image (text/html)" });
  // …and an HTML page mislabelled as a picture does not pass either.
  assert.strictEqual(imageVerdict(img({ contentType: "image/jpeg", head: HTML })).kind, "not_image");
  assert.strictEqual(imageVerdict(img({ contentType: "", head: HTML })).error, "image: not an image (no content type)");
});

test("imageVerdict: real image bytes pass under a generic content type; an image/* type passes without known magic", () => {
  assert.strictEqual(imageVerdict(img({ contentType: "application/octet-stream" })).ok, true);
  assert.strictEqual(imageVerdict(img({ contentType: "binary/octet-stream", head: PNG })).ok, true);
  const avif = Uint8Array.from([0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]);
  assert.strictEqual(imageVerdict(img({ contentType: "image/avif", head: avif })).ok, true);
});

test("imageVerdict: an HTTP failure stays an HTTP failure (no rule-specific reason)", () => {
  assert.deepStrictEqual(imageVerdict(img({ ok: false, status: 404, contentType: "text/html", head: HTML })), { ok: false });
});

// ─── What counts toward auto-disable ────────────────────────────────────

test("countsTowardDisable: seasonal darkness is not counted off-season; a dead YouTube id always is", () => {
  const nov = new Date(2026, 10, 20);
  const andes = -33.35; // off-season in November
  const sierra = 37.63; // in season
  const stale = { ok: false, staleImage: true };
  const noStream = { ok: false, noStream: true };
  const ytDead = { ok: false, youtubeDead: true };
  const notImage = { ok: false, notImage: true };
  const http404 = { ok: false, status: 404 };
  assert.strictEqual(countsTowardDisable(stale, andes, nov), false);
  assert.strictEqual(countsTowardDisable(noStream, andes, nov), false);
  assert.strictEqual(countsTowardDisable(stale, sierra, nov), true);
  assert.strictEqual(countsTowardDisable(noStream, sierra, nov), true);
  for (const check of [ytDead, notImage, http404]) {
    assert.strictEqual(countsTowardDisable(check, andes, nov), true);
    assert.strictEqual(countsTowardDisable(check, sierra, nov), true);
  }
  // No latitude → in season → counted.
  assert.strictEqual(countsTowardDisable(stale, undefined, nov), true);
});

test("recovery and manual switches are unchanged by the new rules", () => {
  // An auto-disabled row whose probe turns healthy comes back…
  const recovered = computeCamUpdate(cam({ is_active: false, auto_disabled: true, consecutive_failures: 3 }), true);
  assert.strictEqual(recovered.transition, "recovered");
  assert.strictEqual(recovered.body.is_active, true);
  // …and a manually disabled row is never written beyond its timestamp, healthy or not.
  for (const alive of [true, false]) {
    const manual = computeCamUpdate(cam({ is_active: false, auto_disabled: false }), alive);
    assert.deepStrictEqual(Object.keys(manual.body), ["last_checked_at"]);
    assert.strictEqual(manual.transition, null);
  }
});

// ─── cam read is paged (2026-11-21: 1,000 of 1,044 cams were read) ──────

test("fetchAllPaged reads every cam past PostgREST's 1,000-row cap", async () => {
  const all = Array.from({ length: 1044 }, (_, i) => ({ id: i }));
  const calls = [];
  const rows = await fetchAllPaged(async (offset, limit) => {
    calls.push([offset, limit]);
    return all.slice(offset, offset + Math.min(limit, 1000));
  });
  assert.strictEqual(CAMS_PAGE_SIZE, 1000);
  assert.strictEqual(rows.length, 1044);
  assert.strictEqual(rows[1043].id, 1043);
  assert.deepStrictEqual(calls, [[0, 1000], [1000, 1000]]);
});

test("fetchAllPaged stops after one short page and rejects a non-array page", async () => {
  let n = 0;
  const rows = await fetchAllPaged(async () => { n++; return [{ id: 1 }]; });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(n, 1);
  await assert.rejects(fetchAllPaged(async () => ({ message: "error" })), /not an array/);
  await assert.rejects(fetchAllPaged(async (o, l) => Array.from({ length: l }, () => ({})), 5, 2), /more than 2 pages/);
});
