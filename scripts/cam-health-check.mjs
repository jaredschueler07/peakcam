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
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error(
    "Missing env vars. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY in .env.local"
  );
  process.exit(1);
}

// ─── Helpers ────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
  const failures = (cam.consecutive_failures ?? 0) + 1;
  body.consecutive_failures = failures;
  if (manuallyDisabled) return { body: { last_checked_at: body.last_checked_at }, transition: null };
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
      // Retry on transient failures (timeout, 500, 502, 503, 504)
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
      return { ok: false, status: 0, error: err.message };
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
      return { ok: false, status: 0, error: err.message };
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
    return { ok: false, status: 0, error: err.message };
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
  console.log("[cam-health] Starting cam health check...\n");

  const cams = await fetchAllCams();
  console.log(`[cam-health] Found ${cams.length} cams in database\n`);

  const results = { working: [], dead: [] };
  const byType = {};
  let disabledCount = 0;
  let recoveredCount = 0;

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
      const detail = check.error || `HTTP ${check.status}`;
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
      console.log(`  ${cam.name} — ${url}`);
    }
  }

  console.log(
    `\n[cam-health] Done. ${results.working.length}/${cams.length} cams healthy.`
  );
  console.log(`[cam-health] ${disabledCount} disabled this run, ${recoveredCount} recovered`);
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
