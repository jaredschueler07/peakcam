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
 * Writes: Supabase cams table (last_checked_at)
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

/**
 * Pure state transition for one cam's health check result.
 * Returns { body, transition } — body is the PATCH payload,
 * transition is null | "disabled" | "recovered" (for logging).
 * Never touches manually-disabled cams (is_active=false && !auto_disabled).
 */
export function computeCamUpdate(cam, isAlive) {
  const body = { last_checked_at: new Date().toISOString() };
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

// ─── Step 1: Fetch all cams ─────────────────────────────────────────────

async function fetchAllCams() {
  const url = `${SUPABASE_URL}/rest/v1/cams?select=id,name,resort_id,embed_type,embed_url,youtube_id,is_active,auto_disabled,consecutive_failures&order=id`;
  // Use the service role key (bypasses RLS) rather than the anon key: the
  // "Public cams read" RLS policy restricts anon reads to is_active=true,
  // which would hide auto-disabled cams from every future run and make
  // auto-recovery unreachable in practice.
  const resp = await fetch(url, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
  });
  if (!resp.ok) throw new Error(`Supabase cams fetch failed: ${resp.status}`);
  return resp.json();
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
  // YouTube — oEmbed check
  if (cam.embed_type === "youtube" && cam.youtube_id) {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://youtube.com/watch?v=${cam.youtube_id}&format=json`;
    try {
      const resp = await fetch(oembedUrl, {
        headers: HEADERS,
        signal: AbortSignal.timeout(timeout),
      });
      return { ok: resp.ok, status: resp.status };
    } catch (err) {
      return failureFromError(err);
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
      // Consume body to prevent memory leak
      await resp.arrayBuffer();
      const isImage = contentType.startsWith("image/") || contentLength > 1000;
      return {
        ok: resp.ok && isImage,
        status: resp.status,
        contentLength,
        lastModified,
        contentType,
      };
    } catch (err) {
      // Includes every TLS/certificate failure: fetch never returns a Response
      // for those, so without this they would have been logged as a bare
      // "fetch failed" and retried as if the connection were merely flaky.
      return failureFromError(err);
    }
  }

  // iframe / link — GET request with proper headers
  try {
    const resp = await fetch(cam.embed_url, {
      method: "GET",
      headers: HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(timeout),
    });
    // Consume body
    await resp.text();
    const ok = resp.status >= 200 && resp.status < 400;
    return { ok, status: resp.status };
  } catch (err) {
    return failureFromError(err);
  }
}

// ─── Step 3: Update last_checked_at ─────────────────────────────────────

async function updateCamStatus(cam, isAlive) {
  // Auto-disable a cam after DISABLE_THRESHOLD consecutive failures; auto-recover
  // it once it comes back alive. Manually disabled cams are never touched.
  const { body, transition } = computeCamUpdate(cam, isAlive);

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
      console.log(`  OK   [${type}] ${cam.name} (${check.status})`);
    } else {
      results.dead.push(cam);
      byType[type].dead++;
      if (check.errorKind === "tls") tlsCount++;
      const detail = check.error || `HTTP ${check.status}`;
      deadDetail.set(cam.id, detail);
      console.log(`  DEAD [${type}] ${cam.name} — ${detail}`);
    }

    // Update last_checked_at, tally consecutive failures, and auto-disable/recover
    try {
      const transition = await updateCamStatus(cam, check.ok);
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

    // Rate-limit courtesy
    await sleep(150);
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
    `[cam-health] ${disabledCount} disabled this run, ${recoveredCount} recovered, ${tlsCount} failing TLS`
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
