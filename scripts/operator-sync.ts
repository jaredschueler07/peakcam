#!/usr/bin/env tsx

/**
 * operator-sync.ts
 * ────────────────
 * Operator lift status (parity plan block P6). For every resort that
 * data/operator-sources.json maps to a Liftie id, fetch Liftie's parsed copy
 * of the operator's lift-status page and append one `operator_status` row
 * (migration 031), idempotent on (resort, source, observed_at). The
 * conditions contract reads the newest row per resort through
 * `latest_operator_status`; `snow_reports` is never touched.
 *
 * Usage:
 *   npx tsx scripts/operator-sync.ts                    # every mapped resort, writes
 *   npx tsx scripts/operator-sync.ts --dry-run          # fetch and print, write nothing
 *   npx tsx scripts/operator-sync.ts --resort alta      # one resort (combine with --dry-run)
 *
 * Schedule: launchd `com.peakcam.operator-sync`, 06:00 and 11:00 local on the
 * Mac mini (the 11:00 read catches lifts that have opened; the 06:00 read
 * carries the day's `scheduled` list).
 *
 * Reads:  .env.local (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
 *         A dry run needs no service key: it reads the catalogue with the
 *         anon key when present, else from data/resorts.csv.
 * Writes: operator_status (service role).
 *
 * Exit codes: 0 after any run that could reach the feed; 2 when every
 * fetch was refused by the Cloudflare challenge in front of liftie.info
 * (observed from the Air and the mini on 2026-10-20), so the launchd log
 * shows the block rather than a quiet "0 written".
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseCsv } from "csv-parse/sync";

import { fetchLiftieResort, liftiePairs, operatorStatusRow, type LiftieFetchFailure, type OperatorSourceMap } from "../lib/operators/liftie.js";

// ─── Env ──────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadEnv(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf-8").split("\n")) {
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
const DRY_RUN = args.includes("--dry-run");
const resortArg = args.indexOf("--resort");
const ONLY_SLUG = resortArg >= 0 ? args[resortArg + 1] : null;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!DRY_RUN && (!SUPABASE_URL || !SERVICE_KEY)) {
  console.error("Missing env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (or pass --dry-run).");
  process.exit(1);
}

const writeHeaders = {
  apikey: SERVICE_KEY ?? "",
  Authorization: `Bearer ${SERVICE_KEY ?? ""}`,
  "Content-Type": "application/json",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Liftie caches server-side for a minute; a short pause keeps the run polite. */
const PAUSE_MS = 400;

// ─── Resorts ──────────────────────────────────────────────────────────────

interface ResortRow {
  id: string;
  slug: string;
  name: string;
}

async function fetchResorts(): Promise<ResortRow[]> {
  const key = SERVICE_KEY ?? ANON_KEY;
  if (SUPABASE_URL && key) {
    let url = `${SUPABASE_URL}/rest/v1/resorts?select=id,slug,name&is_active=eq.true&order=slug`;
    if (ONLY_SLUG) url += `&slug=eq.${encodeURIComponent(ONLY_SLUG)}`;
    const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`Supabase resorts fetch failed: ${res.status}`);
    return (await res.json()) as ResortRow[];
  }
  const csv = fs.readFileSync(path.join(ROOT, "data", "resorts.csv"), "utf-8");
  const rows = parseCsv(csv, { columns: true, skip_empty_lines: true, relax_column_count: true }) as Record<string, string>[];
  return rows
    .filter((r) => r.is_active !== "false" && (!ONLY_SLUG || r.slug === ONLY_SLUG))
    .map((r) => ({ id: `csv:${r.slug}`, slug: r.slug, name: r.name }));
}

function loadSources(): OperatorSourceMap {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "data", "operator-sources.json"), "utf-8")) as OperatorSourceMap;
}

// ─── Writes ───────────────────────────────────────────────────────────────

async function insertRow(row: ReturnType<typeof operatorStatusRow>): Promise<"inserted" | "duplicate"> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/operator_status?on_conflict=resort_id,source,observed_at`, {
    method: "POST",
    headers: { ...writeHeaders, Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`operator_status insert failed (${res.status}): ${await res.text()}`);
  const inserted = (await res.json()) as unknown[];
  return inserted.length ? "inserted" : "duplicate";
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const now = new Date();
  console.log(`[operator-sync] ${DRY_RUN ? "DRY RUN — " : ""}starting${ONLY_SLUG ? ` for ${ONLY_SLUG}` : ""}`);
  const sources = loadSources();
  const pairs = liftiePairs(sources);
  const resorts = await fetchResorts();
  const bySlug = new Map(resorts.map((r) => [r.slug, r]));
  const targets = pairs.filter((p) => bySlug.has(p.slug) && (!ONLY_SLUG || p.slug === ONLY_SLUG));
  if (!targets.length) {
    console.error(`[operator-sync] no mapped resort${ONLY_SLUG ? ` matching "${ONLY_SLUG}" (add it to data/operator-sources.json)` : ""}`);
    process.exit(1);
  }
  console.log(`[operator-sync] ${targets.length} resorts mapped to Liftie (${pairs.length} in data/operator-sources.json, ${resorts.length} active resorts)\n`);

  let inserted = 0;
  let duplicates = 0;
  let noLifts = 0;
  const failures = new Map<LiftieFetchFailure, number>();
  const sample: string[] = [];

  for (const { slug, liftieId } of targets) {
    const resort = bySlug.get(slug)!;
    const result = await fetchLiftieResort(liftieId, { now: () => now });
    if (!result.ok) {
      failures.set(result.reason, (failures.get(result.reason) ?? 0) + 1);
      if (sample.length < 3) sample.push(`${slug}: ${result.reason}${result.status ? ` ${result.status}` : ""} — ${result.detail}`);
      console.log(`  FAIL ${resort.name} (${liftieId}) — ${result.reason}${result.status ? ` ${result.status}` : ""}`);
      // One challenge means every request from this host is challenged; stop hammering the edge.
      if (result.reason === "blocked" && failures.get("blocked") === 3 && failures.size === 1 && inserted + duplicates + noLifts === 0) {
        console.log("  three challenges in a row with no success; stopping this run");
        break;
      }
      await sleep(PAUSE_MS);
      continue;
    }
    const { report } = result;
    const row = operatorStatusRow(resort.id, report, now);
    const s = report.stats;
    const counts = s.total ? `${s.open} open, ${s.hold} hold, ${s.scheduled} scheduled, ${s.closed} closed of ${s.total}` : "no lifts listed";
    if (!s.total) noLifts++;
    const age = Math.round((now.getTime() - Date.parse(report.observedAt)) / 60_000);
    console.log(`  OK   ${resort.name} (${liftieId}) — ${counts}; status ${age} min old${report.openingDate ? `; opening ${report.openingDate}` : ""}`);
    if (!DRY_RUN) {
      const outcome = await insertRow(row);
      if (outcome === "inserted") inserted++;
      else duplicates++;
    }
    await sleep(PAUSE_MS);
  }

  const failed = [...failures.entries()].map(([k, n]) => `${k} ${n}`).join(", ");
  console.log(
    `\n[operator-sync] Done. ${targets.length} resorts: ${DRY_RUN ? "nothing written (dry run)" : `${inserted} rows inserted, ${duplicates} already stored`}, ${noLifts} with no lifts listed, failures: ${failed || "none"}.`,
  );
  if (sample.length) console.log(`[operator-sync] First failures: ${sample.join(" | ")}`);
  const blocked = failures.get("blocked") ?? 0;
  if (blocked > 0 && inserted + duplicates + noLifts === 0) {
    console.error("[operator-sync] Every fetch was refused by the Cloudflare challenge in front of liftie.info; no operator status this run. See docs/runbook.md 'Operator status'.");
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("[operator-sync] Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
