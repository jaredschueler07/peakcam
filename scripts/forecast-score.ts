#!/usr/bin/env tsx

/**
 * forecast-score.ts
 * ─────────────────
 * Forecast verification (parity plan block P4). For every resort with a
 * measured 24 h new-snow series — SNOTEL depth deltas from `snowpack_daily`
 * (clipped at zero), or a GHCN station's own `new_snow_in` from the P3
 * station layer when a resort has no SNOTEL — compares the day-1, day-3 and
 * day-7 forecasts issued for each measured date over the trailing 90 days
 * against the measured value, per model, and rewrites `forecast_scores`
 * (one row per model plus `blend`, graded by the same rule). The pure
 * scoring lives in lib/forecast/score.ts and is tested there.
 *
 * Grades the stored point nearest the station's elevation (base when the
 * elevation is unknown) — lib/forecast/score.ts scoredPointFor(), which the
 * accuracy API applies too, so the surface names the same point.
 *
 * Usage:
 *   npx tsx scripts/forecast-score.ts                 # every eligible resort
 *   npx tsx scripts/forecast-score.ts --resort alta   # one resort
 *   npx tsx scripts/forecast-score.ts --dry-run       # score, write nothing
 *
 * Reads:  .env.local (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 * Writes: forecast_scores (service role; migration 027)
 *
 * Schedule: launchd `com.peakcam.forecast-score`, daily 07:30 local on the
 * Mini — after the 06:00-ish snotel-sync run has written the previous day's
 * depth, and independent of forecast-sync so a failed fetch never blocks the
 * grading (or the other way round).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SCORE_PERIOD_DAYS,
  addDays,
  measuredFromDepth,
  measuredFromNewSnow,
  pairForecasts,
  scoreModels,
  scoredPointFor,
  withBlendPairs,
  type MeasuredSeries,
  type ModelScore,
} from "../lib/forecast/score.js";
import { assembleStoredRuns, type ForecastDailyRow, type ForecastRunRow, type StoredRun } from "../lib/forecast/store.js";
import { modelLabel, type ForecastPoint } from "../lib/forecast/open-meteo-models.js";
import { STATION_INDEX } from "../lib/stations.js";

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
  console.error("Missing env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supaHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

// ─── Parse args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const resortArgIdx = args.indexOf("--resort");
const onlySlug = resortArgIdx >= 0 ? args[resortArgIdx + 1] : null;

/** Longest lead scored; runs this many days before the window start are needed. */
const MAX_LEAD_DAYS = 7;
const IN_CHUNK = 60;

// ─── Types ────────────────────────────────────────────────────────────────

interface ScoreResort {
  id: string;
  slug: string;
  name: string;
  snotel_station_id: string | null;
  elevation_summit_ft: number | null;
  elevation_base_ft: number | null;
}

type TruthBasis = "snotel" | "ghcn";

// ─── Supabase I/O (PostgREST) ─────────────────────────────────────────────

async function getJson<T>(url: string): Promise<T> {
  const resp = await fetch(url, { headers: supaHeaders });
  if (!resp.ok) throw new Error(`${resp.status} ${await resp.text()} — ${url.slice(0, 120)}`);
  return resp.json() as Promise<T>;
}

async function fetchResorts(): Promise<ScoreResort[]> {
  let url = `${SUPABASE_URL}/rest/v1/resorts?select=id,slug,name,snotel_station_id,elevation_summit_ft,elevation_base_ft&is_active=eq.true&order=slug`;
  if (onlySlug) url += `&slug=eq.${encodeURIComponent(onlySlug)}`;
  return getJson<ScoreResort[]>(url);
}

/** SNOTEL depth rows for the window plus one day before it (the first delta needs a previous day). */
async function fetchDepthRows(resortId: string, since: string): Promise<Array<{ date: string; snow_depth_in: number | null; qc_flag: string }>> {
  return getJson(
    `${SUPABASE_URL}/rest/v1/snowpack_daily?resort_id=eq.${resortId}&station_id=neq.open-meteo&date=gte.${addDays(since, -1)}&select=date,snow_depth_in,qc_flag&order=date`,
  );
}

/** A GHCN station's own daily new snow (P3 station layer), when the resort has one. */
async function fetchGhcnSeries(resortId: string, since: string): Promise<{ series: MeasuredSeries; stationElevationFt: number | null } | null> {
  try {
    const links = await getJson<Array<{ station_id: string; rank: number; stations: { kind: string; elevation_ft: number | null } | null }>>(
      `${SUPABASE_URL}/rest/v1/resort_stations?resort_id=eq.${resortId}&select=station_id,rank,stations(kind,elevation_ft)&order=rank`,
    );
    const ghcn = links.find((l) => l.stations?.kind === "ghcn");
    if (!ghcn) return null;
    const rows = await getJson<Array<{ observed_at: string; new_snow_in: number | null }>>(
      `${SUPABASE_URL}/rest/v1/station_observations?station_id=eq.${ghcn.station_id}&observed_at=gte.${since}T00:00:00Z&select=observed_at,new_snow_in&order=observed_at`,
    );
    const series = measuredFromNewSnow(rows.map((r) => ({ date: r.observed_at.slice(0, 10), new_snow_in: r.new_snow_in })));
    return series.size ? { series, stationElevationFt: ghcn.stations?.elevation_ft ?? null } : null;
  } catch {
    return null; // tables absent or empty until P3 lands
  }
}

async function fetchRuns(resortId: string, point: ForecastPoint, since: string): Promise<StoredRun[]> {
  const runs = await getJson<ForecastRunRow[]>(
    `${SUPABASE_URL}/rest/v1/forecast_runs?resort_id=eq.${resortId}&point=eq.${point}&issued_at=gte.${addDays(since, -MAX_LEAD_DAYS)}T00:00:00Z&select=id,resort_id,point,model,issued_at,horizon_days&order=issued_at.desc&limit=20000`,
  );
  const daily: ForecastDailyRow[] = [];
  for (let i = 0; i < runs.length; i += IN_CHUNK) {
    const ids = runs.slice(i, i + IN_CHUNK).map((r) => r.id);
    daily.push(
      ...(await getJson<ForecastDailyRow[]>(
        `${SUPABASE_URL}/rest/v1/forecast_daily?run_id=in.(${ids.join(",")})&date=gte.${since}&select=run_id,date,snowfall_cm,snowfall_lo,snowfall_hi,temp_max,temp_min,precip_prob,wind_gust,weather_code`,
      )),
    );
  }
  return assembleStoredRuns(runs, daily);
}

async function availablePoints(resortId: string): Promise<ForecastPoint[]> {
  const rows = await getJson<Array<{ point: ForecastPoint }>>(`${SUPABASE_URL}/rest/v1/forecast_runs?resort_id=eq.${resortId}&select=point&limit=200`);
  return [...new Set(rows.map((r) => r.point))].sort() as ForecastPoint[];
}

async function writeScores(resortId: string, scores: ModelScore[]): Promise<void> {
  const computedAt = new Date().toISOString();
  const rows = scores.map((s) => ({
    resort_id: resortId,
    model: s.model,
    period_days: SCORE_PERIOD_DAYS,
    day1_mae: s.day1Mae,
    day3_mae: s.day3Mae,
    day7_mae: s.day7Mae,
    samples: s.samples,
    bias_ratio: s.biasRatio,
    computed_at: computedAt,
  }));
  if (rows.length) {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/forecast_scores`, {
      method: "POST",
      headers: { ...supaHeaders, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(rows),
    });
    if (!resp.ok) throw new Error(`forecast_scores upsert failed: ${resp.status} ${await resp.text()}`);
  }
  // Rewrite semantics: a model that no longer has pairs loses its row.
  const keep = rows.map((r) => `"${r.model}"`).join(",");
  const del = await fetch(
    `${SUPABASE_URL}/rest/v1/forecast_scores?resort_id=eq.${resortId}&period_days=eq.${SCORE_PERIOD_DAYS}${keep ? `&model=not.in.(${keep})` : ""}`,
    { method: "DELETE", headers: supaHeaders },
  );
  if (!del.ok) throw new Error(`forecast_scores cleanup failed: ${del.status} ${await del.text()}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const startedAt = new Date();
  const since = addDays(startedAt.toISOString().slice(0, 10), -SCORE_PERIOD_DAYS);
  console.log(`[forecast-score] ${startedAt.toISOString()} window ${since} → today (${SCORE_PERIOD_DAYS} d)${dryRun ? " (DRY RUN)" : ""}${onlySlug ? ` resort=${onlySlug}` : ""}`);

  const resorts = await fetchResorts();
  console.log(`[forecast-score] ${resorts.length} active resort(s)`);

  let scored = 0;
  let noTruth = 0;
  let noRuns = 0;
  let failed = 0;

  for (const resort of resorts) {
    try {
      // 1. Measured series and its basis.
      let series: MeasuredSeries | null = null;
      let basis: TruthBasis | null = null;
      let stationElevationFt: number | null = null;
      if (resort.snotel_station_id) {
        series = measuredFromDepth(await fetchDepthRows(resort.id, since));
        basis = "snotel";
        stationElevationFt = STATION_INDEX[resort.snotel_station_id]?.elevationFt ?? null;
      } else {
        const ghcn = await fetchGhcnSeries(resort.id, since);
        if (ghcn) {
          series = ghcn.series;
          basis = "ghcn";
          stationElevationFt = ghcn.stationElevationFt;
        }
      }
      if (!series || series.size === 0) {
        noTruth++;
        console.log(`  SKIP ${resort.name} — no measured series`);
        continue;
      }

      // 2. The stored point to grade.
      const points = await availablePoints(resort.id);
      if (!points.length) {
        noRuns++;
        console.log(`  SKIP ${resort.name} — no stored runs yet (${series.size} measured days, ${basis})`);
        continue;
      }
      const point = scoredPointFor(resort, stationElevationFt, points);
      const runs = await fetchRuns(resort.id, point, since);

      // 3. Pair, score, write.
      const pairs = withBlendPairs(pairForecasts(series, runs));
      const scores = scoreModels(pairs);
      if (!dryRun) await writeScores(resort.id, scores);
      scored++;
      const best = scores[0];
      console.log(
        `  OK   ${resort.name} — ${basis}, ${series.size} measured days, ${point} point, ${runs.length} runs, ${pairs.length} pairs → ${scores.length} rows` +
          (best ? `; best ${modelLabel(best.model)} (day-1 MAE ${best.day1Mae ?? "–"} cm, bias ${best.biasRatio ?? "–"})` : "; nothing to grade yet"),
      );
    } catch (err) {
      failed++;
      console.error(`  FAIL ${resort.name} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n[forecast-score] Done. ${scored} scored, ${noTruth} without a measured series, ${noRuns} without runs, ${failed} failed (of ${resorts.length}).`);
  if (failed > 0 && failed === resorts.length) process.exit(1);
}

main().catch((err) => {
  console.error("[forecast-score] Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
