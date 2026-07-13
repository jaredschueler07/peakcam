#!/usr/bin/env tsx

/**
 * model-sync.ts
 * ─────────────
 * Snow sync for every resort WITHOUT a SNOTEL station (South
 * America + any other non-NRCS-network resort), using the
 * Open-Meteo global weather model. Mirrors scripts/snotel-sync.ts's
 * structure and writes to the same tables snotel-sync uses.
 *
 * Usage:
 *   npx tsx scripts/model-sync.ts
 *   npx tsx scripts/model-sync.ts --dry-run
 *
 * Reads:  .env.local (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 * Writes: snowpack_daily, snow_reports, resorts.cond_rating
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getOpenMeteoSnapshot } from "../lib/open-meteo.js";
import {
  computeConditions,
  type ConditionsInput,
  type UserConditionReport,
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

const STATION_ID = "open-meteo"; // synthetic station_id for snowpack_daily.station_id (not null)

// ─── Parse args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

// ─── Helpers ──────────────────────────────────────────────────────────────

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Types ────────────────────────────────────────────────────────────────

interface ModelResort {
  id: string;
  name: string;
  lat: number;
  lng: number;
  resort_metadata: { elevation_base_ft: number | null; elevation_summit_ft: number | null } | null;
}

// ─── Step 1: Fetch resorts with no SNOTEL station ─────────────────────────

async function fetchResorts(): Promise<ModelResort[]> {
  const url =
    `${SUPABASE_URL}/rest/v1/resorts?select=id,name,lat,lng,resort_metadata(elevation_base_ft,elevation_summit_ft)` +
    `&is_active=eq.true&snotel_station_id=is.null`;
  const resp = await fetch(url, { headers: supaHeaders });
  if (!resp.ok) throw new Error(`Supabase resorts fetch failed: ${resp.status}`);
  return resp.json();
}

function resortElevationFt(resort: ModelResort): number | null {
  const meta = resort.resort_metadata;
  if (!meta) return null;
  if (meta.elevation_base_ft != null && meta.elevation_summit_ft != null) {
    return Math.round((meta.elevation_base_ft + meta.elevation_summit_ft) / 2);
  }
  return meta.elevation_base_ft ?? null;
}

// ─── Step 2: Depth history (last 7 days) ──────────────────────────────────

async function fetchDepthHistory(resortId: string): Promise<(number | null)[]> {
  const url =
    `${SUPABASE_URL}/rest/v1/snowpack_daily?resort_id=eq.${resortId}&station_id=eq.${STATION_ID}` +
    `&order=date.desc&limit=7&select=snow_depth_in`;
  const resp = await fetch(url, { headers: supaHeaders });
  if (!resp.ok) return [];
  const rows: { snow_depth_in: number | null }[] = await resp.json();
  return rows.map((r) => r.snow_depth_in).reverse(); // oldest-first
}

// ─── Step 3: Recent user reports ──────────────────────────────────────────

async function fetchUserReports(resortId: string): Promise<UserConditionReport[]> {
  const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
  const url =
    `${SUPABASE_URL}/rest/v1/user_conditions?resort_id=eq.${resortId}&is_flagged=eq.false&submitted_at=gte.${cutoff}` +
    `&select=snow_quality,visibility,wind,trail_conditions`;
  const resp = await fetch(url, { headers: supaHeaders });
  if (!resp.ok) return [];
  return await resp.json();
}

// ─── Step 4: Write helpers ─────────────────────────────────────────────────

async function upsertSnowpackDaily(
  resortId: string,
  date: string,
  snowDepthIn: number | null,
): Promise<void> {
  const body = {
    resort_id: resortId,
    station_id: STATION_ID,
    date,
    snow_depth_in: snowDepthIn != null ? Math.round(snowDepthIn) : null,
    swe_in: null,
  };

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/snowpack_daily`, {
    method: "POST",
    headers: { ...supaHeaders, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`snowpack_daily upsert failed (${resp.status}): ${text}`);
  }
}

async function insertSnowReport(
  resortId: string,
  snowDepthIn: number | null,
  newSnow24hIn: number,
  newSnow48hIn: number,
  conditions: ReturnType<typeof computeConditions>,
  snowingNow: boolean,
): Promise<void> {
  const conditionsString = `${conditions.tags.join(",")}||${conditions.narrative}`;

  const body = {
    resort_id: resortId,
    base_depth: snowDepthIn != null ? Math.round(snowDepthIn) : null,
    new_snow_24h: Math.round(newSnow24hIn),
    new_snow_48h: Math.round(newSnow48hIn),
    swe_in: null,
    pct_of_normal: null, // no climatology for model-sync resorts
    trend_7d: conditions.trend7d,
    outlook: conditions.outlook,
    auto_cond_rating: conditions.condRating,
    conditions: conditionsString,
    snowing_now: snowingNow,
    source: "open_meteo",
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

async function updateResortRating(resortId: string, condRating: string): Promise<void> {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/resorts?id=eq.${resortId}`, {
    method: "PATCH",
    headers: supaHeaders,
    body: JSON.stringify({ cond_rating: condRating }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`resorts.cond_rating update failed (${resp.status}): ${text}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────

const DEPTH_TREND_THRESHOLD_IN = 2.0; // vs. the 0.5in default tuned for SWE

async function main(): Promise<void> {
  console.log(`[model-sync] Starting model-based sync${dryRun ? " (DRY RUN)" : ""}...\n`);

  const resorts = await fetchResorts();
  console.log(`[model-sync] Found ${resorts.length} resorts without a SNOTEL station\n`);

  let success = 0;
  let failed = 0;
  let noData = 0;

  for (const resort of resorts) {
    try {
      const elevationFt = resortElevationFt(resort);
      const snapshot = await getOpenMeteoSnapshot(resort.lat, resort.lng, elevationFt);

      if (!snapshot) {
        console.log(`  SKIP ${resort.name} — Open-Meteo unreachable`);
        noData++;
        await sleep(300);
        continue;
      }

      const today = fmtDate(new Date());

      if (!dryRun) {
        await upsertSnowpackDaily(resort.id, today, snapshot.snowDepthIn);
      }

      const [depthHistory, userReports] = await Promise.all([
        fetchDepthHistory(resort.id),
        fetchUserReports(resort.id),
      ]);

      const conditionsInput: ConditionsInput = {
        current: {
          snowDepthIn: snapshot.snowDepthIn,
          sweIn: null,
          newSnow24h: snapshot.newSnow24hIn,
          newSnow48h: snapshot.newSnow48hIn,
        },
        normals: {
          medianSweIn: null,
          pctile10SweIn: null,
          pctile90SweIn: null,
        },
        history7d: {
          // Depth values, not SWE — computeTrend doesn't care about units,
          // only deltas, so this reuses the same field with a larger threshold.
          sweValues: [...depthHistory, snapshot.snowDepthIn],
          thresholdIn: DEPTH_TREND_THRESHOLD_IN,
        },
        forecast: {
          snowInchesNext48h: snapshot.forecastSnow48hIn,
          maxHighTemp48h: snapshot.maxHighTemp48hF,
        },
        nwsGrid: {
          skyCoverAvg: snapshot.skyCoverAvg,
          windGustMax: snapshot.windGustMaxMph,
          windChillAvg: snapshot.tempF ?? 32,
          snowLevelAvg: snapshot.freezingLevelFt,
          resortElevBase: elevationFt ?? 99999, // unknown elevation → suppress Rain at Base
          iceAccumulationMax: 0, // Open-Meteo doesn't expose ice accumulation
          probOfPrecipMax: 0, // approximated via skyCoverAvg/snow tags instead
        },
        userReports: userReports.length > 0 ? userReports : undefined,
      };

      const conditions = computeConditions(conditionsInput);

      if (!dryRun) {
        await insertSnowReport(
          resort.id,
          snapshot.snowDepthIn,
          snapshot.newSnow24hIn,
          snapshot.newSnow48hIn,
          conditions,
          snapshot.snowingNow,
        );
        await updateResortRating(resort.id, conditions.condRating);
      }

      console.log(
        `  OK   ${resort.name} — ` +
          `depth: ${snapshot.snowDepthIn ?? "?"}in, ` +
          `24h: ${snapshot.newSnow24hIn}in, ` +
          `rating: ${conditions.condRating}, ` +
          `trend: ${conditions.trend7d}, ` +
          `outlook: ${conditions.outlook}`,
      );
      success++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  FAIL ${resort.name} — ${msg}`);
      failed++;
    }

    await sleep(300); // rate limit between resorts, matching snotel-sync.ts
  }

  console.log(
    `\n[model-sync] Done. ${success} synced, ${noData} no data, ${failed} failed (of ${resorts.length} total)`,
  );
}

main().catch((err) => {
  console.error("[model-sync] Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
