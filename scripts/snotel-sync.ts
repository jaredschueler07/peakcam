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

import { loadEnv, requireSupabaseEnv } from "./lib/env.mjs";
import {
  runScript,
  runSnowSync,
  type ResortOutcome,
} from "./lib/snow-sync-driver.js";

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

// Single source of truth for the NWS snow heuristic + gridpoint resolution.
// These used to be copy-pasted here and drifted (wintry mix scored 0 locally,
// 1 in lib/weather.ts). Import them; do not re-declare.
import {
  estimateSnow,
  resolveGridPoint,
  NWS_USER_AGENT,
  NWS_TIMEOUT_MS,
  SNOW_KEYWORDS,
} from "../lib/weather.js";

// Unit conversions live in lib/open-meteo.ts — these used to be inlined here
// as bare magic numbers (0.621371, *9/5+32, 3.28084, /25.4).
import { cmToInches, celsiusToFahrenheit, kmhToMph, metersToFeet } from "../lib/open-meteo.js";

import { sbSelect, sbSelectOrEmpty } from "../lib/supabase-rest.js";
import {
  fetchUserReports,
  insertSnowReport,
  updateResortRating,
  upsertSnowpackDaily,
} from "../lib/pipeline/writes.js";

// ─── Env ──────────────────────────────────────────────────────────────────

loadEnv();
const SUPA = requireSupabaseEnv();

const SNOTEL_BASE = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1";

// ─── Helpers ──────────────────────────────────────────────────────────────

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── Types ────────────────────────────────────────────────────────────────

interface SnotelResort {
  id: string;
  name: string;
  state: string;
  snotel_station_id: string;
  lat: number;
  lng: number;
  resort_metadata: { elevation_base_ft: number | null } | null;
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
  return sbSelect<SnotelResort>(
    SUPA,
    `/resorts?select=id,name,state,snotel_station_id,lat,lng,resort_metadata(elevation_base_ft)` +
      `&is_active=eq.true&snotel_station_id=not.is.null`,
    { errorLabel: "Supabase resorts fetch failed" },
  );
}

// ─── Step 2: Fetch SNOTEL data ────────────────────────────────────────────

async function fetchSnotelData(
  stationId: string,
  stateCode: string,
): Promise<ParsedDay[] | null> {
  const now = new Date();
  const eightDaysAgo = new Date(now);
  eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

  // stationId might now be a full triplet (e.g. "2041:VT:SCAN")
  // ONLY append if it's a raw ID (no colons)
  const triplet = stationId.includes(":") ? stationId : `${stationId}:${stateCode}:SNTL`;
  
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
  const rows = await sbSelectOrEmpty<{
    snow_depth_in: number | null;
    swe_in: number | null;
    precip_accum_in: number | null;
  }>(
    SUPA,
    `/snowpack_daily?resort_id=eq.${resortId}&order=date.desc&limit=1` +
      `&select=snow_depth_in,swe_in,precip_accum_in`,
  );
  if (!rows.length) return null;
  return {
    snowDepthIn: rows[0].snow_depth_in,
    sweIn: rows[0].swe_in,
    precipAccumIn: rows[0].precip_accum_in,
  };
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
  median_swe: number | null;
  p10_swe: number | null;
  p90_swe: number | null;
}

async function fetchNormals(
  stationId: string, // now potentially a full triplet like "842:CO:SNTL"
  dowy: number,
): Promise<NormalsRow | null> {
  const rows = await sbSelectOrEmpty<NormalsRow>(
    SUPA,
    `/snotel_normals?station_id=eq.${stationId}&day_of_water_year=eq.${dowy}` +
      `&select=median_swe,p10_swe,p90_swe&limit=1`,
  );
  return rows.length > 0 ? rows[0] : null;
}

// ─── Step 7: Get 7-day SWE history ───────────────────────────────────────

async function fetchSweHistory(
  resortId: string,
): Promise<(number | null)[]> {
  const rows = await sbSelectOrEmpty<{ swe_in: number | null }>(
    SUPA,
    `/snowpack_daily?resort_id=eq.${resortId}&order=date.desc&limit=7&select=swe_in`,
  );
  // Returned newest-first, reverse to oldest-first
  return rows.map((r) => r.swe_in).reverse();
}

// ─── Step 7b: Recent user conditions reports ─────────────────────────────
// Shared with model-sync via lib/pipeline/writes.ts → fetchUserReports().

// ─── Step 8: Fetch NWS forecast summary & Grid Data ────────────────────────

interface ForecastSummary {
  snowInchesNext48h: number;
  maxHighTemp48h: number;
  snowingNow: boolean;
  gridData: any | null;
}

async function fetchNwsForecast(
  lat: number,
  lng: number,
): Promise<ForecastSummary> {
  const defaults: ForecastSummary = { snowInchesNext48h: 0, maxHighTemp48h: 32, snowingNow: false, gridData: null };
  try {
    // Step 1: resolve gridpoint (shared with lib/weather.ts — includes the 5s timeout)
    const grid = await resolveGridPoint(lat, lng);
    const forecastUrl = grid?.forecastUrl;
    const gridUrl = grid?.forecastGridDataUrl;

    if (!forecastUrl) return defaults;

    // Step 2: fetch forecast (Summary)
    const forecastRes = await fetch(forecastUrl, {
      headers: { "User-Agent": NWS_USER_AGENT },
      signal: AbortSignal.timeout(NWS_TIMEOUT_MS),
    });
    
    let totalSnow = 0;
    let maxHigh = -Infinity;
    let snowingNow = false;
    
    if (forecastRes.ok) {
      const forecastData = await forecastRes.json();
      const periods: Array<{
        temperature: number;
        shortForecast: string;
        isDaytime: boolean;
      }> = forecastData?.properties?.periods ?? [];

      // Extract from first 4 periods (~48 hours)
      const first4 = periods.slice(0, 4);

      for (const p of first4) {
        totalSnow += estimateSnow(p.shortForecast);
        if (p.isDaytime) {
          maxHigh = Math.max(maxHigh, p.temperature);
        }
      }

      // Detect if it's currently snowing from the first (current) period
      if (periods.length > 0) {
        const currentForecast = periods[0].shortForecast.toLowerCase();
        snowingNow = SNOW_KEYWORDS.some((kw) => currentForecast.includes(kw));
      }
    }

    // Step 3: fetch Grid Data (for tags/narrative)
    let gridData = null;
    if (gridUrl) {
      const gridRes = await fetch(gridUrl, {
        headers: { "User-Agent": NWS_USER_AGENT },
        signal: AbortSignal.timeout(NWS_TIMEOUT_MS),
      });
      if (gridRes.ok) {
        gridData = await gridRes.json();
      }
    }

    return {
      snowInchesNext48h: totalSnow,
      maxHighTemp48h: maxHigh === -Infinity ? 32 : maxHigh,
      snowingNow,
      gridData: gridData?.properties || null
    };
  } catch {
    return defaults;
  }
}

// Helper to extract first grid value safely
function getGridVal(layer: any): number | null {
  if (!layer || !layer.values || layer.values.length === 0) return null;
  return layer.values[0].value;
}

// ─── Steps 9 & 10: writes ────────────────────────────────────────────────
// insertSnowReport / updateResortRating / upsertSnowpackDaily all live in
// lib/pipeline/writes.ts, shared with model-sync and the pipeline
// orchestrator (including the "tags||narrative" encoding).

// ─── Per-resort sync ──────────────────────────────────────────────────────

async function syncResort(resort: SnotelResort): Promise<ResortOutcome> {
  // 4a. Fetch SNOTEL data (last 8 days)
  const days = await fetchSnotelData(resort.snotel_station_id, resort.state);

  if (!days || days.length === 0) {
    const triplet = resort.snotel_station_id.includes(":")
      ? resort.snotel_station_id
      : `${resort.snotel_station_id}:${resort.state}:SNTL`;
    return { status: "skip", log: `  SKIP ${resort.name} (${triplet}) — no data` };
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
  await upsertSnowpackDaily(SUPA, {
    resort_id: resort.id,
    station_id: resort.snotel_station_id,
    date: latest.date,
    snow_depth_in: validated.snowDepthIn,
    swe_in: validated.sweIn,
    precip_accum_in: validated.precipAccumIn,
    temp_obs_f: validated.tempObsF,
    temp_max_f: validated.tempMaxF,
    temp_min_f: validated.tempMinF,
    qc_flag: validated.qcFlag,
  });

  // 4e. Compute new snow deltas
  const deltas = computeDeltas(days);

  // 4f. Lookup normals for today's day-of-water-year
  const dowy = dayOfWaterYear(new Date());
  const normals = await fetchNormals(resort.snotel_station_id, dowy);

  // 4g. Get 7-day SWE history + user reports
  const [sweHistory, userReports] = await Promise.all([
    fetchSweHistory(resort.id),
    fetchUserReports(SUPA, resort.id),
  ]);

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
      medianSweIn: normals?.median_swe ?? null,
      pctile10SweIn: normals?.p10_swe ?? null,
      pctile90SweIn: normals?.p90_swe ?? null,
    },
    history7d: {
      sweValues: sweHistory,
    },
    forecast: {
      snowInchesNext48h: forecast.snowInchesNext48h,
      maxHighTemp48h: forecast.maxHighTemp48h,
    },
    nwsGrid: forecast.gridData
      ? {
          skyCoverAvg: getGridVal(forecast.gridData.skyCover) ?? 50,
          windGustMax: kmhToMph(getGridVal(forecast.gridData.windGust) ?? 0),
          windChillAvg: celsiusToFahrenheit(getGridVal(forecast.gridData.windChill) ?? 0),
          snowLevelAvg: metersToFeet(getGridVal(forecast.gridData.snowLevel) ?? 0),
          resortElevBase: resort.resort_metadata?.elevation_base_ft ?? 99999, // unknown elevation → effectively disable the "Rain at Base" check (was: resort.lat, a latitude misused as feet)
          // NWS reports ice accumulation in mm; cmToInches(mm / 10) === mm / 25.4
          iceAccumulationMax: cmToInches((getGridVal(forecast.gridData.iceAccumulation) ?? 0) / 10),
          probOfPrecipMax: getGridVal(forecast.gridData.probabilityOfPrecipitation) ?? 0,
        }
      : null,
    userReports: userReports.length > 0 ? userReports : undefined,
  };

  const conditions = computeConditions(conditionsInput);

  // 4j. Insert into snow_reports (append-only)
  await insertSnowReport(SUPA, {
    resortId: resort.id,
    baseDepthIn: latest.snowDepthIn,
    newSnow24h: deltas.newSnow24h,
    newSnow48h: deltas.newSnow48h,
    sweIn: latest.sweIn,
    pctOfNormal: conditions.pctOfNormal,
    trend7d: conditions.trend7d,
    outlook: conditions.outlook,
    condRating: conditions.condRating,
    tags: conditions.tags,
    narrative: conditions.narrative,
    snowingNow: forecast.snowingNow,
    source: "snotel",
  });

  // 4k. Update resorts.cond_rating
  await updateResortRating(SUPA, resort.id, conditions.condRating);

  const pctStr = conditions.pctOfNormal != null ? `${conditions.pctOfNormal}%` : "n/a";
  return {
    status: "ok",
    log:
      `  OK   ${resort.name} — ` +
      `base: ${validated.snowDepthIn ?? "?"}in, ` +
      `SWE: ${validated.sweIn ?? "?"}in, ` +
      `pct: ${pctStr}, ` +
      `rating: ${conditions.condRating}, ` +
      `trend: ${conditions.trend7d}, ` +
      `outlook: ${conditions.outlook}, ` +
      `QC: ${validated.qcFlag}`,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────

runScript("snotel-sync", () =>
  runSnowSync({
    label: "snotel-sync",
    startLine: "Starting enhanced SNOTEL sync...",
    foundLine: (n) => `Found ${n} resorts with SNOTEL station IDs`,
    fetchResorts,
    syncResort,
  }),
);
