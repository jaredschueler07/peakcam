#!/usr/bin/env tsx

/**
 * snotel-backfill.ts
 * ──────────────────
 * Pulls ten water years of daily SNOTEL values (snow depth, SWE,
 * precipitation accumulation, temperatures) per station from the NRCS AWDB
 * API, runs the same quality control as snotel-sync day by day
 * (lib/snow-history.ts qcSeries over lib/snow-quality.ts validateReading),
 * derives daily new snow, and upserts into `snowpack_daily` (migration 005,
 * `new_snow_in` from migration 030). Run once; re-running is safe (the
 * upsert merges on the (resort_id, date) key).
 *
 * Usage:
 *   npx tsx scripts/snotel-backfill.ts                 # every active resort with a station
 *   npx tsx scripts/snotel-backfill.ts --dry-run       # read AWDB, write nothing, print counts
 *   npx tsx scripts/snotel-backfill.ts --resort alta   # one resort (its station)
 *   npx tsx scripts/snotel-backfill.ts --years 5       # water years back (default 10)
 *
 * Reads:  .env.local (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 * Writes: snowpack_daily
 *
 * Volume: one AWDB call per distinct station (72 on 2026-10-19, ~22k values
 * each) and one PostgREST upsert per 500 rows per resort (89 resorts ×
 * ~3,650 rows ≈ 650 requests). About five minutes end to end.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { waterYear } from "../lib/snow-quality.js";
import { qcSeries, type QcDay, type RawDay } from "../lib/snow-history.js";

// ─── Load .env.local manually (same pattern as snotel-sync) ────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

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

// ─── Args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
function argValue(flag: string): string | null {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
}
const onlyResort = argValue("--resort");
const years = Math.max(1, Math.min(40, Number(argValue("--years") ?? 10)));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const supaHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

const SNOTEL_BASE = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1";
const UPSERT_BATCH = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── Resorts ───────────────────────────────────────────────────────────────

interface ResortRow {
  id: string;
  slug: string;
  name: string;
  state: string;
  snotel_station_id: string;
}

async function fetchResorts(): Promise<ResortRow[]> {
  let url = `${SUPABASE_URL}/rest/v1/resorts?select=id,slug,name,state,snotel_station_id&is_active=eq.true&snotel_station_id=not.is.null&order=slug`;
  if (onlyResort) url += `&slug=eq.${encodeURIComponent(onlyResort)}`;
  const resp = await fetch(url, { headers: supaHeaders });
  if (!resp.ok) throw new Error(`Supabase resorts fetch failed: ${resp.status}`);
  return resp.json();
}

// ─── AWDB ──────────────────────────────────────────────────────────────────

interface AwdbValue {
  date: string;
  value: number | null;
}

interface AwdbElement {
  stationElement: { elementCode: string };
  values: AwdbValue[];
}

export function tripletFor(stationId: string, stateCode: string): string {
  return stationId.includes(":") ? stationId : `${stationId}:${stateCode}:SNTL`;
}

/** Parse one AWDB `data` response into daily raw readings, one per calendar day. */
export function parseAwdbDaily(elements: readonly AwdbElement[]): RawDay[] {
  const byCode: Record<string, Map<string, number>> = {};
  for (const elem of elements) {
    const code = elem.stationElement.elementCode;
    const map = new Map<string, number>();
    for (const v of elem.values ?? []) {
      if (v.value == null || v.value === -99) continue;
      map.set(v.date.slice(0, 10), v.value);
    }
    byCode[code] = map;
  }
  const dates = new Set<string>();
  for (const map of Object.values(byCode)) for (const d of map.keys()) dates.add(d);
  const get = (code: string, date: string): number | null => byCode[code]?.get(date) ?? null;
  return [...dates].sort().map((date) => ({
    date,
    snowDepthIn: get("SNWD", date),
    sweIn: get("WTEQ", date),
    precipAccumIn: get("PREC", date),
    tempObsF: get("TOBS", date),
    tempMaxF: get("TMAX", date),
    tempMinF: get("TMIN", date),
  }));
}

async function fetchStationDaily(triplet: string, beginDate: string, endDate: string): Promise<RawDay[]> {
  const params = new URLSearchParams({
    stationTriplets: triplet,
    elements: "SNWD,WTEQ,PREC,TOBS,TMAX,TMIN",
    duration: "DAILY",
    getFlags: "false",
    beginDate,
    endDate,
  });
  const resp = await fetch(`${SNOTEL_BASE}/data?${params}`);
  if (!resp.ok) throw new Error(`SNOTEL API error ${resp.status} for ${triplet}`);
  const json = (await resp.json()) as Array<{ data?: AwdbElement[] }>;
  if (!json.length || !json[0].data?.length) return [];
  return parseAwdbDaily(json[0].data);
}

// ─── Upsert ────────────────────────────────────────────────────────────────

function toRow(resortId: string, stationId: string, d: QcDay) {
  return {
    resort_id: resortId,
    station_id: stationId,
    date: d.date,
    snow_depth_in: d.snowDepthIn,
    swe_in: d.sweIn,
    precip_accum_in: d.precipAccumIn,
    temp_obs_f: d.tempObsF,
    temp_max_f: d.tempMaxF,
    temp_min_f: d.tempMinF,
    qc_flag: d.qcFlag,
    new_snow_in: d.newSnowIn,
  };
}

async function upsertRows(rows: ReturnType<typeof toRow>[]): Promise<number> {
  let requests = 0;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH);
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/snowpack_daily`, {
      method: "POST",
      headers: { ...supaHeaders, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(batch),
    });
    requests++;
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`snowpack_daily upsert failed (${resp.status}): ${text}`);
    }
  }
  return requests;
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("Missing env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }
  const today = new Date();
  const currentWy = waterYear(today);
  const beginDate = `${currentWy - years}-10-01`;
  const endDate = fmtDate(today);
  console.log(`[snotel-backfill] ${dryRun ? "DRY RUN — " : ""}${years} water years (${beginDate} → ${endDate})${onlyResort ? ` for ${onlyResort}` : ""}\n`);

  const resorts = await fetchResorts();
  if (!resorts.length) {
    console.error(`[snotel-backfill] No active resort with a station${onlyResort ? ` matches --resort ${onlyResort}` : ""}.`);
    process.exit(1);
  }

  // One AWDB fetch per station; several resorts may share one.
  const byStation = new Map<string, ResortRow[]>();
  for (const r of resorts) {
    const triplet = tripletFor(r.snotel_station_id, r.state);
    byStation.set(triplet, [...(byStation.get(triplet) ?? []), r]);
  }
  console.log(`[snotel-backfill] ${resorts.length} resorts, ${byStation.size} distinct stations\n`);

  let awdbCalls = 0;
  let rowsWritten = 0;
  let requests = 0;
  let failed = 0;
  const flags = { valid: 0, suspect: 0, missing: 0 };

  for (const [triplet, group] of byStation) {
    const label = `${triplet} (${group.map((r) => r.slug).join(", ")})`;
    try {
      const raw = await fetchStationDaily(triplet, beginDate, endDate);
      awdbCalls++;
      if (!raw.length) {
        console.log(`  SKIP ${label} — AWDB returned no daily values`);
        continue;
      }
      const days = qcSeries(raw);
      for (const d of days) flags[d.qcFlag === "suspect" ? "suspect" : d.qcFlag === "missing" ? "missing" : "valid"]++;
      const withSnow = days.filter((d) => d.newSnowIn != null && d.newSnowIn > 0).length;
      console.log(`  ${dryRun ? "READ" : "OK  "} ${label} — ${days.length} days ${days[0].date} → ${days[days.length - 1].date}, ${withSnow} days with new snow`);
      if (dryRun) continue;
      for (const resort of group) {
        const rows = days.map((d) => toRow(resort.id, resort.snotel_station_id, d));
        requests += await upsertRows(rows);
        rowsWritten += rows.length;
      }
    } catch (err) {
      failed++;
      console.error(`  FAIL ${label} — ${err instanceof Error ? err.message : String(err)}`);
    }
    // AWDB is a shared public service; one call a second is plenty.
    await sleep(1000);
  }

  console.log(
    `\n[snotel-backfill] Done. ${awdbCalls} AWDB calls, ${rowsWritten} rows upserted in ${requests} requests, ${failed} stations failed. ` +
      `QC: ${flags.valid} valid, ${flags.suspect} suspect, ${flags.missing} carried forward.${dryRun ? " (dry run: nothing written)" : ""}`,
  );
  if (!dryRun) console.log("[snotel-backfill] Next: npm run seed-normals (cumulative and monthly normals read the same AWDB record, not this table).");
}

// Only run when executed directly; scripts/snotel-backfill.test.ts imports the parsers.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("[snotel-backfill] Fatal:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
