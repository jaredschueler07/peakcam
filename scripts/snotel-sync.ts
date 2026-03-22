#!/usr/bin/env tsx

/**
 * snotel-sync.ts
 * ──────────────
 * Enhanced SNOTEL sync pipeline with quality checks, snowpack history,
 * 30-year normals comparison, NWS forecast integration, and the
 * conditions engine. Replaces the old snotel-sync.mjs.
 *
 * Usage:
 *   npx tsx scripts/snotel-sync.ts
 *
 * Reads:  .env.local (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 * Writes: snowpack_daily, snow_reports, resorts.cond_rating
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  validateReading,
  dayOfWaterYear,
  type RawSnotelReading,
  type PreviousDay,
} from "../lib/snow-quality.js";

import {
  computeConditions,
  type ConditionsInput,
} from "../lib/conditions-engine.js";

// ─── Load .env.local manually ────────────────────────────────────────────

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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Missing env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(1);
}

const supaHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

const SNOTEL_BASE = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1";
const NWS_USER_AGENT = "PeakCam/1.0 (contact@peakcam.app)";

// ─── Helpers ──────────────────────────────────────────────────────────────

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Rough snow-inch estimate from NWS forecast string. */
function estimateSnow(shortForecast: string): number {
  const lower = shortForecast.toLowerCase();
  if (lower.includes("heavy snow") || lower.includes("blizzard")) return 8;
  if (lower.includes("snow")) return 3;
  if (lower.includes("flurr")) return 1;
  return 0;
}

// ─── Types ────────────────────────────────────────────────────────────────

interface SnotelResort {
  id: string;
  name: string;
  state: string;
  snotel_station_id: string;
  lat: number;
  lng: number;
}

interface SnotelApiValue {
  value: number | null;
  date: string;
}

interface SnotelApiElement {
  stationElement: { elementCode: string };
  values: SnotelApiValue[];
}

interface ParsedDay {
  date: string;
  snowDepthIn: number | null;
  sweIn: number | null;
  precipAccumIn: number | null;
  tempObsF: number | null;
  tempMaxF: number | null;
  tempMinF: number | null;
}

// ─── Step 1: Fetch resorts with snotel_station_id ─────────────────────────

async function fetchResorts(): Promise<SnotelResort[]> {
  const url = `${SUPABASE_URL}/rest/v1/resorts?select=id,name,state,snotel_station_id,lat,lng&is_active=eq.true&snotel_station_id=not.is.null`;
  const resp = await fetch(url, { headers: supaHeaders });
  if (!resp.ok) throw new Error(`Supabase resorts fetch failed: ${resp.status}`);
  return resp.json();
}

// ─── Step 2: Fetch SNOTEL data ────────────────────────────────────────────

async function fetchSnotelData(
  stationId: string,
  stateCode: string,
): Promise<ParsedDay[] | null> {
  const now = new Date();
  const eightDaysAgo = new Date(now);
  eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

  const triplet = `${stationId}:${stateCode}:SNTL`;
  const params = new URLSearchParams({
    stationTriplets: triplet,
    elements: "SNWD,WTEQ,PREC,TOBS,TMAX,TMIN",
    duration: "DAILY",
    getFlags: "false",
    beginDate: fmtDate(eightDaysAgo),
    endDate: fmtDate(now),
  });

  const resp = await fetch(`${SNOTEL_BASE}/data?${params}`);
  if (!resp.ok) {
    throw new Error(`SNOTEL API error ${resp.status} for ${triplet}`);
  }

  const json = await resp.json();
  if (!json.length || !json[0].data || !json[0].data.length) {
    return null;
  }

  const stationData: SnotelApiElement[] = json[0].data;

  // Index elements by code
  const byCode: Record<string, SnotelApiValue[]> = {};
  for (const elem of stationData) {
    const code = elem.stationElement.elementCode;
    byCode[code] = (elem.values || []).filter(
      (v) => v.value !== null && v.value !== -99,
    );
  }

  // Collect all unique dates across all elements
  const dateSet = new Set<string>();
  for (const vals of Object.values(byCode)) {
    for (const v of vals) dateSet.add(v.date.slice(0, 10));
  }
  const dates = Array.from(dateSet).sort();

  // Build a lookup: code → date → value
  const lookup = (code: string, date: string): number | null => {
    const vals = byCode[code] ?? [];
    const found = vals.find((v) => v.date.slice(0, 10) === date);
    return found?.value ?? null;
  };

  // Build day-by-day readings
  const days: ParsedDay[] = dates.map((date) => ({
    date,
    snowDepthIn: lookup("SNWD", date),
    sweIn: lookup("WTEQ", date),
    precipAccumIn: lookup("PREC", date),
    tempObsF: lookup("TOBS", date),
    tempMaxF: lookup("TMAX", date),
    tempMinF: lookup("TMIN", date),
  }));

  return days.length > 0 ? days : null;
}

// ─── Step 3: Get previous day from snowpack_daily ─────────────────────────

async function getPreviousDay(
  resortId: string,
): Promise<PreviousDay | null> {
  const url =
    `${SUPABASE_URL}/rest/v1/snowpack_daily?resort_id=eq.${resortId}&order=date.desc&limit=1&select=snow_depth_in,swe_in,precip_accum_in`;
  const resp = await fetch(url, { headers: supaHeaders });
  if (!resp.ok) return null;
  const rows = await resp.json();
  if (!rows.length) return null;
  return {
    snowDepthIn: rows[0].snow_depth_in,
    sweIn: rows[0].swe_in,
    precipAccumIn: rows[0].precip_accum_in,
  };
}

// ─── Step 4: Upsert to snowpack_daily ─────────────────────────────────────

async function upsertSnowpackDaily(
  resortId: string,
  stationId: string,
  date: string,
  validated: ReturnType<typeof validateReading>,
): Promise<void> {
  const body = {
    resort_id: resortId,
    station_id: stationId,
    date,
    snow_depth_in: validated.snowDepthIn,
    swe_in: validated.sweIn,
    precip_accum_in: validated.precipAccumIn,
    temp_obs_f: validated.tempObsF,
    temp_max_f: validated.tempMaxF,
    temp_min_f: validated.tempMinF,
    qc_flag: validated.qcFlag,
  };

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/snowpack_daily`, {
    method: "POST",
    headers: {
      ...supaHeaders,
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`snowpack_daily upsert failed (${resp.status}): ${text}`);
  }
}

// ─── Step 5: Compute new snow deltas ──────────────────────────────────────

function computeDeltas(days: ParsedDay[]): { newSnow24h: number; newSnow48h: number } {
  if (days.length < 2) return { newSnow24h: 0, newSnow48h: 0 };

  const latest = days[days.length - 1];
  const prev = days[days.length - 2];

  let newSnow24h = 0;
  if (latest.snowDepthIn != null && prev.snowDepthIn != null) {
    const delta = latest.snowDepthIn - prev.snowDepthIn;
    newSnow24h = delta > 0 ? Math.round(delta) : 0;
  }

  let newSnow48h = 0;
  if (days.length >= 3) {
    const twoDaysAgo = days[days.length - 3];
    if (latest.snowDepthIn != null && twoDaysAgo.snowDepthIn != null) {
      const delta = latest.snowDepthIn - twoDaysAgo.snowDepthIn;
      newSnow48h = delta > 0 ? Math.round(delta) : 0;
    }
  }

  return { newSnow24h, newSnow48h };
}

// ─── Step 6: Lookup normals ───────────────────────────────────────────────

interface NormalsRow {
  median_swe_in: number | null;
  pctile_10_swe_in: number | null;
  pctile_90_swe_in: number | null;
}

async function fetchNormals(
  stationId: string,
  dowy: number,
): Promise<NormalsRow | null> {
  const url =
    `${SUPABASE_URL}/rest/v1/snotel_normals?station_id=eq.${stationId}&day_of_water_year=eq.${dowy}&select=median_swe_in,pctile_10_swe_in,pctile_90_swe_in&limit=1`;
  const resp = await fetch(url, { headers: supaHeaders });
  if (!resp.ok) return null;
  const rows = await resp.json();
  return rows.length > 0 ? rows[0] : null;
}

// ─── Step 7: Get 7-day SWE history ───────────────────────────────────────

async function fetchSweHistory(
  resortId: string,
): Promise<(number | null)[]> {
  const url =
    `${SUPABASE_URL}/rest/v1/snowpack_daily?resort_id=eq.${resortId}&order=date.desc&limit=7&select=swe_in`;
  const resp = await fetch(url, { headers: supaHeaders });
  if (!resp.ok) return [];
  const rows: { swe_in: number | null }[] = await resp.json();
  // Returned newest-first, reverse to oldest-first
  return rows.map((r) => r.swe_in).reverse();
}

// ─── Step 8: Fetch NWS forecast summary ──────────────────────────────────

interface ForecastSummary {
  snowInchesNext48h: number;
  maxHighTemp48h: number;
}

async function fetchNwsForecast(
  lat: number,
  lng: number,
): Promise<ForecastSummary> {
  const defaults: ForecastSummary = { snowInchesNext48h: 0, maxHighTemp48h: 32 };
  try {
    // Step 1: resolve gridpoint
    const pointsRes = await fetch(
      `https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`,
      { headers: { "User-Agent": NWS_USER_AGENT } },
    );
    if (!pointsRes.ok) return defaults;
    const pointsData = await pointsRes.json();
    const forecastUrl: string | undefined = pointsData?.properties?.forecast;
    if (!forecastUrl) return defaults;

    // Step 2: fetch forecast
    const forecastRes = await fetch(forecastUrl, {
      headers: { "User-Agent": NWS_USER_AGENT },
    });
    if (!forecastRes.ok) return defaults;
    const forecastData = await forecastRes.json();
    const periods: Array<{
      temperature: number;
      shortForecast: string;
      isDaytime: boolean;
    }> = forecastData?.properties?.periods ?? [];

    // Extract from first 4 periods (~48 hours)
    const first4 = periods.slice(0, 4);
    let totalSnow = 0;
    let maxHigh = -Infinity;

    for (const p of first4) {
      totalSnow += estimateSnow(p.shortForecast);
      if (p.isDaytime) {
        maxHigh = Math.max(maxHigh, p.temperature);
      }
    }

    return {
      snowInchesNext48h: totalSnow,
      maxHighTemp48h: maxHigh === -Infinity ? 32 : maxHigh,
    };
  } catch {
    return defaults;
  }
}

// ─── Step 9: Insert snow_reports (append-only) ───────────────────────────

async function insertSnowReport(
  resortId: string,
  latest: ParsedDay,
  deltas: { newSnow24h: number; newSnow48h: number },
  conditions: ReturnType<typeof computeConditions>,
): Promise<void> {
  const body = {
    resort_id: resortId,
    base_depth: latest.snowDepthIn != null ? Math.round(latest.snowDepthIn) : null,
    new_snow_24h: deltas.newSnow24h,
    new_snow_48h: deltas.newSnow48h,
    swe_in: latest.sweIn,
    pct_of_normal: conditions.pctOfNormal,
    trend_7d: conditions.trend7d,
    outlook: conditions.outlook,
    auto_cond_rating: conditions.condRating,
    source: "snotel",
    updated_at: new Date().toISOString(),
  };

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/snow_reports`, {
    method: "POST",
    headers: supaHeaders,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`snow_reports insert failed (${resp.status}): ${text}`);
  }
}

// ─── Step 10: Update resorts.cond_rating ──────────────────────────────────

async function updateResortRating(
  resortId: string,
  condRating: string,
): Promise<void> {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/resorts?id=eq.${resortId}`,
    {
      method: "PATCH",
      headers: supaHeaders,
      body: JSON.stringify({ cond_rating: condRating }),
    },
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`resorts.cond_rating update failed (${resp.status}): ${text}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("[snotel-sync] Starting enhanced SNOTEL sync...\n");

  const resorts = await fetchResorts();
  console.log(`[snotel-sync] Found ${resorts.length} resorts with SNOTEL station IDs\n`);

  let success = 0;
  let failed = 0;
  let noData = 0;

  for (const resort of resorts) {
    try {
      // 4a. Fetch SNOTEL data (last 8 days)
      const days = await fetchSnotelData(
        resort.snotel_station_id,
        resort.state,
      );

      if (!days || days.length === 0) {
        console.log(
          `  SKIP ${resort.name} (${resort.snotel_station_id}:${resort.state}:SNTL) — no data`,
        );
        noData++;
        await sleep(300);
        continue;
      }

      const latest = days[days.length - 1];

      // 4b. Get previous day from snowpack_daily
      const previousDay = await getPreviousDay(resort.id);

      // 4c. Validate latest reading
      const raw: RawSnotelReading = {
        snowDepthIn: latest.snowDepthIn,
        sweIn: latest.sweIn,
        precipAccumIn: latest.precipAccumIn,
        tempObsF: latest.tempObsF,
        tempMaxF: latest.tempMaxF,
        tempMinF: latest.tempMinF,
      };
      const validated = validateReading(raw, previousDay);

      // 4d. Upsert to snowpack_daily
      await upsertSnowpackDaily(
        resort.id,
        resort.snotel_station_id,
        latest.date,
        validated,
      );

      // 4e. Compute new snow deltas
      const deltas = computeDeltas(days);

      // 4f. Lookup normals for today's day-of-water-year
      const dowy = dayOfWaterYear(new Date());
      const normals = await fetchNormals(resort.snotel_station_id, dowy);

      // 4g. Get 7-day SWE history
      const sweHistory = await fetchSweHistory(resort.id);

      // 4h. Fetch NWS forecast summary
      const forecast = await fetchNwsForecast(resort.lat, resort.lng);

      // 4i. Run conditions engine
      const conditionsInput: ConditionsInput = {
        current: {
          snowDepthIn: validated.snowDepthIn,
          sweIn: validated.sweIn,
          newSnow24h: deltas.newSnow24h,
          newSnow48h: deltas.newSnow48h,
        },
        normals: {
          medianSweIn: normals?.median_swe_in ?? null,
          pctile10SweIn: normals?.pctile_10_swe_in ?? null,
          pctile90SweIn: normals?.pctile_90_swe_in ?? null,
        },
        history7d: {
          sweValues: sweHistory,
        },
        forecast: {
          snowInchesNext48h: forecast.snowInchesNext48h,
          maxHighTemp48h: forecast.maxHighTemp48h,
        },
      };

      const conditions = computeConditions(conditionsInput);

      // 4j. Insert into snow_reports (append-only)
      await insertSnowReport(resort.id, latest, deltas, conditions);

      // 4k. Update resorts.cond_rating
      await updateResortRating(resort.id, conditions.condRating);

      // Log per-resort status
      const pctStr =
        conditions.pctOfNormal != null ? `${conditions.pctOfNormal}%` : "n/a";
      console.log(
        `  OK   ${resort.name} — ` +
          `base: ${validated.snowDepthIn ?? "?"}in, ` +
          `SWE: ${validated.sweIn ?? "?"}in, ` +
          `pct: ${pctStr}, ` +
          `rating: ${conditions.condRating}, ` +
          `trend: ${conditions.trend7d}, ` +
          `outlook: ${conditions.outlook}, ` +
          `QC: ${validated.qcFlag}`,
      );
      success++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  FAIL ${resort.name} — ${msg}`);
      failed++;
    }

    // Rate limit: 300ms between resorts
    await sleep(300);
  }

  console.log(
    `\n[snotel-sync] Done. ${success} synced, ${noData} no data, ${failed} failed (of ${resorts.length} total)`,
  );
}

main().catch((err) => {
  console.error("[snotel-sync] Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
