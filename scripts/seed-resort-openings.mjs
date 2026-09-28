/**
 * seed-resort-openings.mjs
 * ────────────────────────
 * Zero-dependency seeder for the `resort_openings` table (migration 020).
 * Requires ONLY Node.js 18+ (no npm install needed).
 *
 * Usage:
 *   node scripts/seed-resort-openings.mjs        # or: npm run seed-openings
 *
 * Reads:  .env.local, data/resort-openings.csv
 * Writes: Supabase resort_openings (upsert on resort_id, service-role key)
 *
 * The CSV is keyed by resort slug; this script resolves slugs to resort ids
 * with one read and upserts one row per resort. Re-running is safe: an
 * existing row is overwritten with the CSV's values (merge-duplicates), so
 * the CSV is the source of truth — edit it, re-run, done. A slug that does
 * not exist in `resorts` is reported and skipped, never guessed.
 *
 * Only `confirmed_open` triggers an opening-day email (see migration 020),
 * so a projection must stay in `projected_open` until the resort announces.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ─── Load .env.local manually (no dotenv package) ────────────────────────────

function loadEnv(filePath) {
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
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ─── CSV parser (same shape as import-resorts-standalone.mjs) ────────────────

export function parseCsv(raw) {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const obj = {};
    headers.forEach((h, i) => {
      obj[h.trim()] = (values[i] ?? "").trim();
    });
    return obj;
  });
}

function splitCsvLine(line) {
  // Handle quoted fields with commas inside
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ─── Row validation ──────────────────────────────────────────────────────────

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_COLUMNS = ["projected_open", "confirmed_open", "closing_date"];

/** "" → null; a well-formed YYYY-MM-DD passes; anything else is an error. */
export function toDateOrNull(value, column, slug) {
  if (value === "" || value === undefined) return null;
  if (!ISO_DAY_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${slug}: ${column} "${value}" is not a YYYY-MM-DD date`);
  }
  return value;
}

/** The resort_openings row for one CSV line; throws on a malformed date or an empty slug. */
export function toOpeningRecord(resortId, row) {
  const slug = row.slug;
  if (!slug) throw new Error("CSV row has no slug");
  const record = {
    resort_id: resortId,
    season: row.season || "2026-27",
    source_url: row.source_url || null,
    notes: row.notes || null,
    updated_at: new Date().toISOString(),
  };
  for (const column of DATE_COLUMNS) {
    record[column] = toDateOrNull(row[column], column, slug);
  }
  if (!record.projected_open && !record.confirmed_open && !record.closing_date) {
    throw new Error(`${slug}: row has no projected_open, confirmed_open or closing_date — leave unsourced resorts out of the CSV (the page shows TBA)`);
  }
  return record;
}

// ─── Supabase REST helpers ───────────────────────────────────────────────────

function serviceHeaders(extra = {}) {
  return {
    "Content-Type": "application/json",
    "apikey": SERVICE_KEY,
    "Authorization": `Bearer ${SERVICE_KEY}`,
    ...extra,
  };
}

async function fetchResortIds(slugs) {
  // Same quoting as lib/alerts/service-fetch.ts inList: each value quoted and
  // encoded on its own, commas left raw for PostgREST's in.(…) operand.
  const inList = slugs.map((s) => encodeURIComponent(`"${s.replace(/["\\]/g, "")}"`)).join(",");
  const url = `${SUPABASE_URL}/rest/v1/resorts?slug=in.(${inList})&select=id,slug`;
  const res = await fetch(url, { headers: serviceHeaders() });
  if (!res.ok) {
    throw new Error(`Supabase resorts lookup failed (${res.status}): ${await res.text()}`);
  }
  const rows = await res.json();
  return new Map(rows.map((r) => [r.slug, r.id]));
}

async function upsertOpenings(records) {
  // ?on_conflict= is required by Supabase REST API for upsert to work
  const url = `${SUPABASE_URL}/rest/v1/resort_openings?on_conflict=resort_id`;
  const res = await fetch(url, {
    method: "POST",
    headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify(records),
  });
  if (!res.ok) {
    throw new Error(`Supabase resort_openings upsert failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error(
      "\n❌  Missing env vars.\n" +
      "    Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local\n"
    );
    process.exit(1);
  }

  const csvPath = path.join(ROOT, "data/resort-openings.csv");
  if (!fs.existsSync(csvPath)) {
    console.error("❌  data/resort-openings.csv not found");
    process.exit(1);
  }

  console.log("\n🏔  PeakCam — Resort opening dates seed");
  console.log("─────────────────────────────────────────────");
  console.log(`    Supabase: ${SUPABASE_URL}`);

  const rows = parseCsv(fs.readFileSync(csvPath, "utf-8"));
  console.log(`\n📅 Openings: ${rows.length} rows in CSV`);

  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.slug)) throw new Error(`Duplicate slug in CSV: "${row.slug}"`);
    seen.add(row.slug);
  }

  const slugToId = await fetchResortIds(rows.map((r) => r.slug));
  const unknown = rows.filter((r) => !slugToId.has(r.slug)).map((r) => r.slug);
  if (unknown.length > 0) {
    console.warn(`  ⚠  Skipped unknown slugs (not in resorts): ${unknown.join(", ")}`);
  }

  const records = rows
    .filter((r) => slugToId.has(r.slug))
    .map((r) => toOpeningRecord(slugToId.get(r.slug), r));

  if (records.length === 0) {
    console.warn("  ⚠  No opening records to upsert.");
    return;
  }

  const data = await upsertOpenings(records);
  const confirmed = data.filter((d) => d.confirmed_open).length;
  const projected = data.filter((d) => !d.confirmed_open && d.projected_open).length;
  const closing = data.filter((d) => d.closing_date).length;
  console.log(`✅  ${data.length} rows upserted — ${confirmed} confirmed, ${projected} projected, ${closing} with a closing date.`);
  console.log("\n    /opening-dates revalidates within the hour (ISR 3600); the opening-day cron reads confirmed_open live.\n");
}

// Only run main() when this file is executed directly, not when imported by a
// test — an import must never have the side effect of writing to the live DB.
const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((err) => {
    console.error("\n❌  Fatal error:", err.message);
    process.exit(1);
  });
}
