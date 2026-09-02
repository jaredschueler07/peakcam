// ─────────────────────────────────────────────────────────────
// PeakCam — Multi-Source Pipeline Orchestrator
// Runs all fetchers for each resort, blends results, and
// writes blended conditions back to the database.
// ─────────────────────────────────────────────────────────────

import type {
  SourceReading,
  BlendedResult,
  ResortContext,
  SourceName,
} from "./types";
import { fetchSnotel } from "./fetchers/snotel";
import { fetchNws } from "./fetchers/nws";
import { fetchLiftie } from "./fetchers/liftie";
import { fetchSnodas } from "./fetchers/snodas";
import { fetchWeatherUnlocked } from "./fetchers/weather-unlocked";
import { fetchUserReports } from "./fetchers/user-reports";
import { blend } from "./blender";
import {
  sbSelect,
  sbSelectOrEmpty,
  sbUpsert,
  type SupabaseRestConfig,
} from "../supabase-rest";
import {
  insertSnowReport as writeSnowReport,
  updateResortRating as writeResortRating,
} from "./writes";

// ── Constants ───────────────────────────────────────────────

const INTER_RESORT_DELAY_MS = 300;
const NWS_THROTTLE_MS = 500;
const WU_DAILY_LIMIT = 950;

// CONUS bounding box for SNODAS applicability
const CONUS_BOUNDS = {
  latMin: 24.5,
  latMax: 49.5,
  lngMin: -125.0,
  lngMax: -66.5,
};

// ── Helpers ─────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isInConus(lat: number, lng: number): boolean {
  return (
    lat >= CONUS_BOUNDS.latMin &&
    lat <= CONUS_BOUNDS.latMax &&
    lng >= CONUS_BOUNDS.lngMin &&
    lng <= CONUS_BOUNDS.lngMax
  );
}

// ── Supabase REST helpers ───────────────────────────────────

// Read lazily (not at module scope) so a caller can load .env before the
// first DB call. scripts/pipeline-sync.ts relies on this.
function getEnv(): SupabaseRestConfig {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return { url, key };
}

interface ResortRow {
  id: string;
  slug: string;
  name: string;
  lat: number;
  lng: number;
  snotel_station_id: string | null;
  is_active: boolean;
}

interface MetadataRow {
  resort_id: string;
  liftie_slug: string | null;
  weather_unlocked_id: string | null;
  elevation_base_ft: number | null;
  elevation_summit_ft: number | null;
  vertical_drop_ft: number | null;
  run_count: number | null;
  lift_count: number | null;
  openskistats_id: string | null;
  snodas_grid_x: number | null;
  snodas_grid_y: number | null;
}

async function fetchActiveResorts(): Promise<ResortContext[]> {
  const cfg = getEnv();

  // Fetch resorts
  const resorts = await sbSelect<ResortRow>(
    cfg,
    "/resorts?is_active=eq.true&select=id,slug,name,lat,lng,snotel_station_id",
    { errorLabel: "Failed to fetch resorts" },
  );

  // Fetch metadata (best-effort — a missing metadata table still yields resorts)
  const metaByResort = new Map<string, MetadataRow>();
  {
    const rows = await sbSelectOrEmpty<MetadataRow>(
      cfg,
      "/resort_metadata?select=resort_id,liftie_slug,weather_unlocked_id,elevation_base_ft,elevation_summit_ft,vertical_drop_ft,run_count,lift_count,openskistats_id,snodas_grid_x,snodas_grid_y",
    );
    for (const row of rows) {
      metaByResort.set(row.resort_id, row);
    }
  }

  return resorts.map((r) => {
    const meta = metaByResort.get(r.id) ?? null;
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      lat: r.lat,
      lng: r.lng,
      snotel_station_id: r.snotel_station_id,
      metadata: meta
        ? {
            resort_id: r.id,
            openskistats_id: meta.openskistats_id ?? null,
            elevation_base_ft: meta.elevation_base_ft ?? null,
            elevation_summit_ft: meta.elevation_summit_ft ?? null,
            vertical_drop_ft: meta.vertical_drop_ft ?? null,
            run_count: meta.run_count ?? null,
            lift_count: meta.lift_count ?? null,
            liftie_slug: meta.liftie_slug ?? null,
            weather_unlocked_id: meta.weather_unlocked_id ?? null,
            snodas_grid_x: meta.snodas_grid_x ?? null,
            snodas_grid_y: meta.snodas_grid_y ?? null,
          }
        : null,
    };
  });
}

// ── DB Write Helpers ────────────────────────────────────────
// The three writes shared with the two sync scripts (snow_reports,
// resorts.cond_rating, snowpack_daily) live in ./writes.ts. Only the two
// pipeline-only tables are written here.

async function upsertSourceReading(reading: SourceReading): Promise<void> {
  await sbUpsert(getEnv(), "data_source_readings", reading, {
    errorLabel: "data_source_readings upsert failed",
  });
}

async function upsertConditionsSummary(result: BlendedResult): Promise<void> {
  await sbUpsert(getEnv(), "resort_conditions_summary", result, {
    errorLabel: "resort_conditions_summary upsert failed",
  });
}

async function insertSnowReport(
  resortId: string,
  blended: BlendedResult,
): Promise<void> {
  await writeSnowReport(getEnv(), {
    resortId,
    baseDepthIn: blended.snow_depth_in,
    newSnow24h: blended.new_snow_24h_in,
    newSnow48h: blended.new_snow_48h_in,
    sweIn: blended.swe_in,
    pctOfNormal: blended.pct_of_normal,
    trend7d: blended.trend_7d,
    outlook: blended.outlook,
    condRating: blended.cond_rating,
    tags: blended.tags,
    narrative: blended.narrative ?? "",
    source: "pipeline",
  });
}

async function updateResortRating(
  resortId: string,
  condRating: string,
): Promise<void> {
  await writeResortRating(getEnv(), resortId, condRating);
}

// ── Orchestrator ────────────────────────────────────────────

interface PipelineSyncOptions {
  dryRun?: boolean;
}

interface PipelineStats {
  total: number;
  success: number;
  failed: number;
  skipped: number;
}

export async function runPipelineSync(
  options: PipelineSyncOptions = {},
): Promise<void> {
  const { dryRun = false } = options;
  const startTime = Date.now();

  console.log(
    `[pipeline] Starting multi-source sync${dryRun ? " (DRY RUN)" : ""}...\n`,
  );

  // Step 1: Fetch all active resorts with metadata
  const resorts = await fetchActiveResorts();
  console.log(`[pipeline] Found ${resorts.length} active resorts\n`);

  if (resorts.length === 0) {
    console.log("[pipeline] No active resorts found. Exiting.");
    return;
  }

  // Step 2: Download SNODAS data once (global)
  // SNODAS fetcher handles its own data download; we just note it's available.
  // The fetchSnodas function uses cached grid data internally.

  const stats: PipelineStats = {
    total: resorts.length,
    success: 0,
    failed: 0,
    skipped: 0,
  };

  let wuRequestCount = 0;
  let lastNwsCallTime = 0;

  // Step 3: Process each resort
  for (let i = 0; i < resorts.length; i++) {
    const resort = resorts[i];
    const resortLabel = `Resort ${i + 1}/${resorts.length}: ${resort.name}`;

    try {
      const readings: SourceReading[] = [];

      // Determine which fetchers to run
      const fetcherTasks: Array<{
        name: SourceName;
        fn: () => Promise<SourceReading | null>;
      }> = [];

      // SNOTEL: only if resort has a station ID
      if (resort.snotel_station_id) {
        fetcherTasks.push({
          name: "snotel",
          fn: () => fetchSnotel(resort),
        });
      }

      // NWS: always (uses lat/lng), but throttle
      fetcherTasks.push({
        name: "nws",
        fn: async () => {
          const elapsed = Date.now() - lastNwsCallTime;
          if (elapsed < NWS_THROTTLE_MS) {
            await sleep(NWS_THROTTLE_MS - elapsed);
          }
          lastNwsCallTime = Date.now();
          return fetchNws(resort);
        },
      });

      // Liftie: only if resort has a liftie slug
      if (resort.metadata?.liftie_slug) {
        fetcherTasks.push({
          name: "liftie",
          fn: () => fetchLiftie(resort),
        });
      }

      // SNODAS: only if in CONUS
      if (isInConus(resort.lat, resort.lng)) {
        fetcherTasks.push({
          name: "snodas",
          fn: () => fetchSnodas(resort),
        });
      }

      // Weather Unlocked: only if resort has an ID and under daily limit
      if (resort.metadata?.weather_unlocked_id && wuRequestCount < WU_DAILY_LIMIT) {
        fetcherTasks.push({
          name: "weather_unlocked",
          fn: () => {
            wuRequestCount++;
            return fetchWeatherUnlocked(resort);
          },
        });
      }

      // User reports: always
      fetcherTasks.push({
        name: "user_reports",
        fn: () => fetchUserReports(resort),
      });

      // Run fetchers (sequentially to respect rate limits)
      for (const task of fetcherTasks) {
        try {
          const reading = await task.fn();
          if (reading) {
            readings.push(reading);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`  [${task.name}] failed for ${resort.name}: ${msg}`);
        }
      }

      if (readings.length === 0) {
        console.log(`  SKIP ${resortLabel} — no source data`);
        stats.skipped++;
        await sleep(INTER_RESORT_DELAY_MS);
        continue;
      }

      // Upsert source readings
      if (!dryRun) {
        for (const reading of readings) {
          try {
            await upsertSourceReading(reading);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(
              `  [upsert] reading for ${resort.name}/${reading.source}: ${msg}`,
            );
          }
        }
      }

      // Blend all readings
      // blend() threads the resort's real base elevation (or the 99999
      // sentinel when metadata is missing) into the conditions engine.
      const blended = blend(resort, readings);

      // Write blended results
      if (!dryRun) {
        await upsertConditionsSummary(blended);
        await insertSnowReport(resort.id, blended);
        if (blended.cond_rating) {
          await updateResortRating(resort.id, blended.cond_rating);
        }
      }

      const sourcesUsed = readings.map((r) => r.source).join(", ");
      console.log(
        `  OK   ${resortLabel} — ${readings.length} sources (${sourcesUsed}), confidence ${blended.confidence_score.toFixed(2)}`,
      );
      stats.success++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  FAIL ${resortLabel} — ${msg}`);
      stats.failed++;
    }

    // Rate limit between resorts
    await sleep(INTER_RESORT_DELAY_MS);
  }

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `\n[pipeline] Done in ${elapsed}s. ` +
      `${stats.success} synced, ${stats.skipped} skipped, ${stats.failed} failed ` +
      `(of ${stats.total} total). ` +
      `Weather Unlocked requests: ${wuRequestCount}`,
  );
}
