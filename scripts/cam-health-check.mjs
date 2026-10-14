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
import { fileURLToPath } from "node:url";

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

// ─── Step 1: Fetch all cams ─────────────────────────────────────────────

async function fetchAllCams() {
  const url = `${SUPABASE_URL}/rest/v1/cams?select=id,name,resort_id,embed_type,embed_url,youtube_id,is_active&order=id`;
  const resp = await fetch(url, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
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

async function updateCamStatus(camId, isAlive) {
  // Only update last_checked_at — don't set is_active=false on a single failure.
  // The cam should stay active until manually reviewed or consecutive failures threshold.
  const body = { last_checked_at: new Date().toISOString() };

  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/cams?id=eq.${camId}`,
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
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log("[cam-health] Starting cam health check...\n");

  const cams = await fetchAllCams();
  console.log(`[cam-health] Found ${cams.length} cams in database\n`);

  const results = { working: [], dead: [] };
  const byType = {};

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

    // Update last_checked_at and set is_active=false for dead cams
    try {
      await updateCamStatus(cam.id, check.ok);
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
}

main().catch((err) => {
  console.error("[cam-health] Fatal:", err.message);
  process.exit(1);
});
