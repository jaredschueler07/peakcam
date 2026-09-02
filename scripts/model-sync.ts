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

import { getOpenMeteoSnapshot } from "../lib/open-meteo.js";
import {
  computeConditions,
  type ConditionsInput,
} from "../lib/conditions-engine.js";

import { loadEnv, requireSupabaseEnv } from "./lib/env.mjs";
import {
  runScript,
  runSnowSync,
  type ResortOutcome,
} from "./lib/snow-sync-driver.js";
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

const STATION_ID = "open-meteo"; // synthetic station_id for snowpack_daily.station_id (not null)

// ─── Parse args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

// ─── Helpers ──────────────────────────────────────────────────────────────

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
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
  return sbSelect<ModelResort>(
    SUPA,
    `/resorts?select=id,name,lat,lng,resort_metadata(elevation_base_ft,elevation_summit_ft)` +
      `&is_active=eq.true&snotel_station_id=is.null`,
    { errorLabel: "Supabase resorts fetch failed" },
  );
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
  const rows = await sbSelectOrEmpty<{ snow_depth_in: number | null }>(
    SUPA,
    `/snowpack_daily?resort_id=eq.${resortId}&station_id=eq.${STATION_ID}` +
      `&order=date.desc&limit=7&select=snow_depth_in`,
  );
  return rows.map((r) => r.snow_depth_in).reverse(); // oldest-first
}

// ─── Steps 3 & 4: user reports + writes ───────────────────────────────────
// fetchUserReports / upsertSnowpackDaily / insertSnowReport /
// updateResortRating are shared with snotel-sync and the pipeline
// orchestrator via lib/pipeline/writes.ts.

// ─── Main ─────────────────────────────────────────────────────────────────

const DEPTH_TREND_THRESHOLD_IN = 2.0; // vs. the 0.5in default tuned for SWE

async function syncResort(resort: ModelResort): Promise<ResortOutcome> {
  const elevationFt = resortElevationFt(resort);
  const snapshot = await getOpenMeteoSnapshot(resort.lat, resort.lng, elevationFt);

  if (!snapshot) {
    return { status: "skip", log: `  SKIP ${resort.name} — Open-Meteo unreachable` };
  }

  const today = fmtDate(new Date());

  if (!dryRun) {
    await upsertSnowpackDaily(SUPA, {
      resort_id: resort.id,
      station_id: STATION_ID,
      date: today,
      snow_depth_in:
        snapshot.snowDepthIn != null ? Math.round(snapshot.snowDepthIn) : null,
      swe_in: null,
    });
  }

  const [depthHistory, userReports] = await Promise.all([
    fetchDepthHistory(resort.id),
    fetchUserReports(SUPA, resort.id),
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
      // depthHistory is fetched AFTER today's snowpack_daily upsert above,
      // so on a live run it already includes today's just-written depth
      // as its newest entry (same as scripts/snotel-sync.ts's sweHistory
      // usage) — do not append snapshot.snowDepthIn again here, or today
      // gets double-counted and the 7-day window shrinks to 6 prior days.
      sweValues: depthHistory,
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
    await insertSnowReport(SUPA, {
      resortId: resort.id,
      baseDepthIn: snapshot.snowDepthIn,
      newSnow24h: snapshot.newSnow24hIn,
      newSnow48h: snapshot.newSnow48hIn,
      sweIn: null,
      pctOfNormal: null, // no climatology for model-sync resorts
      trend7d: conditions.trend7d,
      outlook: conditions.outlook,
      condRating: conditions.condRating,
      tags: conditions.tags,
      narrative: conditions.narrative,
      snowingNow: snapshot.snowingNow,
      source: "open_meteo",
    });
    await updateResortRating(SUPA, resort.id, conditions.condRating);
  }

  return {
    status: "ok",
    log:
      `  OK   ${resort.name} — ` +
      `depth: ${snapshot.snowDepthIn ?? "?"}in, ` +
      `24h: ${snapshot.newSnow24hIn}in, ` +
      `rating: ${conditions.condRating}, ` +
      `trend: ${conditions.trend7d}, ` +
      `outlook: ${conditions.outlook}`,
  };
}

runScript("model-sync", () =>
  runSnowSync({
    label: "model-sync",
    startLine: `Starting model-based sync${dryRun ? " (DRY RUN)" : ""}...`,
    foundLine: (n) => `Found ${n} resorts without a SNOTEL station`,
    fetchResorts,
    syncResort,
    // rate limit between resorts, matching scripts/snotel-sync.ts
    delayMs: 300,
  }),
);
