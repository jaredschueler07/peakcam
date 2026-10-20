#!/usr/bin/env npx tsx

/**
 * seed-snotel-normals.ts
 * ──────────────────────
 * Seeds the per-station normals from each station's NRCS period of record:
 *
 *   snotel_normals          one row per day of the water year —
 *     median/p10/p90 SWE and depth over the fixed 1991–2020 WMO normal
 *     (what "% of normal" on the site compares against), plus the
 *     cumulative new-snow normal (mean/p25/p75) over the 30 most recent
 *     complete winters and its 10-winter "recent decade" mean (migration 030)
 *   snotel_monthly_normals  one row per month and window ('30yr' | '10yr'):
 *     average monthly snowfall, snow days, depth, biggest storm, years tracked
 *
 * Daily new snow is derived from depth the same way snotel-sync and the
 * backfill derive it (lib/snow-history.ts). Run once at setup, then
 * annually in October once the previous water year is complete.
 *
 * Usage:
 *   npx tsx scripts/seed-snotel-normals.ts                      # every station the catalogue references
 *   npx tsx scripts/seed-snotel-normals.ts --dry-run            # read AWDB, write nothing
 *   npx tsx scripts/seed-snotel-normals.ts --station 531:CO:SNTL
 *
 * Reads:  .env.local (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 * Writes: snotel_normals, snotel_monthly_normals
 *
 * Volume: one AWDB call per station (72 on 2026-10-19; 35 years of daily
 * SNWD + WTEQ, ~1 MB each) and three PostgREST requests per station.
 * About three minutes end to end.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dayOfWaterYear, waterYear } from "../lib/snow-quality.js";
import {
  NORMAL_WINDOW_YEARS,
  cumulativeNormal,
  deriveNewSnow,
  groupBySeason,
  monthlyClimatology,
  type DailyRow,
  type NormalWindow,
} from "../lib/snow-history.js";

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

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const onlyStation = (() => {
  const i = args.indexOf("--station");
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
})();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const SNOTEL_BASE = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1";

/** The WMO normal period the site's "% of normal" uses. */
const WMO_NORMAL_BEGIN = "1991-10-01";
const WMO_NORMAL_END = "2020-09-30";
/** How far back the record is read: enough for the 30-winter window plus the WMO period. */
const RECORD_BEGIN = "1991-10-01";

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
  const url = `${SUPABASE_URL}/rest/v1/resorts?select=name,state,snotel_station_id&is_active=eq.true&snotel_station_id=not.is.null`;
  const resp = await fetch(url, {
    headers: supaHeaders,
  });
  if (!resp.ok) throw new Error(`Supabase resorts fetch failed: ${resp.status}`);
  return resp.json();
}

// ─── Step 2: Fetch the period of record from NRCS AWDB ────────────────────

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

export interface StationRecord {
  /** WMO-period SWE values by day of water year. */
  wteqByDay: Map<number, number[]>;
  /** WMO-period depth values by day of water year. */
  snwdByDay: Map<number, number[]>;
  /** The whole depth/SWE record as daily rows, for the cumulative and monthly normals. */
  daily: DailyRow[];
}

async function fetchPeriodOfRecord(
  stationId: string,
  stateCode: string,
  endDate: string,
): Promise<StationRecord> {
  // Use the full triplet if it's already one, otherwise append defaults
  const triplet = stationId.includes(":") ? stationId : `${stationId}:${stateCode}:SNTL`;
  const params = new URLSearchParams({
    stationTriplets: triplet,
    elements: "WTEQ,SNWD",
    duration: "DAILY",
    getFlags: "false",
    beginDate: RECORD_BEGIN,
    endDate,
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
  const depthByDate = new Map<string, number>();
  const sweByDate = new Map<string, number>();

  for (const elem of json[0].data) {
    const code = elem.stationElement.elementCode;
    const targetMap = code === "WTEQ" ? wteqByDay : code === "SNWD" ? snwdByDay : null;
    if (!targetMap) continue;

    for (const v of elem.values) {
      if (v.value === null || v.value === -99) continue;
      const day = v.date.slice(0, 10);
      (code === "WTEQ" ? sweByDate : depthByDate).set(day, v.value);
      if (day < WMO_NORMAL_BEGIN || day > WMO_NORMAL_END) continue;
      const doy = dayOfWaterYear(new Date(v.date));
      const existing = targetMap.get(doy);
      if (existing) {
        existing.push(v.value);
      } else {
        targetMap.set(doy, [v.value]);
      }
    }
  }

  const dates = new Set<string>([...depthByDate.keys(), ...sweByDate.keys()]);
  const daily: DailyRow[] = deriveNewSnow(
    [...dates].sort().map((date) => ({
      date,
      snowDepthIn: depthByDate.get(date) ?? null,
      sweIn: sweByDate.get(date) ?? null,
      newSnowIn: null,
      qcFlag: "valid",
    })),
  );

  return { wteqByDay, snwdByDay, daily };
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
  cum_snow_mean_in: number | null;
  cum_snow_p25_in: number | null;
  cum_snow_p75_in: number | null;
  cum_snow_years: number | null;
  cum_snow_recent_mean_in: number | null;
  cum_snow_recent_years: number | null;
}

interface MonthlyRow {
  station_id: string;
  month: number;
  window: NormalWindow;
  avg_snowfall_in: number | null;
  avg_snow_days: number | null;
  avg_depth_in: number | null;
  max_storm_in: number | null;
  max_storm_start: string | null;
  max_storm_end: string | null;
  years_tracked: number;
}

interface ComputedNormals {
  rows: NormalRow[];
  monthly: MonthlyRow[];
  thirtyYears: number;
  tenYears: number;
}

/** Pure: everything written for one station, from its record and the first incomplete water year. */
export function computeStationNormals(stationId: string, record: StationRecord, currentWaterYear: number): ComputedNormals {
  const seasons = groupBySeason(record.daily, "north");
  const thirty = cumulativeNormal(seasons, "30yr", currentWaterYear);
  const ten = cumulativeNormal(seasons, "10yr", currentWaterYear);
  const thirtyByDay = new Map(thirty.points.map((p) => [p.dayOfWaterYear, p]));
  const tenByDay = new Map(ten.points.map((p) => [p.dayOfWaterYear, p]));

  const rows: NormalRow[] = [];
  for (let doy = 1; doy <= 366; doy++) {
    const sweArr = record.wteqByDay.get(doy);
    const depthArr = record.snwdByDay.get(doy);
    const t = thirtyByDay.get(doy);
    const r = tenByDay.get(doy);
    rows.push({
      station_id: stationId,
      day_of_water_year: doy,
      median_swe: sweArr && sweArr.length >= 5 ? Math.round(median(sweArr) * 10) / 10 : null,
      p10_swe: sweArr && sweArr.length >= 5 ? Math.round(percentile(sweArr, 10) * 10) / 10 : null,
      p90_swe: sweArr && sweArr.length >= 5 ? Math.round(percentile(sweArr, 90) * 10) / 10 : null,
      median_depth: depthArr && depthArr.length >= 5 ? Math.round(median(depthArr)) : null,
      p10_depth: depthArr && depthArr.length >= 5 ? Math.round(percentile(depthArr, 10)) : null,
      p90_depth: depthArr && depthArr.length >= 5 ? Math.round(percentile(depthArr, 90)) : null,
      cum_snow_mean_in: t?.meanIn ?? null,
      cum_snow_p25_in: t?.p25In ?? null,
      cum_snow_p75_in: t?.p75In ?? null,
      cum_snow_years: t ? thirty.years : null,
      cum_snow_recent_mean_in: r?.meanIn ?? null,
      cum_snow_recent_years: r ? ten.years : null,
    });
  }

  const monthly: MonthlyRow[] = [];
  for (const window of ["30yr", "10yr"] as const) {
    for (const m of monthlyClimatology(seasons, window, currentWaterYear)) {
      monthly.push({
        station_id: stationId,
        month: m.month,
        window,
        avg_snowfall_in: m.avgSnowfallIn,
        avg_snow_days: m.avgSnowDays,
        avg_depth_in: m.avgDepthIn,
        max_storm_in: m.maxStormIn,
        max_storm_start: m.maxStormStart,
        max_storm_end: m.maxStormEnd,
        years_tracked: m.yearsTracked,
      });
    }
  }

  return { rows, monthly, thirtyYears: thirty.years, tenYears: ten.years };
}

async function supa(pathAndQuery: string, init: RequestInit): Promise<void> {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, { ...init, headers: { ...supaHeaders, ...(init.headers ?? {}) } });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Supabase ${init.method ?? "GET"} ${pathAndQuery.split("?")[0]} failed (${resp.status}): ${text}`);
  }
}

async function writeNormals(stationId: string, computed: ComputedNormals): Promise<void> {
  const key = encodeURIComponent(stationId);
  // Delete existing rows for this station (idempotent), then insert.
  await supa(`snotel_normals?station_id=eq.${key}`, { method: "DELETE" });
  await supa("snotel_normals", { method: "POST", body: JSON.stringify(computed.rows) });
  await supa(`snotel_monthly_normals?station_id=eq.${key}`, { method: "DELETE" });
  await supa("snotel_monthly_normals", { method: "POST", body: JSON.stringify(computed.monthly) });
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("Missing env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }
  const today = new Date();
  const currentWy = waterYear(today);
  const endDate = `${currentWy - 1}-09-30`;
  console.log(
    `[seed-normals] ${dryRun ? "DRY RUN — " : ""}SWE/depth normals ${WMO_NORMAL_BEGIN.slice(0, 4)}–${WMO_NORMAL_END.slice(0, 4)}; ` +
      `cumulative and monthly normals over the ${NORMAL_WINDOW_YEARS["30yr"]} and ${NORMAL_WINDOW_YEARS["10yr"]} complete winters through ${endDate}...`,
  );

  const resorts = await fetchResortsWithSnotel();
  console.log(`[seed-normals] Found ${resorts.length} resorts with SNOTEL station IDs`);

  // Dedupe stations (multiple resorts may share a station)
  const stationMap = new Map<string, { stateCode: string; resortNames: string[] }>();
  for (const r of resorts) {
    if (onlyStation && r.snotel_station_id !== onlyStation) continue;
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
  let thin = 0;

  for (const [stationId, info] of stations) {
    const label = `${stationId}:${info.stateCode}:SNTL (${info.resortNames.join(", ")})`;
    try {
      console.log(`  Fetching ${label}...`);
      const record = await fetchPeriodOfRecord(stationId, info.stateCode, endDate);
      const computed = computeStationNormals(stationId, record, currentWy);
      console.log(
        `    ${record.wteqByDay.size} SWE days, ${record.snwdByDay.size} depth days in the WMO period; ` +
          `${record.daily.length} daily rows; cumulative normal over ${computed.thirtyYears} winters, recent decade ${computed.tenYears}`,
      );
      if (computed.thirtyYears < 25) {
        thin++;
        console.log(`    NOTE fewer than 25 qualifying winters — the band is thinner than the page copy assumes`);
      }
      if (!dryRun) {
        await writeNormals(stationId, computed);
        console.log(`    Wrote ${computed.rows.length} daily + ${computed.monthly.length} monthly rows`);
      }
      success++;
    } catch (err) {
      console.error(`  FAIL ${label} -- ${(err as Error).message}`);
      failed++;
    }

    // Rate limit: 1000ms between stations (large API responses)
    await sleep(1000);
  }

  console.log(
    `\n[seed-normals] Done. ${success} stations ${dryRun ? "read" : "seeded"}, ${failed} failed, ${thin} with fewer than 25 winters (of ${stations.length} total)`
  );
}

// Only run when executed directly; scripts/snotel-backfill.test.ts imports computeStationNormals.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("[seed-normals] Fatal:", (err as Error).message);
    process.exit(1);
  });
}
