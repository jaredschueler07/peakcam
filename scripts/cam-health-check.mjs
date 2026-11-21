#!/usr/bin/env node

/**
 * cam-health-check.mjs
 * ────────────────────
 * Validates all cam URLs in the database and updates last_checked_at.
 *
 * Usage:
 *   node scripts/cam-health-check.mjs
 *
 * Reads:  .env.local (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 * Writes: Supabase cams table (last_checked_at, consecutive_failures,
 *         is_active / auto_disabled on the third failure and on recovery)
 *
 * What each cam type is judged on (docs/runbook.md "Cam health check"):
 *   youtube     the watch page: playable, embeddable and live right now
 *   image       HTTP 2xx, image bytes, and a Last-Modified no older than
 *               IMAGE_STALE_DAYS when the server sends one
 *   camstreamer the YouTube stream its embed page currently serves
 *   ipcamlive   the provider's stream-state endpoint
 *   other       HTTP status of the embed page
 * A probe that cannot reach a verdict (network trouble, an interstitial, a
 * field that is not there) falls back to the older, weaker check and never
 * counts as a failure on its own.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ─── Load .env.local manually (same pattern as snotel-sync.mjs) ─────────

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

loadEnv(path.join(ROOT, ".env.local"));
loadEnv(path.join(ROOT, ".env"));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Checked from main(), not at import time: scripts/cam-health-check.test.mjs
// imports the pure helpers below and must run without a .env.local.
function assertRunnable() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error(
      "Missing env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"
    );
    process.exit(1);
  }
  // A probe that skips certificate verification would report an expired or
  // mis-issued certificate as a healthy cam while every browser refuses to
  // load it (A-Basin "Base", browser-test D4). Refuse to run rather than lie.
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    console.error(
      "Refusing to run with NODE_TLS_REJECT_UNAUTHORIZED=0 — the health check must fail TLS the way browsers do."
    );
    process.exit(1);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Fetch-error classification ─────────────────────────────────────────
//
// Node's fetch (undici) throws `TypeError: fetch failed` for every transport
// problem and hides the real reason in `.cause` — sometimes nested, sometimes
// an AggregateError. Logging `err.message` therefore read "fetch failed" for
// an expired certificate, and because the result had status 0 the retry loop
// treated it as a flaky connection. Browsers refuse such a cam outright, so a
// TLS failure has to count as a dead cam exactly like an HTTP 404 does — and
// it is never "fixed" by relaxing verification (see assertRunnable).

export const TLS_ERROR_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_REVOKED",
  "CERT_REJECTED",
  "CERT_UNTRUSTED",
  "CERT_CHAIN_TOO_LONG",
  "CERT_SIGNATURE_FAILURE",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_GET_CRL",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "HOSTNAME_MISMATCH",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_TLS_HANDSHAKE_TIMEOUT",
  "ERR_SSL_WRONG_VERSION_NUMBER",
  "EPROTO",
]);
const TLS_CODE_PREFIX_RE = /^ERR_(TLS|SSL|CERT)_/;
const TLS_TEXT_RE = /\b(certificate|tls|ssl|handshake)\b/i;
const TIMEOUT_CODES = new Set([
  "ABORT_ERR",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);
const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_NONAME", "EAI_FAIL"]);
const KIND_LABEL = { tls: "TLS", timeout: "timeout", dns: "DNS", network: "network", unknown: "error" };

/** Flatten an error, its `cause` chain and any AggregateError members into a list. */
function errorChain(err, seen = new Set()) {
  const out = [];
  let cur = err;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    if (Array.isArray(cur.errors)) {
      for (const member of cur.errors) out.push(...errorChain(member, seen));
    }
    cur = cur.cause;
  }
  return out;
}

/**
 * Pure. Turns a thrown fetch error into { kind, code, message, retryable }.
 *   kind      "tls" | "timeout" | "dns" | "network" | "unknown"
 *   code      the most specific Node/OpenSSL/undici code found, or null
 *   message   one-line detail for the run log ("TLS CERT_HAS_EXPIRED: …")
 *   retryable false for TLS (a bad certificate does not fix itself between
 *             two attempts a second apart — treat it like a 4xx) and for a
 *             hard DNS miss; true for timeouts, transient DNS and plain
 *             connection failures, which is what the retry loop was for.
 * ECONNRESET is TLS only when the message says the reset happened during the
 * handshake ("… before secure TLS connection was established"); a reset on an
 * established connection stays a retryable network error.
 */
export function classifyFetchError(err) {
  const chain = errorChain(err);
  const codes = chain.map((e) => (typeof e.code === "string" ? e.code : "")).filter(Boolean);
  const names = chain.map((e) => (typeof e.name === "string" ? e.name : ""));
  const texts = chain.map((e) => (typeof e.message === "string" ? e.message : "")).filter(Boolean);
  const detail =
    texts.filter((t) => t !== "fetch failed").pop() ?? texts[0] ?? String(err ?? "unknown error");
  const tlsText = texts.some((t) => TLS_TEXT_RE.test(t));

  let kind;
  let code = null;
  const tlsCode = codes.find((c) => TLS_ERROR_CODES.has(c) || TLS_CODE_PREFIX_RE.test(c));
  if (tlsCode) {
    kind = "tls";
    code = tlsCode;
  } else if (codes.includes("ECONNRESET") && tlsText) {
    kind = "tls";
    code = "ECONNRESET";
  } else if (names.some((n) => n === "TimeoutError" || n === "AbortError") || codes.some((c) => TIMEOUT_CODES.has(c))) {
    kind = "timeout";
    code = codes.find((c) => TIMEOUT_CODES.has(c)) ?? null;
  } else if (codes.some((c) => DNS_CODES.has(c))) {
    kind = "dns";
    code = codes.find((c) => DNS_CODES.has(c));
  } else if (tlsText) {
    // No recognisable code, but OpenSSL told us in words.
    kind = "tls";
  } else if (codes.length > 0) {
    kind = "network";
    code = codes[codes.length - 1];
  } else {
    kind = "unknown";
  }

  const retryable = kind === "timeout" || kind === "network" || kind === "unknown" || code === "EAI_AGAIN";
  const label = KIND_LABEL[kind];
  const message = code ? `${label} ${code}: ${detail}` : `${label}: ${detail}`;
  return { kind, code, message, retryable };
}

/** Shape a thrown fetch error as a checkCamOnce() failure result. */
function failureFromError(err) {
  const c = classifyFetchError(err);
  return { ok: false, status: 0, error: c.message, errorKind: c.kind, retryable: c.retryable };
}

export const DISABLE_THRESHOLD = 3;

/** Pause after a check that loaded a YouTube watch page. */
const YOUTUBE_PACE_MS = 1000;

/**
 * Pure state transition for one cam's health check result.
 * Returns { body, transition } — body is the PATCH payload,
 * transition is null | "disabled" | "recovered" (for logging).
 * Never touches manually-disabled cams (is_active=false && !auto_disabled).
 * `countFailure: false` records the check without moving the failure counter
 * or the disable switch — used for a stream that is expected to be dark (an
 * off-season resort), which must neither be disabled nor read as recovered.
 */
export function computeCamUpdate(cam, isAlive, { countFailure = true } = {}) {
  const body = { last_checked_at: new Date().toISOString() };
  if (!isAlive && !countFailure) return { body, transition: null };
  const manuallyDisabled = !cam.is_active && !cam.auto_disabled;
  if (isAlive) {
    body.consecutive_failures = 0;
    if (manuallyDisabled) return { body: { last_checked_at: body.last_checked_at }, transition: null };
    if (cam.auto_disabled) {
      body.is_active = true;
      body.auto_disabled = false;
      return { body, transition: "recovered" };
    }
    return { body, transition: null };
  }
  if (manuallyDisabled) return { body: { last_checked_at: body.last_checked_at }, transition: null };
  // Once auto-disabled, freeze the counter: it should read "how many
  // failures tripped the disable", not "how many days it has been dead".
  if (cam.auto_disabled) return { body, transition: null };
  const failures = (cam.consecutive_failures ?? 0) + 1;
  body.consecutive_failures = failures;
  if (cam.is_active && failures >= DISABLE_THRESHOLD) {
    body.is_active = false;
    body.auto_disabled = true;
    return { body, transition: "disabled" };
  }
  return { body, transition: null };
}

// ─── ipcamlive stream state ─────────────────────────────────────────────
//
// An ipcamlive player page (`…ipcamlive.com/player/player.php?alias=X`) answers
// 200 whether or not the camera is streaming, so the generic iframe probe below
// called a dark player healthy (China Peak, 2026-11-20: five of six cams with
// no stream, all reported live). The player itself asks
// `/player/getcamerastreamstate.php?alias=X` and shows its offline card when
// `details.streamavailable` is 0, so the probe asks the same question.

export const IPCAMLIVE_NO_STREAM = "ipcamlive: no stream";

/**
 * Pure. For an ipcamlive player URL returns { alias, stateUrl } on the same
 * host; null for anything else (other hosts, no alias, an unparsable URL).
 */
export function ipcamliveStateUrl(embedUrl) {
  if (typeof embedUrl !== "string" || !embedUrl) return null;
  let url;
  try {
    url = new URL(embedUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (host !== "ipcamlive.com" && !host.endsWith(".ipcamlive.com")) return null;
  if (!/\/player\/player\.php$/.test(url.pathname)) return null;
  const alias = url.searchParams.get("alias");
  if (!alias || !/^[A-Za-z0-9]+$/.test(alias)) return null;
  return { alias, stateUrl: `https://${host}/player/getcamerastreamstate.php?alias=${alias}` };
}

/**
 * Pure. Reads a getcamerastreamstate.php body.
 *   "up"      details.streamavailable is "1" / 1
 *   "down"    details.streamavailable is "0" / 0
 *   "unknown" anything else (not JSON, no details, another value) — the caller
 *             falls back to the generic probe rather than count a failure.
 */
export function ipcamliveVerdict(payload) {
  let data = payload;
  if (typeof payload === "string") {
    try {
      data = JSON.parse(payload);
    } catch {
      return "unknown";
    }
  }
  const flag = data && typeof data === "object" ? data.details?.streamavailable : undefined;
  if (flag === "1" || flag === 1) return "up";
  if (flag === "0" || flag === 0) return "down";
  return "unknown";
}

/**
 * Pure. Same months as isOffSeason() in lib/map-utils.ts (this script runs
 * under plain node and cannot import that TypeScript module; the test pins the
 * two together). A resort with no usable latitude is treated as in season.
 */
export function isOffSeasonAt(lat, date) {
  if (typeof lat !== "number" || !Number.isFinite(lat)) return false;
  const month = date.getMonth() + 1;
  const inSeason = lat >= 0 ? month >= 11 || month <= 4 : month >= 5 && month <= 10;
  return !inSeason;
}

// ─── YouTube liveness ───────────────────────────────────────────────────
//
// oEmbed answers 200 for any video that still exists, including a live stream
// that ended months ago and now shows "This live stream recording is not
// available" (2026-11-20: 92 of 264 active YouTube cams). The watch page
// carries the player's own verdict in ytInitialPlayerResponse, so read that.

export const YOUTUBE_ENDED = "youtube: stream ended";
export const YOUTUBE_UNAVAILABLE = "youtube: unavailable";
export const YOUTUBE_LOGIN_REQUIRED = "youtube: login required";
export const YOUTUBE_NOT_EMBEDDABLE = "youtube: not embeddable";
export const YOUTUBE_NOT_LIVE = "youtube: not a live stream";

/** Browser headers: YouTube serves the full player response only to a browser. */
export const YOUTUBE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  "Accept": "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
};

const YT_BOT_WALL_RE = /not a bot|unusual traffic|confirm you.{0,8}re not/i;

function ytBool(html, key) {
  const m = html.match(new RegExp(`"${key}":(true|false)`));
  return m ? m[1] === "true" : null;
}

/**
 * Pure. Reads a YouTube watch page and returns { verdict, reason }.
 *   "live"    playable, embeddable and broadcasting now
 *   "dead"    with a specific reason string (one of the YOUTUBE_* constants)
 *   "unknown" the page did not carry a usable player response (consent or
 *             bot interstitial, a truncated body, a layout change) — the
 *             caller falls back to oEmbed and does not count a failure.
 * A catalogue row is a webcam, so a playable video that is not broadcasting
 * is dead too: an ended stream left up as a recording, or a plain upload.
 */
export function youtubeLiveness(html) {
  if (typeof html !== "string" || !html) return { verdict: "unknown", reason: null };
  const ps = html.match(/"playabilityStatus":\{"status":"([A-Z_]+)"(?:,"reason":"((?:[^"\\]|\\.)*)")?/);
  if (!ps) return { verdict: "unknown", reason: null };
  const status = ps[1];
  const reason = ps[2] ?? "";
  // "Sign in to confirm you're not a bot" arrives as LOGIN_REQUIRED (or
  // UNPLAYABLE) for a perfectly healthy video: that is about us, not the cam.
  if (YT_BOT_WALL_RE.test(reason)) return { verdict: "unknown", reason: null };

  const isLiveNow = ytBool(html, "isLiveNow");
  const isLiveContent = ytBool(html, "isLiveContent");
  const playableInEmbed = ytBool(html, "playableInEmbed");

  if (status === "LOGIN_REQUIRED") return { verdict: "dead", reason: YOUTUBE_LOGIN_REQUIRED };
  if (status === "ERROR") return { verdict: "dead", reason: YOUTUBE_UNAVAILABLE };
  if (status === "LIVE_STREAM_OFFLINE") return { verdict: "dead", reason: YOUTUBE_ENDED };
  if (status === "UNPLAYABLE") {
    const wasLive = isLiveContent === true || /live stream/i.test(reason);
    return { verdict: "dead", reason: wasLive ? YOUTUBE_ENDED : YOUTUBE_UNAVAILABLE };
  }
  if (status !== "OK") return { verdict: "unknown", reason: null };

  // status OK from here on.
  if (playableInEmbed === false) return { verdict: "dead", reason: YOUTUBE_NOT_EMBEDDABLE };
  if (isLiveNow === true) return { verdict: "live", reason: null };
  if (isLiveNow === false) {
    return { verdict: "dead", reason: isLiveContent === true ? YOUTUBE_ENDED : YOUTUBE_NOT_LIVE };
  }
  // OK but no liveBroadcastDetails at all: a plain upload when the page says
  // so, otherwise a page we could not read properly.
  if (isLiveContent === false) return { verdict: "dead", reason: YOUTUBE_NOT_LIVE };
  return { verdict: "unknown", reason: null };
}

// ─── camstreamer embeds ─────────────────────────────────────────────────
//
// `https://camstreamer.com/embed/<id>` redirects to (or wraps) the YouTube
// embed for whatever stream the camera is pushing right now. The address is
// stable while the YouTube id behind it changes, so the page answers 200 for
// a dead stream as well. Resolve the id and judge it like a YouTube cam.

const YT_ID = "[A-Za-z0-9_-]{11}";

/** Pure. True for a camstreamer.com embed or live-stream page URL. */
export function isCamstreamerUrl(embedUrl) {
  if (typeof embedUrl !== "string" || !embedUrl) return false;
  try {
    const url = new URL(embedUrl);
    const host = url.hostname.toLowerCase();
    return (host === "camstreamer.com" || host.endsWith(".camstreamer.com")) && /^\/(embed|live)\//.test(url.pathname);
  } catch {
    return false;
  }
}

/**
 * Pure. The YouTube id a camstreamer page serves: from the URL the request
 * ended on (a redirect to youtube.com/embed/<id>) or, failing that, from the
 * first YouTube embed/watch reference in the body. null when there is none.
 */
export function youtubeIdFromEmbedPage(finalUrl, html) {
  const fromUrl = typeof finalUrl === "string" ? finalUrl.match(new RegExp(`youtube(?:-nocookie)?\\.com/embed/(${YT_ID})(?![A-Za-z0-9_-])`)) : null;
  if (fromUrl && fromUrl[1] !== "live_stream") return fromUrl[1];
  if (typeof html !== "string" || !html) return null;
  const patterns = [
    new RegExp(`youtube(?:-nocookie)?\\.com/embed/(${YT_ID})(?![A-Za-z0-9_-])`),
    new RegExp(`youtube\\.com/watch\\?v=(${YT_ID})(?![A-Za-z0-9_-])`),
    new RegExp(`"videoId":"(${YT_ID})"`),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1] !== "live_stream") return m[1];
  }
  return null;
}

// ─── Image cams ─────────────────────────────────────────────────────────
//
// "200 and more than 1,000 bytes" passed an HTML error page (Loveland, three
// rows) and a frame that last changed in April (Eldora). Judge the bytes, and
// the age when the server states one.

/** A still that has not changed for this many days is not a webcam any more. */
export const IMAGE_STALE_DAYS = 5;

/** Pure. "jpeg" | "png" | "gif" | "webp" | null from the first bytes of a body. */
export function sniffImage(bytes) {
  if (!bytes || bytes.length < 4) return null;
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "gif";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
  return null;
}

function looksLikeMarkup(bytes) {
  if (!bytes || bytes.length === 0) return false;
  let i = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3; // UTF-8 BOM
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
  return bytes[i] === 0x3c || bytes[i] === 0x7b; // "<" (HTML/XML) or "{" (a JSON error)
}

/**
 * Pure. Verdict for an image cam's response.
 *   input  { ok, contentType, lastModified, head, now } — ok is resp.ok
 *          head = the first bytes of the body (16 is enough)
 *   output { ok, error?, kind?, ageDays? }
 *          kind "not_image" — 2xx but the body is not a picture
 *               "stale"     — Last-Modified older than IMAGE_STALE_DAYS
 * No Last-Modified header, or one that does not parse, is no judgement: plenty
 * of live cams send none.
 */
export function imageVerdict({ ok, contentType = "", lastModified = null, head = null, now = new Date() }) {
  if (!ok) return { ok: false };
  const type = String(contentType).split(";")[0].trim().toLowerCase();
  const magic = sniffImage(head);
  // Magic bytes settle it whatever the header says (some servers send images
  // as application/octet-stream). Without them, trust an image/* header only
  // when the body does not open like markup (covers svg/avif/bmp, rejects an
  // HTML page mislabelled as a picture).
  const isImage = magic !== null || (type.startsWith("image/") && !looksLikeMarkup(head));
  if (!isImage) {
    return { ok: false, kind: "not_image", error: `image: not an image (${type || "no content type"})` };
  }
  if (lastModified) {
    const at = Date.parse(lastModified);
    if (Number.isFinite(at)) {
      const ageDays = Math.floor((now.getTime() - at) / 86_400_000);
      if (ageDays > IMAGE_STALE_DAYS) {
        return { ok: false, kind: "stale", ageDays, error: `image: frame ${ageDays} days old` };
      }
      return { ok: true, ageDays: Math.max(ageDays, 0) };
    }
  }
  return { ok: true };
}

/**
 * Pure. Whether a failed check moves the auto-disable counter.
 * Seasonal darkness is not a fault: an ipcamlive stream with no signal or a
 * still that stopped updating, at a resort that is out of season, is recorded
 * and left alone. A dead YouTube id is dead in any season (the id never comes
 * back; a new stream gets a new one), so it always counts — and so does a
 * camstreamer embed, which is judged as YouTube.
 */
export function countsTowardDisable(check, lat, date) {
  if (!check || check.ok) return true;
  if (check.noStream || check.staleImage) return !isOffSeasonAt(lat, date);
  return true;
}

// ─── Step 1: Fetch all cams ─────────────────────────────────────────────

/** PostgREST returns at most this many rows per request, whatever `limit` asks for. */
export const CAMS_PAGE_SIZE = 1000;

/**
 * Every row behind `fetchPage(offset, limit)`, which must return rows in a
 * stable order. The run of 2026-11-21 read 1,000 of 1,044 cams in a single
 * request: the last 44 by id (38 of them active) were never probed, so they
 * kept an old `last_checked_at` and could neither fail nor recover.
 */
export async function fetchAllPaged(fetchPage, pageSize = CAMS_PAGE_SIZE, maxPages = 100) {
  const out = [];
  for (let page = 0; page < maxPages; page++) {
    const rows = await fetchPage(page * pageSize, pageSize);
    if (!Array.isArray(rows)) throw new Error("cams page was not an array");
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
  throw new Error(`more than ${maxPages} pages of ${pageSize} cams`);
}

async function fetchAllCams() {
  const url = `${SUPABASE_URL}/rest/v1/cams?select=id,name,resort_id,embed_type,embed_url,youtube_id,is_active,auto_disabled,consecutive_failures&order=id`;
  // Use the service role key (bypasses RLS) rather than the anon key: the
  // "Public cams read" RLS policy restricts anon reads to is_active=true,
  // which would hide auto-disabled cams from every future run and make
  // auto-recovery unreachable in practice.
  return fetchAllPaged(async (offset, limit) => {
    const resp = await fetch(`${url}&limit=${limit}&offset=${offset}`, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
    });
    if (!resp.ok) throw new Error(`Supabase cams fetch failed: ${resp.status}`);
    return resp.json();
  });
}

/** resort id → latitude, for the off-season guard. Read-only. */
async function fetchResortLatitudes() {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/resorts?select=id,lat`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!resp.ok) throw new Error(`Supabase resorts fetch failed: ${resp.status}`);
  const rows = await resp.json();
  return new Map(rows.map((r) => [r.id, typeof r.lat === "number" ? r.lat : Number(r.lat)]));
}

// ─── Step 2: Check a single cam ─────────────────────────────────────────

const HEADERS = {
  "User-Agent": "PeakCam/1.0 (https://peakcam.io; contact@peakcam.io) cam-health-check",
  "Accept": "text/html,application/xhtml+xml,image/jpeg,image/png,*/*",
  "Referer": "https://peakcam.io/",
};

async function checkCam(cam) {
  const timeout = 12_000;
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await checkCamOnce(cam, timeout);
      if (result.ok || attempt === maxRetries) return result;
      // Permanent failures are returned at once; only transient ones (timeout,
      // connection reset, 5xx) get the backoff-and-retry treatment.
      if (result.retryable === false) return result; // TLS / hard DNS — see classifyFetchError
      if (result.status > 0 && result.status < 500) return result; // 4xx = permanent, don't retry
      await sleep(1000 * (attempt + 1)); // backoff
    } catch {
      if (attempt === maxRetries) return { ok: false, status: 0, error: "max retries exceeded" };
      await sleep(1000 * (attempt + 1));
    }
  }
  return { ok: false, status: 0, error: "unreachable" };
}

async function checkCamOnce(cam, timeout) {
  // YouTube — the watch page says whether the stream is live; oEmbed (does
  // the video exist at all) is only the fallback when that cannot be read.
  if (cam.embed_type === "youtube" && cam.youtube_id) {
    const live = await probeYoutubeLiveness(cam.youtube_id, timeout);
    if (live.verdict === "live") return { ok: true, status: 200, youtubeProbed: true };
    if (live.verdict === "dead") {
      return { ok: false, status: 200, error: live.reason, retryable: false, youtubeDead: true, youtubeProbed: true };
    }
    const oembedUrl = `https://www.youtube.com/oembed?url=https://youtube.com/watch?v=${cam.youtube_id}&format=json`;
    try {
      const resp = await fetch(oembedUrl, {
        headers: HEADERS,
        signal: AbortSignal.timeout(timeout),
      });
      return { ok: resp.ok, status: resp.status, livenessUnknown: true, youtubeProbed: true };
    } catch (err) {
      return { ...failureFromError(err), livenessUnknown: true, youtubeProbed: true };
    }
  }

  if (!cam.embed_url) return { ok: false, status: 0, error: "no URL or youtube_id" };

  // Image cams — GET request (some servers reject HEAD)
  if (cam.embed_type === "image") {
    try {
      const resp = await fetch(cam.embed_url, {
        method: "GET",
        headers: { ...HEADERS, "Accept": "image/jpeg,image/png,image/*,*/*" },
        redirect: "follow",
        signal: AbortSignal.timeout(timeout),
      });
      const contentType = resp.headers.get("content-type") || "";
      const contentLength = parseInt(resp.headers.get("content-length") || "0", 10);
      const lastModified = resp.headers.get("last-modified");
      // Read the body (also prevents a leak) and keep its first bytes: the
      // verdict is on what was served, not on the headers alone.
      const head = new Uint8Array(await resp.arrayBuffer()).subarray(0, 16);
      const verdict = imageVerdict({ ok: resp.ok, contentType, lastModified, head });
      return {
        ok: verdict.ok,
        status: resp.status,
        contentLength,
        lastModified,
        contentType,
        ...(verdict.error ? { error: verdict.error, retryable: false } : {}),
        ...(verdict.kind === "stale" ? { staleImage: true } : {}),
        ...(verdict.kind === "not_image" ? { notImage: true } : {}),
      };
    } catch (err) {
      // Includes every TLS/certificate failure: fetch never returns a Response
      // for those, so without this they would have been logged as a bare
      // "fetch failed" and retried as if the connection were merely flaky.
      return failureFromError(err);
    }
  }

  // ipcamlive players: ask the provider whether a stream exists. Any trouble
  // with the state endpoint (network, non-200, unreadable body) is "unknown"
  // and falls through to the generic probe — it never counts as a failure.
  const ipcamlive = ipcamliveStateUrl(cam.embed_url);
  if (ipcamlive) {
    let verdict = "unknown";
    try {
      const resp = await fetch(ipcamlive.stateUrl, {
        headers: { ...HEADERS, "Accept": "application/json,*/*" },
        redirect: "follow",
        signal: AbortSignal.timeout(timeout),
      });
      const text = await resp.text();
      if (resp.ok) verdict = ipcamliveVerdict(text);
    } catch {
      verdict = "unknown";
    }
    if (verdict === "up") return { ok: true, status: 200 };
    // Not retryable: the provider answered, and it will say the same thing a
    // second later.
    if (verdict === "down") return { ok: false, status: 200, error: IPCAMLIVE_NO_STREAM, retryable: false, noStream: true };
  }

  // iframe / link — GET request with proper headers
  const camstreamer = isCamstreamerUrl(cam.embed_url);
  try {
    const resp = await fetch(cam.embed_url, {
      method: "GET",
      headers: camstreamer ? { ...HEADERS, ...YOUTUBE_HEADERS, Referer: HEADERS.Referer } : HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(timeout),
    });
    const body = await resp.text();
    const ok = resp.status >= 200 && resp.status < 400;
    if (!ok || !camstreamer) return { ok, status: resp.status };

    // camstreamer: the page is up; is the YouTube stream behind it live? No id
    // or no readable verdict keeps the HTTP result and counts nothing.
    const videoId = youtubeIdFromEmbedPage(resp.url, body);
    if (!videoId) return { ok, status: resp.status, livenessUnknown: true, youtubeProbed: true };
    const live = await probeYoutubeLiveness(videoId, timeout);
    if (live.verdict === "dead") {
      return {
        ok: false,
        status: resp.status,
        error: `camstreamer → ${live.reason} (${videoId})`,
        retryable: false,
        youtubeDead: true,
        youtubeProbed: true,
      };
    }
    return { ok, status: resp.status, youtubeProbed: true, ...(live.verdict === "unknown" ? { livenessUnknown: true } : {}) };
  } catch (err) {
    return failureFromError(err);
  }
}

/**
 * One GET of the watch page → youtubeLiveness(). Never throws and never
 * reports a failure of its own: any trouble is { verdict: "unknown" }.
 */
async function probeYoutubeLiveness(videoId, timeout) {
  try {
    const resp = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
      headers: YOUTUBE_HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(timeout),
    });
    const html = await resp.text();
    if (!resp.ok) return { verdict: "unknown", reason: null };
    return youtubeLiveness(html);
  } catch {
    return { verdict: "unknown", reason: null };
  }
}

// ─── Step 3: Update last_checked_at ─────────────────────────────────────

async function updateCamStatus(cam, isAlive, options) {
  // Auto-disable a cam after DISABLE_THRESHOLD consecutive failures; auto-recover
  // it once it comes back alive. Manually disabled cams are never touched.
  const { body, transition } = computeCamUpdate(cam, isAlive, options);

  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/cams?id=eq.${cam.id}`,
    {
      method: "PATCH",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(body),
    }
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`cam status update failed (${resp.status}): ${text}`);
  }
  return transition;
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  assertRunnable();
  console.log("[cam-health] Starting cam health check...\n");

  const cams = await fetchAllCams();
  console.log(`[cam-health] Found ${cams.length} cams in database\n`);

  // Off-season guard: a southern-hemisphere cam with no stream in November is
  // closed for the summer, not broken. If the latitudes cannot be read the
  // guard is off and every resort counts as in season.
  let latByResort = new Map();
  try {
    latByResort = await fetchResortLatitudes();
  } catch (err) {
    console.error(`[cam-health] WARN off-season guard disabled: ${err.message}`);
  }
  const now = new Date();
  let offSeasonDark = 0;
  const reasons = { youtubeDead: 0, staleImage: 0, notImage: 0, livenessUnknown: 0 };

  const results = { working: [], dead: [] };
  const deadDetail = new Map(); // cam.id → why, for the summary
  const byType = {};
  let disabledCount = 0;
  let recoveredCount = 0;
  let tlsCount = 0;

  for (const cam of cams) {
    const type = cam.embed_type || "unknown";
    if (!byType[type]) byType[type] = { working: 0, dead: 0 };

    const check = await checkCam(cam);

    if (check.ok) {
      results.working.push(cam);
      byType[type].working++;
      console.log(`  OK   [${type}] ${cam.name} (${check.status})${check.livenessUnknown ? " — liveness unknown, judged on HTTP status only" : ""}`);
    } else {
      results.dead.push(cam);
      byType[type].dead++;
      if (check.errorKind === "tls") tlsCount++;
      const detail = (check.error || `HTTP ${check.status}`) + (check.livenessUnknown ? " (liveness unknown)" : "");
      deadDetail.set(cam.id, detail);
      console.log(`  DEAD [${type}] ${cam.name} — ${detail}`);
    }

    if (check.livenessUnknown) reasons.livenessUnknown++;
    if (!check.ok) {
      if (check.youtubeDead) reasons.youtubeDead++;
      if (check.staleImage) reasons.staleImage++;
      if (check.notImage) reasons.notImage++;
    }

    // Seasonal darkness (no ipcamlive stream, a still that stopped updating)
    // at an off-season resort is expected: record the check but do not count
    // it toward the auto-disable threshold. See countsTowardDisable().
    const countFailure = countsTowardDisable(check, latByResort.get(cam.resort_id), now);
    if (!check.ok && !countFailure) {
      offSeasonDark++;
      console.log(`  ....  off-season, not counted toward auto-disable: ${cam.name}`);
    }

    // Update last_checked_at, tally consecutive failures, and auto-disable/recover
    try {
      const transition = await updateCamStatus(cam, check.ok, { countFailure });
      if (transition === "disabled") {
        disabledCount++;
        console.log(`  ⛔  Auto-disabled ${cam.name} after ${DISABLE_THRESHOLD} consecutive failures`);
      } else if (transition === "recovered") {
        recoveredCount++;
        console.log(`  ✅  Auto-recovered ${cam.name}`);
      }
    } catch (err) {
      console.error(`  WARN Could not update cam status for ${cam.name}: ${err.message}`);
    }

    // Rate-limit courtesy. A check that loaded a YouTube watch page waits
    // longer: a few hundred of those a run, about one a second.
    await sleep(check.youtubeProbed ? YOUTUBE_PACE_MS : 150);
  }

  // ─── Summary ────────────────────────────────────────────────────────
  console.log("\n─── Summary ───────────────────────────────────────────");
  console.log(`Total cams:  ${cams.length}`);
  console.log(`Working:     ${results.working.length}`);
  console.log(`Dead:        ${results.dead.length}`);
  console.log("");

  for (const [type, counts] of Object.entries(byType)) {
    console.log(`  ${type}: ${counts.working} working, ${counts.dead} dead`);
  }

  if (results.dead.length > 0) {
    console.log("\n─── Dead Cams ─────────────────────────────────────────");
    for (const cam of results.dead) {
      const url = cam.youtube_id
        ? `youtube:${cam.youtube_id}`
        : cam.embed_url || "(no url)";
      console.log(`  ${cam.name} — ${url} (${deadDetail.get(cam.id) ?? "unknown"})`);
    }
  }

  console.log(
    `\n[cam-health] Done. ${results.working.length}/${cams.length} cams healthy.`
  );
  console.log(
    `[cam-health] ${disabledCount} disabled this run, ${recoveredCount} recovered, ${tlsCount} failing TLS, ${offSeasonDark} off-season with no stream (not counted)`
  );
  console.log(
    `[cam-health] Dead by rule: ${reasons.youtubeDead} YouTube stream ended/unavailable, ${reasons.staleImage} image frame older than ${IMAGE_STALE_DAYS} days, ${reasons.notImage} image URL not serving an image; ${reasons.livenessUnknown} YouTube liveness unknown (HTTP status only)`
  );
}

// Only run main() when this file is executed directly (e.g.
// `node scripts/cam-health-check.mjs`), not when it's imported as a
// module (e.g. by scripts/cam-health-check.test.mjs) — an import must
// never have the side effect of hitting the live database.
const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((err) => {
    console.error("[cam-health] Fatal:", err.message);
    process.exit(1);
  });
}
