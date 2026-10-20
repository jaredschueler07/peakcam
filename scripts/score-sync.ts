#!/usr/bin/env tsx

/**
 * score-sync.ts
 * ─────────────
 * The PeakCam Snow Score (parity plan block P7). For every active resort,
 * builds the scorer's inputs for one day from the rows the other jobs have
 * already written — the day's newest `snow_reports` row, the trailing
 * `snowpack_daily` rows (7-day new snow, days since snow, 3-day high), the
 * stored multi-model forecast runs issued that day (`forecast_runs` +
 * `forecast_daily`, blended with lib/forecast/blend.ts) and the P6 derived
 * operating status from `resort_openings` and `latest_operator_status` —
 * runs the pure lib/score.ts and upserts one `resort_scores` row per resort
 * per day (idempotent on (resort_id, date)).
 *
 * Usage:
 *   npx tsx scripts/score-sync.ts                      # today, every resort
 *   npx tsx scripts/score-sync.ts --resort alta        # one resort
 *   npx tsx scripts/score-sync.ts --dry-run            # score, write nothing (anon key is enough)
 *   npx tsx scripts/score-sync.ts --backfill 30        # the 30 days ending today, from the stored rows
 *
 * Reads:  .env.local (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY;
 *         NEXT_PUBLIC_SUPABASE_ANON_KEY suffices for --dry-run)
 * Writes: resort_scores (service role; migration 028)
 *
 * Schedule: launchd `com.peakcam.score-sync`, 07:45 and 19:45 local on the
 * Mini — after the morning snotel-sync / model-sync runs and the 07:30
 * forecast scorer, and again after the afternoon forecast-sync so the
 * 7-day-forecast component tracks the newest runs. Both runs write the same
 * date row. Decoupled from the syncs on purpose, like forecast-score: a
 * failed fetch upstream never blocks the score, and the score never blocks a
 * sync. A day is the Mountain-time calendar day, the same day the history
 * pages count in.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SCORED_BY, SCORE_VERSION, buildScoreInput, computeScore, type ScoreDailyRow, type ScoreReportRow, type ScoreResult } from "../lib/score.js";
import { deriveStatus, type OperatorReport } from "../lib/conditions-contract.js";
import type { ResortOpening } from "../lib/openings.js";
import { blendRuns } from "../lib/forecast/blend.js";
import { assembleStoredRuns, type ForecastDailyRow, type ForecastRunRow, type StoredRun } from "../lib/forecast/store.js";
import { addDays } from "../lib/snow-history.js";
import { PCT_OF_NORMAL_MAX, PCT_OF_NORMAL_MIN, PCT_OF_NORMAL_MIN_SWE_IN } from "../lib/resort-copy.js";

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

// ─── Parse args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const resortArgIdx = args.indexOf("--resort");
const onlySlug = resortArgIdx >= 0 ? args[resortArgIdx + 1] : null;
const backfillIdx = args.indexOf("--backfill");
const backfillDays = backfillIdx >= 0 ? Math.max(1, Math.min(366, Number(args[backfillIdx + 1]) || 0)) : 1;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const KEY = SERVICE_KEY ?? (dryRun ? ANON_KEY : undefined);

if (!SUPABASE_URL || !KEY) {
  console.error("Missing env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (the anon key is enough for --dry-run).");
  process.exit(1);
}

const supaHeaders = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

/** Pause between resorts so a 148-resort run does not starve the burstable database. */
const PACE_MS = 150;
const IN_CHUNK = 60;
/** A report counts for a day when it was written on that day or the two before it (a silent station carries forward, labelled by its own time). */
const REPORT_MAX_AGE_DAYS = 2;
/** Daily rows needed behind the first scored day: a 7-day sum and "days since snow" up to two weeks back. */
const DAILY_LOOKBACK_DAYS = 14;

// ─── Dates (Mountain time, where the stations' days are counted) ──────────

const MT_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" });

function mountainDay(instant: Date | string): string {
  const d = instant instanceof Date ? instant : new Date(instant);
  return MT_DAY.format(d);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Types ────────────────────────────────────────────────────────────────

interface ScoreResort {
  id: string;
  slug: string;
  name: string;
  state: string;
  country: string;
  lat: number;
  lng: number;
  snotel_station_id: string | null;
}

interface ReportRow {
  source: string;
  updated_at: string;
  base_depth: number | string | null;
  new_snow_24h: number | string | null;
  new_snow_48h: number | string | null;
  swe_in: number | string | null;
  pct_of_normal: number | string | null;
  conditions: string | null;
}

interface DailyRowRaw {
  date: string;
  station_id: string;
  snow_depth_in: number | string | null;
  swe_in: number | string | null;
  new_snow_in: number | string | null;
  temp_max_f: number | string | null;
  qc_flag: string;
}

interface OperatorRow {
  resort_id: string;
  source: string;
  source_id: string;
  observed_at: string;
  lifts_open: number | null;
  lifts_hold: number | null;
  lifts_scheduled: number | null;
  lifts_closed: number | null;
  lifts_total: number | null;
  trails_open: number | null;
  trails_total: number | null;
  base_depth_in: number | null;
  surface: string | null;
  opening_date: string | null;
  verified: boolean;
}

// ─── Supabase I/O (PostgREST) ─────────────────────────────────────────────

async function getJson<T>(url: string): Promise<T> {
  const resp = await fetch(url, { headers: supaHeaders });
  if (!resp.ok) throw new Error(`${resp.status} ${await resp.text()} — ${url.slice(0, 140)}`);
  return resp.json() as Promise<T>;
}

/** Null (not a throw) for a table or view that is not there yet. */
async function getJsonSoft<T>(url: string): Promise<T | null> {
  try {
    return await getJson<T>(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/^404 |PGRST205|42P01/.test(msg)) return null;
    throw err;
  }
}

async function fetchResorts(): Promise<ScoreResort[]> {
  let url = `${SUPABASE_URL}/rest/v1/resorts?select=id,slug,name,state,country,lat,lng,snotel_station_id&is_active=eq.true&order=slug`;
  if (onlySlug) url += `&slug=eq.${encodeURIComponent(onlySlug)}`;
  return getJson<ScoreResort[]>(url);
}

async function fetchOpenings(): Promise<Map<string, ResortOpening>> {
  const rows = (await getJsonSoft<ResortOpening[]>(`${SUPABASE_URL}/rest/v1/resort_openings?select=*`)) ?? [];
  return new Map(rows.map((r) => [r.resort_id, r]));
}

async function fetchOperators(): Promise<Map<string, OperatorRow>> {
  const rows = (await getJsonSoft<OperatorRow[]>(`${SUPABASE_URL}/rest/v1/latest_operator_status?select=*`)) ?? [];
  return new Map(rows.map((r) => [r.resort_id, r]));
}

async function fetchReports(resortId: string, since: string): Promise<ReportRow[]> {
  return getJson<ReportRow[]>(
    `${SUPABASE_URL}/rest/v1/snow_reports?resort_id=eq.${resortId}&updated_at=gte.${addDays(since, -REPORT_MAX_AGE_DAYS)}T00:00:00Z&select=source,updated_at,base_depth,new_snow_24h,new_snow_48h,swe_in,pct_of_normal,conditions&order=updated_at.asc&limit=2000`,
  );
}

async function fetchDaily(resort: ScoreResort, since: string): Promise<DailyRowRaw[]> {
  const station = resort.snotel_station_id ? "&station_id=neq.open-meteo" : "";
  return getJson<DailyRowRaw[]>(
    `${SUPABASE_URL}/rest/v1/snowpack_daily?resort_id=eq.${resort.id}${station}&date=gte.${addDays(since, -DAILY_LOOKBACK_DAYS)}&select=date,station_id,snow_depth_in,swe_in,new_snow_in,temp_max_f,qc_flag&order=date.asc&limit=1000`,
  );
}

/** Every run issued inside the window (plus the day before it) at the summit point, or the base point when no summit run exists, with its daily rows from `since` on. */
async function fetchRuns(resortId: string, since: string): Promise<StoredRun[]> {
  const runs = (await getJsonSoft<ForecastRunRow[]>(
    `${SUPABASE_URL}/rest/v1/forecast_runs?resort_id=eq.${resortId}&issued_at=gte.${addDays(since, -1)}T00:00:00Z&select=id,resort_id,point,model,issued_at,horizon_days&order=issued_at.desc&limit=5000`,
  )) ?? [];
  if (!runs.length) return [];
  const point = runs.some((r) => r.point === "summit") ? "summit" : "base";
  const picked = runs.filter((r) => r.point === point);
  const daily: ForecastDailyRow[] = [];
  for (let i = 0; i < picked.length; i += IN_CHUNK) {
    const ids = picked.slice(i, i + IN_CHUNK).map((r) => r.id);
    daily.push(
      ...(await getJson<ForecastDailyRow[]>(
        `${SUPABASE_URL}/rest/v1/forecast_daily?run_id=in.(${ids.join(",")})&date=gte.${since}&select=run_id,date,snowfall_cm,snowfall_lo,snowfall_hi,temp_max,temp_min,precip_prob,wind_gust,weather_code&limit=20000`,
      )),
    );
  }
  return assembleStoredRuns(picked, daily);
}

async function writeScores(resortId: string, results: ScoreResult[]): Promise<void> {
  const rows = results.map((r) => ({
    resort_id: resortId,
    date: r.date,
    score: r.score,
    rating: r.rating,
    components: r.components,
    scored_by: SCORED_BY,
  }));
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/resort_scores?on_conflict=resort_id,date`, {
    method: "POST",
    headers: { ...supaHeaders, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(rows),
  });
  if (!resp.ok) throw new Error(`resort_scores upsert failed: ${resp.status} ${await resp.text()}`);
}

// ─── Per-day inputs ───────────────────────────────────────────────────────

const num = (v: number | string | null | undefined): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** `"tag1,tag2||narrative"` → tags (the same split lib/public-api/serialize.ts makes). */
function tagsOf(conditions: string | null): string[] {
  if (!conditions) return [];
  const head = conditions.includes("||") ? conditions.split("||")[0] : conditions;
  return head.split(",").map((t) => t.trim()).filter(Boolean);
}

/** The publishable percent of normal (lib/resort-copy.ts rule): a station report, SWE ≥ 2 in, inside 10–300 %. */
function publishablePct(row: ReportRow, hasStation: boolean): number | null {
  if (!hasStation || row.source !== "snotel") return null;
  const pct = num(row.pct_of_normal);
  const swe = num(row.swe_in);
  if (pct == null || swe == null || swe < PCT_OF_NORMAL_MIN_SWE_IN) return null;
  if (pct < PCT_OF_NORMAL_MIN || pct > PCT_OF_NORMAL_MAX) return null;
  return pct;
}

/** The newest report written on `day` or the two days before it, as the scorer reads it. */
function reportForDay(reports: readonly ReportRow[], day: string, hasStation: boolean): ScoreReportRow | null {
  const floor = addDays(day, -REPORT_MAX_AGE_DAYS);
  let pick: ReportRow | null = null;
  for (const r of reports) {
    const d = mountainDay(r.updated_at);
    if (d > day || d < floor) continue;
    if (!pick || r.updated_at > pick.updated_at) pick = r;
  }
  if (!pick) return null;
  return {
    source: pick.source,
    updated_at: pick.updated_at,
    base_depth: pick.base_depth,
    new_snow_24h: pick.new_snow_24h,
    new_snow_48h: pick.new_snow_48h,
    pct_of_normal: publishablePct(pick, hasStation),
    tags: tagsOf(pick.conditions),
  };
}

function dailyRows(raw: readonly DailyRowRaw[]): ScoreDailyRow[] {
  return raw.map((r) => ({ date: r.date, snowDepthIn: num(r.snow_depth_in), sweIn: num(r.swe_in), newSnowIn: num(r.new_snow_in), qcFlag: r.qc_flag, tempMaxF: num(r.temp_max_f) }));
}

/** The blend for `day`: the newest run per model issued on `day` or the day before, with the days from `day` on. */
function forecastForDay(runs: readonly StoredRun[], day: string): { total7dCm: number; modelCount: number; tempMaxC: number | null } | null {
  const floor = addDays(day, -1);
  const best = new Map<string, StoredRun>();
  for (const run of runs) {
    const d = mountainDay(run.issuedAt);
    if (d > day || d < floor) continue;
    const cur = best.get(run.model);
    if (!cur || run.issuedAt > cur.issuedAt) best.set(run.model, run);
  }
  if (!best.size) return null;
  const blend = blendRuns([...best.values()].map((r) => ({ model: r.model, daily: r.daily.filter((d) => d.date >= day) })));
  if (!blend.days.length) return null;
  return { total7dCm: blend.total7dCm, modelCount: blend.modelCount, tempMaxC: blend.days[0].tempMaxC };
}

function operatorReport(row: OperatorRow | undefined): OperatorReport | null {
  if (!row?.observed_at) return null;
  return {
    source: row.source,
    sourceId: row.source_id,
    observedAt: row.observed_at,
    liftsOpen: row.lifts_open,
    liftsHold: row.lifts_hold,
    liftsScheduled: row.lifts_scheduled,
    liftsClosed: row.lifts_closed,
    liftsTotal: row.lifts_total,
    trailsOpen: row.trails_open,
    trailsTotal: row.trails_total,
    baseDepthIn: row.base_depth_in,
    surface: row.surface,
    openingDate: row.opening_date,
    verified: Boolean(row.verified),
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const now = new Date();
  const today = mountainDay(now);
  const days: string[] = [];
  for (let i = backfillDays - 1; i >= 0; i--) days.push(addDays(today, -i));
  const since = days[0];
  console.log(`[score-sync] ${now.toISOString()} ${SCORE_VERSION} days ${since} → ${today} (${days.length})${dryRun ? " (DRY RUN)" : ""}${onlySlug ? ` resort=${onlySlug}` : ""}`);

  const [resorts, openings, operators] = await Promise.all([fetchResorts(), fetchOpenings(), fetchOperators()]);
  console.log(`[score-sync] ${resorts.length} active resort(s), ${openings.size} opening rows, ${operators.size} operator rows`);

  let scored = 0;
  let failed = 0;
  let rowsWritten = 0;

  for (const resort of resorts) {
    try {
      const hasStation = Boolean(resort.snotel_station_id);
      const [reports, daily, runs] = await Promise.all([fetchReports(resort.id, since), fetchDaily(resort, since), fetchRuns(resort.id, since)]);
      const dailyTyped = dailyRows(daily);
      const opening = openings.get(resort.id) ?? null;
      const hemisphere = resort.lat < 0 ? "south" : "north";
      const results: ScoreResult[] = [];
      for (const day of days) {
        // The operator feed is an observation of now, so only today's row reads it; past days rest on the dates.
        const status = deriveStatus({ opening, hemisphere, localDate: day, operator: day === today ? operatorReport(operators.get(resort.id)) : null, now: day === today ? now : new Date(`${day}T23:59:59Z`) });
        const input = buildScoreInput({
          date: day,
          hasStation,
          report: reportForDay(reports, day, hasStation),
          daily: dailyTyped,
          forecast: forecastForDay(runs, day),
          status: { value: status.status, source: status.source === "operator" ? "operator" : status.source === "profile" ? "profile" : "none" },
        });
        results.push(computeScore(input));
      }
      if (!dryRun) await writeScores(resort.id, results);
      scored++;
      rowsWritten += results.length;
      const last = results[results.length - 1];
      const c = last.components;
      console.log(
        `  OK   ${resort.name} — ${last.date} score ${last.score} (${last.rating}): depth ${c.depthVsNormal.points}/${c.depthVsNormal.max} · 7d ${c.recentSnow7d.points}/${c.recentSnow7d.max} · fcst ${c.forecast7d.points}/${c.forecast7d.max} · quality ${c.snowQuality.points}/${c.snowQuality.max} · status ${c.operatingStatus.points}/${c.operatingStatus.max}` +
          (results.length > 1 ? ` · ${results.length} days ${results[0].score}→${last.score}` : "") +
          (dryRun ? " (not written)" : ""),
      );
    } catch (err) {
      failed++;
      console.error(`  FAIL ${resort.name} — ${err instanceof Error ? err.message : String(err)}`);
    }
    await sleep(PACE_MS);
  }

  console.log(`\n[score-sync] Done. ${scored} scored (${rowsWritten} rows${dryRun ? ", none written" : ""}), ${failed} failed (of ${resorts.length}).`);
  if (failed > 0 && failed === resorts.length) process.exit(1);
}

main().catch((err) => {
  console.error("[score-sync] Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
