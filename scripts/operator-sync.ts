#!/usr/bin/env tsx

/**
 * operator-sync.ts
 * ────────────────
 * Operator lift status (parity plan block P6). For every resort that
 * data/operator-sources.json maps to a Liftie id, read the operator's own
 * lift-status page or feed, parse it with Liftie's open-source parser and
 * append one `operator_status` row (migration 032). The conditions contract
 * reads the newest row per resort through `latest_operator_status`;
 * `snow_reports` is never touched.
 *
 * The fetching and parsing run in a child process (scripts/liftie-worker/)
 * that is given no secrets; this script only starts it and writes the rows.
 * liftie.info itself is no longer called: its API has refused scripts since
 * 2026-10-20. `--liftie-api` still takes that path, for the day it reopens.
 *
 * Usage:
 *   npx tsx scripts/operator-sync.ts                    # every mapped resort, writes
 *   npx tsx scripts/operator-sync.ts --dry-run          # fetch and print, write nothing
 *   npx tsx scripts/operator-sync.ts --resort alta      # one resort (combine with --dry-run)
 *   npx tsx scripts/operator-sync.ts --state CO         # one state or province
 *   npx tsx scripts/operator-sync.ts --only vail,keystone,breckenridge
 *
 * First use on a machine: `npm ci --prefix scripts/liftie-worker` (20 small
 * packages, about 3 MB, no install scripts).
 *
 * Polite by construction: one request at a time with a pause between them,
 * a User-Agent that names PeakCam (override with OPERATOR_SYNC_USER_AGENT),
 * and each operator's robots.txt honoured for the path fetched (read once
 * per host per day; a disallowed path is skipped and logged as `robots`).
 *
 * Schedule: launchd `com.peakcam.operator-sync`, 06:00 and 11:00 local on the
 * Mac mini (the 11:00 read catches lifts that have opened; the 06:00 read
 * carries the day's `scheduled` list).
 *
 * Reads:  .env.local (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
 *         A dry run needs no service key: it reads the catalogue with the
 *         anon key when present, else from data/resorts.csv.
 * Writes: operator_status (service role); resort_openings.feed_open and
 *         feed_open_evidence (migration 037) when the feed shows a resort's
 *         first sustained lift day of the season (lib/feed-opening.ts).
 *         `--no-feed-openings` skips the pass; a dry run prints what it
 *         would store.
 * Calls:  POST {SITE_URL}/api/alerts/feed-openings (Bearer CRON_SECRET from
 *         .env.local) on a run where some synced resort's feed_open is its
 *         local today, so its opening-alert subscribers get the same-day
 *         opening email. The route decides who is mailed from the database
 *         (lib/alerts/feed-opening-email.ts: same local day only, before the
 *         lifts close, once per resort per season) and the call carries no
 *         resort list. A dry run, `--no-feed-openings` or
 *         `--no-opening-emails` never calls it.
 *
 * Exit codes: 0 when at least one resort produced lift status (failures are
 * counted by class in the last lines); 1 when every resort failed, when the
 * worker's libraries are not installed, or on a fatal error.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseCsv } from "csv-parse/sync";

import { fetchLiftieResort, liftiePairs, operatorStatusRow, type LiftieReport, type OperatorSourceMap } from "../lib/operators/liftie.js";
import { OPERATOR_USER_AGENT, WORKER_NOT_INSTALLED, localResultToReport, runLiftieWorker, type LocalResult } from "../lib/operators/liftie-local.js";
import { detectFeedOpening, feedOpeningEvidence, type FeedOpeningOpening } from "../lib/feed-opening.js";
import type { OperatorReading } from "../lib/operator-day.js";
import { localDay, resortTimeZone } from "../lib/resort-timezone.js";
import { SITE_URL } from "../lib/site.js";

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
const argValue = (flag: string): string | null => {
  const at = args.indexOf(flag);
  return at >= 0 && args[at + 1] && !args[at + 1].startsWith("--") ? args[at + 1] : null;
};
const ONLY_SLUG = argValue("--resort");
const ONLY_STATE = argValue("--state")?.toUpperCase() ?? null;
const ONLY_LIST = argValue("--only")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
/** The old path: liftie.info's API, refused by its Cloudflare challenge since 2026-10-20. */
const USE_LIFTIE_API = args.includes("--liftie-api");
const USER_AGENT = process.env.OPERATOR_SYNC_USER_AGENT?.trim() || OPERATOR_USER_AGENT;
/** Skip the feed-opening pass (lib/feed-opening.ts) after the lift writes. */
const NO_FEED_OPENINGS = args.includes("--no-feed-openings");
const NO_OPENING_EMAILS = args.includes("--no-opening-emails");
const CRON_SECRET = process.env.CRON_SECRET;

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
/** Pause between two operator requests (nearly every resort is its own host). */
const PAUSE_MS = 500;

// ─── Resorts ──────────────────────────────────────────────────────────────

interface ResortRow {
  id: string;
  slug: string;
  name: string;
  state: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
}

async function fetchResorts(): Promise<ResortRow[]> {
  const key = SERVICE_KEY ?? ANON_KEY;
  if (SUPABASE_URL && key) {
    let url = `${SUPABASE_URL}/rest/v1/resorts?select=id,slug,name,state,country,lat,lng&is_active=eq.true&order=slug`;
    if (ONLY_SLUG) url += `&slug=eq.${encodeURIComponent(ONLY_SLUG)}`;
    const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`Supabase resorts fetch failed: ${res.status}`);
    return (await res.json()) as ResortRow[];
  }
  const csv = fs.readFileSync(path.join(ROOT, "data", "resorts.csv"), "utf-8");
  const rows = parseCsv(csv, { columns: true, skip_empty_lines: true, relax_column_count: true }) as Record<string, string>[];
  return rows
    .filter((r) => r.is_active !== "false" && (!ONLY_SLUG || r.slug === ONLY_SLUG))
    .map((r) => ({
      id: `csv:${r.slug}`,
      slug: r.slug,
      name: r.name,
      state: r.state || null,
      country: r.country || null,
      lat: r.lat ? Number(r.lat) : null,
      lng: r.lng ? Number(r.lng) : null,
    }));
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

// ─── Feed openings (migration 037, lib/feed-opening.ts) ───────────────────

/** How far back the pass reads the feed: the resort's today and yesterday. */
const FEED_OPENING_LOOKBACK_HOURS = 30;

interface OpeningsRow extends FeedOpeningOpening {
  resort_id: string;
}

interface StoredReading {
  resort_id: string;
  observed_at: string;
  lifts_open: number | null;
  lifts_scheduled: number | null;
  lifts_total: number | null;
  source_url: string | null;
}

function readHeaders(): Record<string, string> {
  const key = SERVICE_KEY ?? ANON_KEY ?? "";
  return { apikey: key, Authorization: `Bearer ${key}` };
}

/** PostgREST's "column does not exist": migration 037 has not been applied. */
async function isMissingColumn(res: Response): Promise<boolean> {
  if (res.status !== 400) return false;
  const body = await res.text();
  return body.includes("42703") || body.includes("feed_open");
}

/** Every resort_openings row with the feed columns, or null when migration 037 is missing. */
async function fetchOpeningsForFeed(): Promise<OpeningsRow[] | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/resort_openings?select=resort_id,season,projected_open,confirmed_open,closing_date,feed_open`, {
    headers: readHeaders(),
  });
  if (!res.ok) {
    if (await isMissingColumn(res)) return null;
    throw new Error(`resort_openings read failed (${res.status})`);
  }
  return (await res.json()) as OpeningsRow[];
}

/** The last FEED_OPENING_LOOKBACK_HOURS of readings for these resorts, paged past PostgREST's row cap. */
async function fetchRecentReadings(resortIds: string[], now: Date): Promise<Map<string, StoredReading[]>> {
  const since = new Date(now.getTime() - FEED_OPENING_LOOKBACK_HOURS * 3_600_000).toISOString();
  const out = new Map<string, StoredReading[]>();
  const PAGE = 1000;
  for (let i = 0; i < resortIds.length; i += 50) {
    const inList = resortIds.slice(i, i + 50).map((id) => encodeURIComponent(`"${id}"`)).join(",");
    for (let offset = 0; ; offset += PAGE) {
      const url =
        `${SUPABASE_URL}/rest/v1/operator_status?select=resort_id,observed_at,lifts_open,lifts_scheduled,lifts_total,source_url` +
        `&resort_id=in.(${inList})&observed_at=gte.${encodeURIComponent(since)}&order=resort_id,observed_at&limit=${PAGE}&offset=${offset}`;
      const res = await fetch(url, { headers: readHeaders() });
      if (!res.ok) throw new Error(`operator_status read failed (${res.status})`);
      const rows = (await res.json()) as StoredReading[];
      for (const row of rows) {
        const list = out.get(row.resort_id) ?? [];
        list.push(row);
        out.set(row.resort_id, list);
      }
      if (rows.length < PAGE) break;
    }
  }
  return out;
}

/** Stores the day only while the row still has none, so a stored feed opening never moves. */
async function storeFeedOpening(resortId: string, day: string, evidence: string, now: Date): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/resort_openings?resort_id=eq.${encodeURIComponent(resortId)}&feed_open=is.null`, {
    method: "PATCH",
    headers: { ...writeHeaders, Prefer: "return=representation" },
    body: JSON.stringify({ feed_open: day, feed_open_evidence: evidence, updated_at: now.toISOString() }),
  });
  if (!res.ok) throw new Error(`resort_openings feed_open update failed (${res.status}): ${await res.text()}`);
  return ((await res.json()) as unknown[]).length > 0;
}

/**
 * After the lift writes: for each synced resort, look at its last 30 h of
 * readings and store the first sustained, plausible lift day of the season
 * (lib/feed-opening.ts). Fails soft: any error here is logged and the run's
 * exit code is unchanged, because the lift rows are already stored.
 */
async function recordFeedOpenings(resorts: ResortRow[], now: Date): Promise<string[]> {
  const openingToday: string[] = [];
  if (NO_FEED_OPENINGS) return openingToday;
  if (!SUPABASE_URL || !(SERVICE_KEY ?? ANON_KEY)) {
    console.log("[operator-sync] Feed openings: no Supabase key, skipped.");
    return openingToday;
  }
  const real = resorts.filter((r) => !r.id.startsWith("csv:"));
  if (!real.length) return openingToday;
  try {
    const openings = await fetchOpeningsForFeed();
    if (!openings) {
      console.log("[operator-sync] Feed openings: resort_openings.feed_open is missing (apply migration 037); skipped.");
      return openingToday;
    }
    const byResort = new Map(openings.map((o) => [o.resort_id, o]));
    const readings = await fetchRecentReadings(real.map((r) => r.id), now);
    let stored = 0;
    for (const resort of real) {
      const timeZone = resortTimeZone({ state: resort.state ?? "", country: resort.country ?? "", lng: resort.lng ?? -105, lat: resort.lat });
      // Stored on an earlier run today: still today's opening (the route dedupes, so a retry is safe).
      if (byResort.get(resort.id)?.feed_open === localDay(now, timeZone)) {
        openingToday.push(resort.name);
        continue;
      }
      const rows = readings.get(resort.id) ?? [];
      if (!rows.length) continue;
      const verdict = detectFeedOpening({
        readings: rows.map((r): OperatorReading => ({ observedAt: r.observed_at, liftsOpen: r.lifts_open, liftsScheduled: r.lifts_scheduled, liftsTotal: r.lifts_total })),
        opening: byResort.get(resort.id) ?? null,
        timeZone,
        now,
        hemisphere: resort.lat != null && resort.lat < 0 ? "south" : "north",
      });
      if (!verdict.ok) continue;
      const sourceUrl = rows[rows.length - 1].source_url;
      const evidence = feedOpeningEvidence(verdict.opening, timeZone, sourceUrl);
      if (DRY_RUN) {
        console.log(`  FEED ${resort.name}: would store feed_open ${verdict.opening.day} — ${evidence}`);
        continue;
      }
      if (await storeFeedOpening(resort.id, verdict.opening.day, evidence, now)) {
        stored++;
        console.log(`  FEED ${resort.name}: feed_open ${verdict.opening.day} — ${evidence}`);
        if (verdict.opening.day === localDay(now, timeZone)) openingToday.push(resort.name);
      }
    }
    console.log(`[operator-sync] Feed openings: ${DRY_RUN ? "dry run, nothing stored" : `${stored} stored`}.`);
  } catch (err) {
    console.error(`[operator-sync] Feed openings failed (lift rows are stored): ${err instanceof Error ? err.message : err}`);
  }
  return openingToday;
}

/**
 * Asks the site to send today's feed-opening emails. The route re-reads every
 * fact it acts on, so this call names no resorts and a repeat is harmless.
 * Fails soft, like the feed pass.
 */
async function requestOpeningEmails(openingToday: string[]): Promise<void> {
  if (!openingToday.length || DRY_RUN || NO_OPENING_EMAILS) return;
  if (!CRON_SECRET) {
    console.log("[operator-sync] Opening emails: CRON_SECRET not set, not requested.");
    return;
  }
  try {
    const res = await fetch(`${SITE_URL}/api/alerts/feed-openings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
      signal: AbortSignal.timeout(70_000),
    });
    const body = await res.text();
    console.log(`[operator-sync] Opening emails for ${openingToday.join(", ")}: ${res.status} ${body.slice(0, 500)}`);
  } catch (err) {
    console.error(`[operator-sync] Opening emails request failed: ${err instanceof Error ? err.message : err}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────

interface Tally {
  inserted: number;
  duplicates: number;
  withStatus: number;
  failures: Map<string, number>;
  sample: string[];
}

function describe(report: LiftieReport): string {
  const s = report.stats;
  return s.total ? `${s.open} open, ${s.hold} hold, ${s.scheduled} scheduled, ${s.closed} closed of ${s.total}` : "no lifts listed";
}

async function store(resort: ResortRow, liftieId: string, report: LiftieReport, now: Date, via: string, tally: Tally): Promise<void> {
  if (report.stats.total) tally.withStatus++;
  console.log(`  OK   ${resort.name} (${liftieId}) — ${describe(report)}${report.openingDate ? `; opening ${report.openingDate}` : ""}`);
  if (DRY_RUN) return;
  const outcome = await insertRow(operatorStatusRow(resort.id, report, now, via));
  if (outcome === "inserted") tally.inserted++;
  else tally.duplicates++;
}

function fail(resort: ResortRow, liftieId: string, slug: string, reason: string, status: number | null, detail: string, tally: Tally): void {
  tally.failures.set(reason, (tally.failures.get(reason) ?? 0) + 1);
  if (tally.sample.length < 5) tally.sample.push(`${slug}: ${reason}${status ? ` ${status}` : ""} — ${detail}`);
  console.log(`  FAIL ${resort.name} (${liftieId}) — ${reason}${status ? ` ${status}` : ""}${detail ? `: ${detail}` : ""}`);
}

async function main(): Promise<void> {
  const now = new Date();
  const scope = [ONLY_SLUG && `resort ${ONLY_SLUG}`, ONLY_STATE && `state ${ONLY_STATE}`, ONLY_LIST && `only ${ONLY_LIST.join(",")}`].filter(Boolean).join(", ");
  console.log(`[operator-sync] ${DRY_RUN ? "DRY RUN — " : ""}starting${scope ? ` for ${scope}` : ""}${USE_LIFTIE_API ? " (liftie.info API)" : ""}`);
  const sources = loadSources();
  const pairs = liftiePairs(sources);
  const resorts = await fetchResorts();
  const bySlug = new Map(resorts.map((r) => [r.slug, r]));
  const targets = pairs.filter((p) => {
    const resort = bySlug.get(p.slug);
    if (!resort) return false;
    if (ONLY_SLUG && p.slug !== ONLY_SLUG) return false;
    if (ONLY_STATE && (resort.state ?? "").toUpperCase() !== ONLY_STATE) return false;
    if (ONLY_LIST && !ONLY_LIST.includes(p.slug)) return false;
    return true;
  });
  if (!targets.length) {
    console.error(`[operator-sync] no mapped resort${scope ? ` matching ${scope} (add it to data/operator-sources.json)` : ""}`);
    process.exit(1);
  }
  console.log(`[operator-sync] ${targets.length} resorts mapped to a Liftie parser (${pairs.length} in data/operator-sources.json, ${resorts.length} active resorts)\n`);

  const tally: Tally = { inserted: 0, duplicates: 0, withStatus: 0, failures: new Map(), sample: [] };

  if (USE_LIFTIE_API) {
    for (const { slug, liftieId } of targets) {
      const resort = bySlug.get(slug)!;
      const result = await fetchLiftieResort(liftieId, { now: () => now });
      if (result.ok) await store(resort, liftieId, result.report, now, "liftie.info", tally);
      else fail(resort, liftieId, slug, result.reason, result.status, result.detail, tally);
      await sleep(PAUSE_MS);
    }
  } else {
    // Several PeakCam slugs never share a Liftie id, so the id names the resort.
    const byLiftieId = new Map(targets.map((t) => [t.liftieId, t.slug]));
    let via = "liftie-parsers";
    const outcome = await runLiftieWorker(
      targets.map((t) => t.liftieId),
      {
        root: ROOT,
        userAgent: USER_AGENT,
        pauseMs: PAUSE_MS,
        now,
        onMeta: (meta) => {
          via = `liftie-parsers@${meta.liftieVersion}`;
        },
        onResult: async (result: LocalResult) => {
          const slug = byLiftieId.get(result.id);
          const resort = slug ? bySlug.get(slug) : undefined;
          if (!slug || !resort) return;
          if (result.ok) await store(resort, result.id, localResultToReport(result, now), now, via, tally);
          else fail(resort, result.id, slug, result.reason, result.status, result.detail, tally);
        },
      },
    );
    if (outcome.exitCode === WORKER_NOT_INSTALLED) {
      console.error("[operator-sync] The Liftie worker's libraries are not installed. Run: npm ci --prefix scripts/liftie-worker");
      process.exit(1);
    }
    if (outcome.exitCode !== 0) console.error(`[operator-sync] The Liftie worker exited with code ${outcome.exitCode ?? "none"}.${outcome.stderrTail ? `\n${outcome.stderrTail}` : ""}`);
  }

  // A fresh clock: the rows just written carry the operators' own times, up to the run's length after `now`.
  const openingToday = await recordFeedOpenings(targets.map((t) => bySlug.get(t.slug)!), new Date());
  await requestOpeningEmails(openingToday);

  const failed = [...tally.failures.entries()].map(([k, n]) => `${k} ${n}`).join(", ");
  const failedCount = [...tally.failures.values()].reduce((a, b) => a + b, 0);
  console.log(
    `\n[operator-sync] Done. ${targets.length} resorts: ${tally.withStatus} with lift status, ${DRY_RUN ? "nothing written (dry run)" : `${tally.inserted} rows inserted, ${tally.duplicates} already stored`}, failures: ${failed || "none"}.`,
  );
  if (tally.sample.length) console.log(`[operator-sync] First failures: ${tally.sample.join(" | ")}`);
  if (failedCount >= targets.length) {
    console.error("[operator-sync] Every resort failed; no operator status this run. See docs/runbook.md 'Operator status'.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[operator-sync] Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
