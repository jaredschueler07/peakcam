#!/usr/bin/env npx tsx

/**
 * seed-snotel-normals.ts
 * ──────────────────────
 * Seeds the `snotel_normals` table with 30-year (1991-2020) median SWE and
 * snow depth by day-of-water-year. Run once at setup, then annually.
 *
 * Usage:
 *   npx tsx scripts/seed-snotel-normals.ts
 *
 * Reads:  .env.local (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 * Writes: Supabase snotel_normals table
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dayOfWaterYear } from "../lib/snow-quality.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ─── Load .env.local manually (same pattern as snotel-sync) ────────────────

function loadEnv(filePath: string): void {
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

const supaHeaders: Record<string, string> = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

// ─── Stats Helpers ─────────────────────────────────────────────────────────

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  const frac = idx - lower;
  return sorted[lower] * (1 - frac) + sorted[upper] * frac;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Step 1: Fetch resorts with snotel_station_id ──────────────────────────

interface ResortRow {
  snotel_station_id: string;
  state: string;
  name: string;
}

async function fetchResortsWithSnotel(): Promise<ResortRow[]> {
  const url = `${SUPABASE_URL}/rest/v1/resorts?select=name,state,snotel_station_id&snotel_station_id=not.is.null`;
  const resp = await fetch(url, {
    headers: {
      apikey: SERVICE_KEY!,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
  });
  if (!resp.ok) throw new Error(`Supabase resorts fetch failed: ${resp.status}`);
  return resp.json();
}

// ─── Step 2: Fetch 30-year period-of-record from NRCS AWDB ────────────────

interface SnotelValue {
  date: string;
  value: number | null;
}

interface SnotelElement {
  stationElement: { elementCode: string };
  values: SnotelValue[];
}

interface SnotelStationResponse {
  data: SnotelElement[];
}

async function fetchPeriodOfRecord(
  stationId: string,
  stateCode: string
): Promise<{ wteqByDay: Map<number, number[]>; snwdByDay: Map<number, number[]> }> {
  // Use the full triplet if it's already one, otherwise append defaults
  const triplet = stationId.includes(":") ? stationId : `${stationId}:${stateCode}:SNTL`;
  const params = new URLSearchParams({
    stationTriplets: triplet,
    elements: "WTEQ,SNWD",
    duration: "DAILY",
    getFlags: "false",
    beginDate: "1991-10-01",
    endDate: "2020-09-30",
  });

  const resp = await fetch(`${SNOTEL_BASE}/data?${params}`);
  if (!resp.ok) {
    throw new Error(`SNOTEL API error ${resp.status} for ${triplet}`);
  }

  const json: SnotelStationResponse[] = await resp.json();
  if (!json.length || !json[0].data || !json[0].data.length) {
    throw new Error(`No period-of-record data returned for ${triplet}`);
  }

  const wteqByDay = new Map<number, number[]>();
  const snwdByDay = new Map<number, number[]>();

  for (const elem of json[0].data) {
    const code = elem.stationElement.elementCode;
    const targetMap = code === "WTEQ" ? wteqByDay : code === "SNWD" ? snwdByDay : null;
    if (!targetMap) continue;

    for (const v of elem.values) {
      if (v.value === null || v.value === -99) continue;
      const date = new Date(v.date);
      const doy = dayOfWaterYear(date);
      const existing = targetMap.get(doy);
      if (existing) {
        existing.push(v.value);
      } else {
        targetMap.set(doy, [v.value]);
      }
    }
  }

  return { wteqByDay, snwdByDay };
}

// ─── Step 3: Compute normals and write to Supabase ─────────────────────────

interface NormalRow {
  station_id: string;
  day_of_water_year: number;
  median_swe: number | null;
  p10_swe: number | null;
  p90_swe: number | null;
  median_depth: number | null;
  p10_depth: number | null;
  p90_depth: number | null;
}

async function writeNormals(
  stationId: string,
  wteqByDay: Map<number, number[]>,
  snwdByDay: Map<number, number[]>
): Promise<number> {
  // Delete existing rows for this station (idempotent)
  const delResp = await fetch(
    `${SUPABASE_URL}/rest/v1/snotel_normals?station_id=eq.${stationId}`,
    { method: "DELETE", headers: supaHeaders }
  );
  if (!delResp.ok) {
    const text = await delResp.text();
    throw new Error(`Supabase DELETE failed (${delResp.status}): ${text}`);
  }

  // Build rows for all 366 possible days
  const rows: NormalRow[] = [];
  for (let doy = 1; doy <= 366; doy++) {
    const sweArr = wteqByDay.get(doy);
    const depthArr = snwdByDay.get(doy);

    rows.push({
      station_id: stationId,
      day_of_water_year: doy,
      median_swe: sweArr && sweArr.length >= 5 ? Math.round(median(sweArr) * 10) / 10 : null,
      p10_swe: sweArr && sweArr.length >= 5 ? Math.round(percentile(sweArr, 10) * 10) / 10 : null,
      p90_swe: sweArr && sweArr.length >= 5 ? Math.round(percentile(sweArr, 90) * 10) / 10 : null,
      median_depth: depthArr && depthArr.length >= 5 ? Math.round(median(depthArr)) : null,
      p10_depth: depthArr && depthArr.length >= 5 ? Math.round(percentile(depthArr, 10)) : null,
      p90_depth: depthArr && depthArr.length >= 5 ? Math.round(percentile(depthArr, 90)) : null,
    });
  }

  // Batch insert
  const insResp = await fetch(`${SUPABASE_URL}/rest/v1/snotel_normals`, {
    method: "POST",
    headers: supaHeaders,
    body: JSON.stringify(rows),
  });
  if (!insResp.ok) {
    const text = await insResp.text();
    throw new Error(`Supabase INSERT failed (${insResp.status}): ${text}`);
  }

  return rows.length;
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("[seed-normals] Seeding SNOTEL 30-year normals (1991-2020)...");

  const resorts = await fetchResortsWithSnotel();
  console.log(`[seed-normals] Found ${resorts.length} resorts with SNOTEL station IDs`);

  // Dedupe stations (multiple resorts may share a station)
  const stationMap = new Map<string, { stateCode: string; resortNames: string[] }>();
  for (const r of resorts) {
    const existing = stationMap.get(r.snotel_station_id);
    if (existing) {
      existing.resortNames.push(r.name);
    } else {
      stationMap.set(r.snotel_station_id, {
        stateCode: r.state,
        resortNames: [r.name],
      });
    }
  }

  const stations = Array.from(stationMap.entries());
  console.log(`[seed-normals] ${stations.length} unique stations to process\n`);

  let success = 0;
  let failed = 0;

  for (const [stationId, info] of stations) {
    const label = `${stationId}:${info.stateCode}:SNTL (${info.resortNames.join(", ")})`;
    try {
      console.log(`  Fetching ${label}...`);
      const { wteqByDay, snwdByDay } = await fetchPeriodOfRecord(stationId, info.stateCode);

      const sweDays = wteqByDay.size;
      const depthDays = snwdByDay.size;
      console.log(`    Got data: ${sweDays} SWE days, ${depthDays} depth days`);

      const rowCount = await writeNormals(stationId, wteqByDay, snwdByDay);
      console.log(`    Inserted ${rowCount} rows`);
      success++;
    } catch (err) {
      console.error(`  FAIL ${label} -- ${(err as Error).message}`);
      failed++;
    }

    // Rate limit: 1000ms between stations (large API responses)
    await sleep(1000);
  }

  console.log(
    `\n[seed-normals] Done. ${success} stations seeded, ${failed} failed (of ${stations.length} total)`
  );
}

main().catch((err) => {
  console.error("[seed-normals] Fatal:", (err as Error).message);
  process.exit(1);
});
