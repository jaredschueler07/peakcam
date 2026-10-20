#!/usr/bin/env tsx

/**
 * forecast-sync.ts
 * ────────────────
 * Multi-model forecast sync (parity plan block P4). For every active resort,
 * one Open-Meteo call per point (summit and base when both elevations are
 * known) asking for every model at once, then one `forecast_runs` row per
 * model per point with its `forecast_daily` rows. Idempotent per
 * (resort, point, model, issue hour): re-running inside the same UTC hour
 * writes nothing new.
 *
 * Retention (runs only on the first run of each UTC day, or with --prune):
 *   - older than 7 days: keep the newest run per (resort, point, model, UTC day)
 *     — the scorer grades the day's newest run, so the others are dead weight;
 *   - older than 120 days: delete, except the newest run per (resort, point,
 *     model) so a model that stopped updating still has a row.
 *
 * Usage:
 *   npx tsx scripts/forecast-sync.ts                 # every active resort
 *   npx tsx scripts/forecast-sync.ts --resort alta   # one resort
 *   npx tsx scripts/forecast-sync.ts --dry-run       # fetch and blend, write nothing
 *   npx tsx scripts/forecast-sync.ts --prune         # force the retention pass
 *   npx tsx scripts/forecast-sync.ts --no-prune      # skip it
 *
 * Reads:  .env.local (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY;
 *         --dry-run needs only NEXT_PUBLIC_SUPABASE_ANON_KEY to read resorts)
 * Writes: forecast_runs, forecast_daily (service role; migration 027)
 *
 * Volume: 148 resorts × ≤2 points = ≤296 Open-Meteo calls per run, 4 runs a
 * day ≈ 1,200 calls/day (≈ 2,600 at 320 resorts). Open-Meteo weights a
 * multi-model 14-day daily request as several "calls" — see the runbook.
 *
 * Attribution: Weather data by Open-Meteo.com (CC BY 4.0). Every surface
 * that serves these rows carries the credit (lib/public-api/forecast.ts).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  fetchModelRuns,
  modelLabel,
  modelsForCountry,
  resortPoints,
  type ModelRun,
  type ResortPoint,
} from "../lib/forecast/open-meteo-models.js";
import { blendRuns } from "../lib/forecast/blend.js";
import { issueHour, type ForecastRunRow } from "../lib/forecast/store.js";
import { DELETE_AFTER_DAYS, THIN_AFTER_DAYS, selectRunsToDelete } from "../lib/forecast/retention.js";

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
const forcePrune = args.includes("--prune");
const noPrune = args.includes("--no-prune");
const resortArgIdx = args.indexOf("--resort");
const onlySlug = resortArgIdx >= 0 ? args[resortArgIdx + 1] : null;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// A dry run reads the catalogue with the anon key (public-read) and writes
// nothing, so a dev box without the service-role key can still exercise the
// Open-Meteo path end to end.
const READ_KEY = dryRun ? (ANON_KEY ?? SERVICE_KEY) : SERVICE_KEY;
if (!SUPABASE_URL || !READ_KEY || (!dryRun && !SERVICE_KEY)) {
  console.error(
    dryRun
      ? "Missing env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local"
      : "Missing env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(1);
}

const readHeaders = { apikey: READ_KEY, Authorization: `Bearer ${READ_KEY}` };
const writeHeaders = { apikey: SERVICE_KEY ?? "", Authorization: `Bearer ${SERVICE_KEY ?? ""}`, "Content-Type": "application/json" };

// ─── Constants ────────────────────────────────────────────────────────────

/** Pause between Open-Meteo calls (their limit is 600/min; this keeps a full run near 1/s). */
const CALL_GAP_MS = 150;
const DELETE_CHUNK = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Types ────────────────────────────────────────────────────────────────

interface SyncResort {
  id: string;
  slug: string;
  name: string;
  country: string | null;
  lat: number;
  lng: number;
  elevation_summit_ft: number | null;
  elevation_base_ft: number | null;
}

// ─── Supabase I/O (PostgREST) ─────────────────────────────────────────────

async function fetchResorts(): Promise<SyncResort[]> {
  let url =
    `${SUPABASE_URL}/rest/v1/resorts?select=id,slug,name,country,lat,lng,elevation_summit_ft,elevation_base_ft` +
    `&is_active=eq.true&order=slug`;
  if (onlySlug) url += `&slug=eq.${encodeURIComponent(onlySlug)}`;
  const resp = await fetch(url, { headers: readHeaders });
  if (!resp.ok) throw new Error(`Supabase resorts fetch failed: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

/** (point, model) pairs already written for this resort at this issue hour. */
async function existingRunKeys(resortId: string, issuedAt: string): Promise<Set<string>> {
  const url = `${SUPABASE_URL}/rest/v1/forecast_runs?resort_id=eq.${resortId}&issued_at=eq.${encodeURIComponent(issuedAt)}&select=point,model`;
  const resp = await fetch(url, { headers: writeHeaders });
  if (!resp.ok) throw new Error(`forecast_runs read failed: ${resp.status}`);
  const rows = (await resp.json()) as Array<{ point: string; model: string }>;
  return new Set(rows.map((r) => `${r.point}:${r.model}`));
}

async function insertRun(resortId: string, point: ResortPoint["point"], run: ModelRun, issuedAt: string): Promise<void> {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/forecast_runs`, {
    method: "POST",
    headers: { ...writeHeaders, Prefer: "return=representation" },
    body: JSON.stringify({ resort_id: resortId, point, model: run.model, issued_at: issuedAt, horizon_days: run.horizonDays }),
  });
  if (!resp.ok) throw new Error(`forecast_runs insert failed: ${resp.status} ${await resp.text()}`);
  const [row] = (await resp.json()) as Array<{ id: string }>;
  const daily = run.daily.map((d) => ({
    run_id: row.id,
    date: d.date,
    snowfall_cm: d.snowfallCm,
    snowfall_lo: null,
    snowfall_hi: null,
    temp_max: d.tempMaxC,
    temp_min: d.tempMinC,
    precip_prob: d.precipProb,
    wind_gust: d.windGustKmh,
    weather_code: d.weatherCode,
  }));
  const dailyResp = await fetch(`${SUPABASE_URL}/rest/v1/forecast_daily`, {
    method: "POST",
    headers: { ...writeHeaders, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(daily),
  });
  if (!dailyResp.ok) throw new Error(`forecast_daily insert failed: ${dailyResp.status} ${await dailyResp.text()}`);
}

// ─── Retention ────────────────────────────────────────────────────────────

// Which old runs to delete: lib/forecast/retention.ts (pure, tested).

async function pruneResort(resortId: string, now: Date): Promise<number> {
  const thinCutoff = new Date(now.getTime() - THIN_AFTER_DAYS * 86_400_000).toISOString();
  const deleteCutoff = new Date(now.getTime() - DELETE_AFTER_DAYS * 86_400_000).toISOString();
  const oldResp = await fetch(
    `${SUPABASE_URL}/rest/v1/forecast_runs?resort_id=eq.${resortId}&issued_at=lt.${encodeURIComponent(thinCutoff)}&select=id,resort_id,point,model,issued_at,horizon_days&order=issued_at.desc&limit=20000`,
    { headers: writeHeaders },
  );
  if (!oldResp.ok) throw new Error(`prune read failed: ${oldResp.status}`);
  const old = (await oldResp.json()) as ForecastRunRow[];
  if (!old.length) return 0;
  const recentResp = await fetch(
    `${SUPABASE_URL}/rest/v1/forecast_runs?resort_id=eq.${resortId}&issued_at=gte.${encodeURIComponent(deleteCutoff)}&select=point,model`,
    { headers: writeHeaders },
  );
  if (!recentResp.ok) throw new Error(`prune recent read failed: ${recentResp.status}`);
  const recentKeys = new Set(((await recentResp.json()) as Array<{ point: string; model: string }>).map((r) => `${r.point}:${r.model}`));
  const ids = selectRunsToDelete(old, recentKeys, now);
  for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
    const chunk = ids.slice(i, i + DELETE_CHUNK);
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/forecast_runs?id=in.(${chunk.join(",")})`, { method: "DELETE", headers: writeHeaders });
    if (!resp.ok) throw new Error(`prune delete failed: ${resp.status} ${await resp.text()}`);
  }
  return ids.length;
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const startedAt = new Date();
  const issuedAt = issueHour(startedAt);
  console.log(`[forecast-sync] ${startedAt.toISOString()} issue hour ${issuedAt}${dryRun ? " (DRY RUN)" : ""}${onlySlug ? ` resort=${onlySlug}` : ""}`);

  const resorts = await fetchResorts();
  if (!resorts.length) {
    console.log("[forecast-sync] no matching active resorts");
    return;
  }
  console.log(`[forecast-sync] ${resorts.length} resort(s)`);

  let calls = 0;
  let runsWritten = 0;
  let runsSkipped = 0;
  let pointsFailed = 0;
  let resortsFailed = 0;

  for (const resort of resorts) {
    try {
      const points = resortPoints(resort);
      const models = modelsForCountry(resort.country);
      const existing = dryRun ? new Set<string>() : await existingRunKeys(resort.id, issuedAt);
      const perPoint: string[] = [];
      for (const pt of points) {
        const wanted = models.filter((m) => !existing.has(`${pt.point}:${m}`));
        if (!wanted.length) {
          runsSkipped += models.length;
          perPoint.push(`${pt.point}: already written`);
          continue;
        }
        calls++;
        const runs = await fetchModelRuns({ lat: resort.lat, lng: resort.lng, elevationFt: pt.elevationFt, models: wanted });
        await sleep(CALL_GAP_MS);
        if (!runs) {
          pointsFailed++;
          perPoint.push(`${pt.point}: Open-Meteo failed`);
          continue;
        }
        if (!dryRun) {
          for (const run of runs) {
            await insertRun(resort.id, pt.point, run, issuedAt);
            runsWritten++;
          }
        } else {
          runsWritten += runs.length;
        }
        const blend = blendRuns(runs);
        perPoint.push(
          `${pt.point}${pt.elevationFt != null ? ` ${pt.elevationFt} ft` : ""}: ${runs.length} models (${runs.map((r) => `${modelLabel(r.model)} ${r.horizonDays}d`).join(", ")}) → 48h ${blend.next48hCm} cm, 7d ${blend.total7dCm} cm, 14d ${blend.total14dCm} cm${blend.peak ? `, peak ${blend.peak.cm} cm on ${blend.peak.date} (${blend.peak.windowDays} d)` : ""}`,
        );
        if (dryRun) {
          for (const d of blend.days) {
            console.log(`    ${d.date}  ${String(d.snowfallCm).padStart(5)} cm  [${d.snowfallLoCm}–${d.snowfallHiCm}]  ${d.modelCount} models  ${d.tempMaxC ?? "–"}/${d.tempMinC ?? "–"} °C  code ${d.weatherCode ?? "–"}`);
          }
        }
      }
      console.log(`  OK   ${resort.name}\n       ${perPoint.join("\n       ")}`);
    } catch (err) {
      resortsFailed++;
      console.error(`  FAIL ${resort.name} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Retention: once a day (the first run after 00:00 UTC) or on request.
  const shouldPrune = !dryRun && !noPrune && (forcePrune || startedAt.getUTCHours() < 6);
  let pruned = 0;
  if (shouldPrune) {
    for (const resort of resorts) {
      try {
        pruned += await pruneResort(resort.id, startedAt);
      } catch (err) {
        console.error(`  PRUNE FAIL ${resort.name} — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  console.log(
    `\n[forecast-sync] Done. ${resorts.length} resorts, ${calls} Open-Meteo calls, ${runsWritten} runs ${dryRun ? "would be " : ""}written, ${runsSkipped} already present, ${pointsFailed} points failed, ${resortsFailed} resorts failed${shouldPrune ? `, ${pruned} old runs pruned` : ""}. Weather data by Open-Meteo.com (CC BY 4.0).`,
  );
  if (resortsFailed > 0 && resortsFailed === resorts.length) process.exit(1);
}

main().catch((err) => {
  console.error("[forecast-sync] Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
