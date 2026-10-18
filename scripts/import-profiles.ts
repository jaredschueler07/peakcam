#!/usr/bin/env tsx

/**
 * import-profiles.ts
 * ──────────────────
 * Writes data/resort-profiles.csv (parity plan P2) onto the `resorts` profile
 * columns that migration 025 (block P0) adds: runs_total, lifts_total,
 * skiable_acres, vertical_ft, annual_snowfall_in, longest_run_mi, passes,
 * trail_map_url, wikidata_id, elevation_base_ft, elevation_summit_ft.
 *
 * Usage:
 *   npx tsx scripts/import-profiles.ts --dry-run     # validate + print the patches, write nothing
 *   npx tsx scripts/import-profiles.ts               # PATCH every row (service-role key)
 *   npx tsx scripts/import-profiles.ts --only alta   # one slug
 *
 * Reads:  .env.local (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY), data/resort-profiles.csv
 * Writes: resorts.{profile columns}, one PATCH per slug, by slug (never by id).
 *
 * The CSV is the source of truth for the columns it carries: a blank cell
 * writes NULL, so a value retracted from the file is retracted from the
 * database on the next run. Columns the CSV does not carry (description,
 * description_source, aliases) are never touched. A slug missing from
 * `resorts` is reported and skipped, never inserted. Every number is
 * validated before anything is sent; one bad cell fails the whole run.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "csv-parse/sync";
import type { SeasonPass } from "../lib/types.js";
import { SEASON_PASSES } from "../lib/resort-profile.js";

// ─── Load .env.local manually (same as scripts/snotel-sync.ts) ──────────────

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

// ─── CSV shape ──────────────────────────────────────────────────────────────

export const PROFILE_CSV_COLUMNS = [
  "slug",
  "runs_total",
  "lifts_total",
  "skiable_acres",
  "vertical_ft",
  "annual_snowfall_in",
  "longest_run_mi",
  "elevation_base_ft",
  "elevation_summit_ft",
  "passes",
  "trail_map_url",
  "wikidata_id",
  "source_url",
  "notes",
] as const;

export type ProfileCsvRow = Record<(typeof PROFILE_CSV_COLUMNS)[number], string>;

/** The `resorts` columns a row patches; every key is always present so a blank cell writes NULL. */
export interface ProfilePatch {
  runs_total: number | null;
  lifts_total: number | null;
  skiable_acres: number | null;
  vertical_ft: number | null;
  annual_snowfall_in: number | null;
  longest_run_mi: number | null;
  elevation_base_ft: number | null;
  elevation_summit_ft: number | null;
  passes: SeasonPass[];
  trail_map_url: string | null;
  wikidata_id: string | null;
}

export interface ProfileRecord {
  slug: string;
  patch: ProfilePatch;
  source_url: string | null;
  /** Operator-internal disagreements worth a look (printed, never fatal): e.g. a stated vertical larger than summit minus base. */
  warnings: string[];
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;
const WIKIDATA_RE = /^Q\d+$/;

export function parseProfileCsv(raw: string): ProfileCsvRow[] {
  const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true, bom: true }) as Record<string, string>[];
  if (rows.length === 0) return [];
  const missing = PROFILE_CSV_COLUMNS.filter((c) => !(c in rows[0]));
  if (missing.length) throw new Error(`resort-profiles.csv is missing column(s): ${missing.join(", ")}`);
  return rows as ProfileCsvRow[];
}

function numberOrNull(value: string, column: string, slug: string, opts: { integer?: boolean; max: number }): number | null {
  if (value === "" || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${slug}: ${column} "${value}" is not a positive number`);
  if (opts.integer && !Number.isInteger(n)) throw new Error(`${slug}: ${column} "${value}" must be a whole number`);
  if (n > opts.max) throw new Error(`${slug}: ${column} "${value}" is above the sanity ceiling ${opts.max}`);
  return n;
}

function urlOrNull(value: string, column: string, slug: string): string | null {
  if (!value) return null;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new Error(`${slug}: ${column} "${value}" is not a URL`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(`${slug}: ${column} must be http(s)`);
  return value;
}

export function parsePasses(value: string, slug: string): SeasonPass[] {
  const tokens = value.split(";").map((t) => t.trim()).filter(Boolean);
  for (const t of tokens) {
    if (!(SEASON_PASSES as readonly string[]).includes(t)) {
      throw new Error(`${slug}: passes token "${t}" is not one of ${SEASON_PASSES.join("|")}`);
    }
  }
  // Canonical order, deduplicated.
  return SEASON_PASSES.filter((p) => tokens.includes(p));
}

/** One CSV line → the PATCH body for its resort. Throws on any malformed cell. */
export function toProfileRecord(row: ProfileCsvRow): ProfileRecord {
  const slug = row.slug;
  if (!slug || !SLUG_RE.test(slug)) throw new Error(`CSV row has an invalid slug "${slug}"`);
  const base = numberOrNull(row.elevation_base_ft, "elevation_base_ft", slug, { integer: true, max: 20_000 });
  const summit = numberOrNull(row.elevation_summit_ft, "elevation_summit_ft", slug, { integer: true, max: 20_000 });
  if (base != null && summit != null && summit <= base) {
    throw new Error(`${slug}: elevation_summit_ft ${summit} is not above elevation_base_ft ${base}`);
  }
  const vertical = numberOrNull(row.vertical_ft, "vertical_ft", slug, { integer: true, max: 10_000 });
  const warnings: string[] = [];
  // Operators routinely publish a vertical that disagrees with their own
  // base/summit (lift-served vs hike-to summit, lowest lodge vs base area),
  // so this is a warning, not a rejection: both numbers are theirs.
  if (vertical != null && base != null && summit != null && Math.abs(vertical - (summit - base)) > 50) {
    warnings.push(`${slug}: vertical_ft ${vertical} vs summit minus base ${summit - base}`);
  }
  const wikidata = row.wikidata_id ? row.wikidata_id.trim() : "";
  if (wikidata && !WIKIDATA_RE.test(wikidata)) throw new Error(`${slug}: wikidata_id "${wikidata}" is not a Q-id`);
  return {
    slug,
    patch: {
      runs_total: numberOrNull(row.runs_total, "runs_total", slug, { integer: true, max: 1_000 }),
      lifts_total: numberOrNull(row.lifts_total, "lifts_total", slug, { integer: true, max: 100 }),
      skiable_acres: numberOrNull(row.skiable_acres, "skiable_acres", slug, { max: 20_000 }),
      vertical_ft: vertical,
      annual_snowfall_in: numberOrNull(row.annual_snowfall_in, "annual_snowfall_in", slug, { max: 1_200 }),
      longest_run_mi: numberOrNull(row.longest_run_mi, "longest_run_mi", slug, { max: 20 }),
      elevation_base_ft: base,
      elevation_summit_ft: summit,
      passes: parsePasses(row.passes ?? "", slug),
      trail_map_url: urlOrNull(row.trail_map_url, "trail_map_url", slug),
      wikidata_id: wikidata || null,
    },
    source_url: row.source_url ? row.source_url.split(" ")[0] : null,
    warnings,
  };
}

/** Every row validated, duplicate slugs rejected. */
export function toProfileRecords(rows: ProfileCsvRow[]): ProfileRecord[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    const record = toProfileRecord(row);
    if (seen.has(record.slug)) throw new Error(`Duplicate slug in CSV: "${record.slug}"`);
    seen.add(record.slug);
    return record;
  });
}

/** Counts for the run summary: how many rows carry each column. */
export function summarize(records: ProfileRecord[]): Record<keyof ProfilePatch, number> {
  const keys = Object.keys(records[0]?.patch ?? {}) as Array<keyof ProfilePatch>;
  const out = {} as Record<keyof ProfilePatch, number>;
  for (const key of keys) {
    out[key] = records.filter((r) => {
      const v = r.patch[key];
      return Array.isArray(v) ? v.length > 0 : v != null;
    }).length;
  }
  return out;
}

// ─── Supabase REST ──────────────────────────────────────────────────────────

function serviceHeaders(key: string, extra: Record<string, string> = {}): Record<string, string> {
  return { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

async function fetchKnownSlugs(url: string, key: string): Promise<Set<string>> {
  const res = await fetch(`${url}/rest/v1/resorts?select=slug&limit=2000`, { headers: serviceHeaders(key) });
  if (!res.ok) throw new Error(`resorts lookup failed (${res.status}): ${await res.text()}`);
  const rows = (await res.json()) as Array<{ slug: string }>;
  return new Set(rows.map((r) => r.slug));
}

async function patchProfile(url: string, key: string, record: ProfileRecord): Promise<void> {
  const res = await fetch(`${url}/rest/v1/resorts?slug=eq.${encodeURIComponent(record.slug)}`, {
    method: "PATCH",
    headers: serviceHeaders(key, { Prefer: "return=minimal" }),
    body: JSON.stringify(record.patch),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 400 && /column .* does not exist|schema cache/i.test(text)) {
      throw new Error(`resorts is missing the profile columns — apply migration 025 (block P0) first. PostgREST said: ${text}`);
    }
    throw new Error(`PATCH ${record.slug} failed (${res.status}): ${text}`);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const onlyIdx = args.indexOf("--only");
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;

  const csvPath = path.join(ROOT, "data/resort-profiles.csv");
  if (!fs.existsSync(csvPath)) throw new Error("data/resort-profiles.csv not found");
  let records = toProfileRecords(parseProfileCsv(fs.readFileSync(csvPath, "utf-8")));
  if (only) records = records.filter((r) => r.slug === only);
  if (records.length === 0) throw new Error(only ? `No CSV row for slug "${only}"` : "CSV has no rows");

  console.log(`\n🏔  PeakCam — resort profiles import${dryRun ? " (dry run)" : ""}`);
  console.log("─────────────────────────────────────────────");
  console.log(`    ${records.length} validated row${records.length === 1 ? "" : "s"} from data/resort-profiles.csv`);
  const counts = summarize(records);
  for (const [key, n] of Object.entries(counts)) console.log(`    ${key.padEnd(20)} ${n}`);
  const warnings = records.flatMap((r) => r.warnings);
  if (warnings.length) {
    console.warn(`\n  ⚠  ${warnings.length} operator-internal disagreement${warnings.length === 1 ? "" : "s"} (written as published):`);
    for (const w of warnings) console.warn(`     ${w}`);
  }

  if (dryRun) {
    for (const r of records.slice(0, 3)) console.log(`\n    ${r.slug}: ${JSON.stringify(r.patch)}`);
    if (records.length > 3) console.log(`    … ${records.length - 3} more`);
    console.log("\n    Dry run: nothing written.\n");
    return;
  }

  loadEnv(path.join(ROOT, ".env.local"));
  loadEnv(path.join(ROOT, ".env"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local (run from the Mini's ops checkout)");
  }

  const known = await fetchKnownSlugs(url, key);
  const unknown = records.filter((r) => !known.has(r.slug)).map((r) => r.slug);
  if (unknown.length) console.warn(`  ⚠  Skipped slugs not in resorts: ${unknown.join(", ")}`);

  let written = 0;
  for (const record of records.filter((r) => known.has(r.slug))) {
    await patchProfile(url, key, record);
    written++;
  }
  console.log(`\n✅  ${written} resort${written === 1 ? "" : "s"} patched. Resort pages revalidate within the hour (ISR 3600).\n`);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((err: Error) => {
    console.error("\n❌  Fatal error:", err.message);
    process.exit(1);
  });
}
