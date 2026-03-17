#!/usr/bin/env node

/**
 * snotel-sync.mjs
 * ────────────────
 * Fetches snow data from the NRCS SNOTEL API for all resorts that have a
 * snotel_station_id, then upserts into the snow_reports table.
 *
 * Usage:
 *   node scripts/snotel-sync.mjs
 *
 * Reads:  .env.local (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 * Writes: Supabase snow_reports table
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ─── Load .env.local manually (same pattern as send.mjs) ──────────────────

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

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Missing env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"
  );
  process.exit(1);
}

const SNOTEL_BASE = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1";

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Format Date as YYYY-MM-DD */
function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

/** Pause for ms (rate-limit courtesy) */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Step 1: Fetch resorts with snotel_station_id ──────────────────────────

async function fetchResortsWithSnotel() {
  const url = `${SUPABASE_URL}/rest/v1/resorts?select=id,name,state,snotel_station_id&is_active=eq.true&snotel_station_id=not.is.null`;
  const resp = await fetch(url, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
  });
  if (!resp.ok) throw new Error(`Supabase resorts fetch failed: ${resp.status}`);
  return resp.json();
}

// ─── Step 2: Fetch SNOTEL data for a station ───────────────────────────────

async function fetchSnotelData(stationId, stateCode) {
  const now = new Date();
  const twoDaysAgo = new Date(now);
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

  const triplet = `${stationId}:${stateCode}:SNTL`;
  const params = new URLSearchParams({
    stationTriplets: triplet,
    elements: "SNWD,PREC",
    duration: "DAILY",
    getFlags: "false",
    beginDate: fmtDate(twoDaysAgo),
    endDate: fmtDate(now),
  });

  const resp = await fetch(`${SNOTEL_BASE}/data?${params}`);
  if (!resp.ok) {
    throw new Error(`SNOTEL API error ${resp.status} for ${triplet}`);
  }

  const json = await resp.json();
  if (!json.length || !json[0].data || !json[0].data.length) {
    return null; // station returned no data
  }

  const stationData = json[0].data;
  let snwdValues = [];
  let precValues = [];

  for (const elem of stationData) {
    const code = elem.stationElement.elementCode;
    const vals = (elem.values || []).filter((v) => v.value !== null && v.value !== -99);
    if (code === "SNWD") snwdValues = vals;
    if (code === "PREC") precValues = vals;
  }

  // base_depth = latest SNWD reading
  const baseDepth =
    snwdValues.length > 0 ? Math.round(snwdValues[snwdValues.length - 1].value) : null;

  // new_snow_24h = positive SNWD delta over last day (or PREC delta * 10 as fallback)
  let newSnow24h = null;
  if (snwdValues.length >= 2) {
    const delta = snwdValues[snwdValues.length - 1].value - snwdValues[snwdValues.length - 2].value;
    newSnow24h = delta > 0 ? Math.round(delta) : 0;
  } else if (precValues.length >= 2) {
    const delta =
      precValues[precValues.length - 1].value - precValues[precValues.length - 2].value;
    newSnow24h = delta > 0 ? Math.round(delta * 10) : 0;
  }

  // new_snow_48h = positive SNWD delta over last 2 days
  let newSnow48h = null;
  if (snwdValues.length >= 3) {
    const delta = snwdValues[snwdValues.length - 1].value - snwdValues[0].value;
    newSnow48h = delta > 0 ? Math.round(delta) : 0;
  } else if (precValues.length >= 3) {
    const delta = precValues[precValues.length - 1].value - precValues[0].value;
    newSnow48h = delta > 0 ? Math.round(delta * 10) : 0;
  }

  return { baseDepth, newSnow24h, newSnow48h };
}

// ─── Step 3: Upsert snow report ────────────────────────────────────────────

async function upsertSnowReport(resortId, data) {
  const body = {
    resort_id: resortId,
    base_depth: data.baseDepth,
    new_snow_24h: data.newSnow24h,
    new_snow_48h: data.newSnow48h,
    source: "snotel",
    updated_at: new Date().toISOString(),
  };

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/snow_reports`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Supabase upsert failed (${resp.status}): ${text}`);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("[snotel-sync] Starting SNOTEL data sync...");

  const resorts = await fetchResortsWithSnotel();
  console.log(`[snotel-sync] Found ${resorts.length} resorts with SNOTEL station IDs`);

  let success = 0;
  let failed = 0;
  let noData = 0;

  for (const resort of resorts) {
    try {
      const data = await fetchSnotelData(resort.snotel_station_id, resort.state);

      if (!data) {
        console.log(`  SKIP ${resort.name} (${resort.snotel_station_id}:${resort.state}:SNTL) - no data returned`);
        noData++;
        continue;
      }

      await upsertSnowReport(resort.id, data);
      console.log(
        `  OK   ${resort.name} — base: ${data.baseDepth ?? "?"}in, 24h: ${data.newSnow24h ?? "?"}in, 48h: ${data.newSnow48h ?? "?"}in`
      );
      success++;
    } catch (err) {
      console.error(`  FAIL ${resort.name} — ${err.message}`);
      failed++;
    }

    // Be polite to the SNOTEL API
    await sleep(200);
  }

  console.log(
    `\n[snotel-sync] Done. ${success} synced, ${noData} no data, ${failed} failed (of ${resorts.length} total)`
  );
}

main().catch((err) => {
  console.error("[snotel-sync] Fatal:", err.message);
  process.exit(1);
});
