/**
 * import-resorts-standalone.mjs
 * ─────────────────────────────
 * Zero-dependency resort + cam importer.
 * Requires ONLY Node.js 18+ (no npm install needed).
 *
 * Usage:
 *   node scripts/import-resorts-standalone.mjs              # resorts, metadata, then cams
 *   node scripts/import-resorts-standalone.mjs --cams-only  # only data/cams.csv, against resorts already in the table
 *
 * Reads:  .env.local, data/resorts.csv, data/cams.csv
 * Writes: Supabase (resorts table, resort_metadata, then cams table)
 *
 * Optional profile columns (migration 025) are accepted in both CSVs; see
 * the "Profile columns" section below for the list and the blank/absent rule.
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

// Checked in main(), not at import time, so the unit tests can import the
// pure row builders below on a machine without the service-role key.
function requireEnv() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error(
      "\n❌  Missing env vars.\n" +
      "    Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local\n"
    );
    process.exit(1);
  }
}

// ─── CSV parser (no csv-parse package) ───────────────────────────────────────

function parseCsv(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
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

// ─── Supabase REST helper ─────────────────────────────────────────────────────

async function supabaseUpsert(table, records, onConflict) {
  // ?on_conflict= is required by Supabase REST API for upsert to work
  const url = `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Prefer": `resolution=merge-duplicates,return=representation`,
    },
    body: JSON.stringify(records),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${table} upsert failed (${res.status}): ${err}`);
  }

  return res.json();
}

/**
 * Every cam row already in the table, in the shape camIdentity() reads.
 * Paged: PostgREST caps a response at 1,000 rows and the table is past 600.
 */
async function fetchExistingCams() {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const url = `${SUPABASE_URL}/rest/v1/cams?select=resort_id,name,embed_url,youtube_id&order=id&limit=1000&offset=${offset}`;
    const res = await fetch(url, { headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` } });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Supabase cams select failed (${res.status}): ${err}`);
    }
    const page = await res.json();
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

/** slug → id for every resort already in the table (cams-only runs). */
async function fetchSlugToId() {
  const url = `${SUPABASE_URL}/rest/v1/resorts?select=id,slug`;
  const res = await fetch(url, {
    headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase resorts select failed (${res.status}): ${err}`);
  }
  const data = await res.json();
  return new Map(data.map((d) => [d.slug, d.id]));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const blankToNull = (v) => (v === "" ? null : v);
const toBool = (v) => v.toLowerCase() === "true";
const toNullInt = (v) => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };
const toNullFloat = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };

export function hasElevationData(row) {
  return Boolean(row.elevation_base_ft) && Boolean(row.elevation_summit_ft);
}

export function toResortMetadataRecord(resortId, row) {
  return {
    resort_id: resortId,
    elevation_base_ft: parseInt(row.elevation_base_ft, 10),
    elevation_summit_ft: parseInt(row.elevation_summit_ft, 10),
  };
}

// ─── Profile columns (migration 025) ─────────────────────────────────────────
//
// Every column below is OPTIONAL in the CSV. A column that is absent from the
// header is not sent at all, so an upsert keeps whatever prod already holds
// (hand edits, the P2 enrichment job's values). A column that is present but
// blank is sent as null / empty — the CSV is then the source of truth for it.
// Exception: the two elevation columns, which are sent only when non-blank.
//
// resorts.csv may add:  runs_total, lifts_total, skiable_acres, vertical_ft,
//   annual_snowfall_in, longest_run_mi, description, description_source,
//   trail_map_url, wikidata_id, aliases (pipe-separated), passes (pipe-separated).
// cams.csv may add:     kind, credit, source_terms_url.

/** Allowed `resorts.passes` values (CHECK resorts_passes_check). */
export const RESORT_PASSES = ["ikon", "epic", "mountain-collective", "indy", "power"];
/** Allowed `resorts.description_source` values. */
export const DESCRIPTION_SOURCES = ["operator", "generated", "editor"];
/** Allowed `cams.kind` values (CHECK cams_kind_check). */
export const CAM_KINDS = ["summit", "mid", "base", "snow-stake", "village", "approach"];

/** `"A-Basin|Arapahoe Basin"` → `["A-Basin", "Arapahoe Basin"]`; blank → `[]`. */
export function parseList(value) {
  if (!value) return [];
  return value.split("|").map((s) => s.trim()).filter(Boolean);
}

/**
 * Pipe-separated passes, lower-cased, de-duplicated, unknown values dropped
 * with a warning rather than failing the whole batch on the CHECK.
 */
export function parsePasses(value, warn = console.warn) {
  const out = [];
  for (const raw of parseList(value)) {
    const pass = raw.toLowerCase();
    if (!RESORT_PASSES.includes(pass)) {
      warn(`  ⚠  Unknown pass "${raw}" dropped (allowed: ${RESORT_PASSES.join(", ")})`);
      continue;
    }
    if (!out.includes(pass)) out.push(pass);
  }
  return out;
}

/** A value from a closed set, or null (with a warning) when it is not in the set. */
function parseEnum(value, allowed, label, warn) {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (allowed.includes(v)) return v;
  warn(`  ⚠  Unknown ${label} "${value}" dropped (allowed: ${allowed.join(", ")})`);
  return null;
}

const RESORT_INT_COLUMNS   = ["runs_total", "lifts_total", "vertical_ft"];
const RESORT_FLOAT_COLUMNS = ["skiable_acres", "annual_snowfall_in", "longest_run_mi"];
const RESORT_TEXT_COLUMNS  = ["description", "trail_map_url", "wikidata_id"];
// Elevations have always been in the CSV header but blank for a few rows, and
// prod's values were backfilled by migration 025; a blank must not null them.
const RESORT_ELEVATION_COLUMNS = ["elevation_base_ft", "elevation_summit_ft"];

/**
 * One data/resorts.csv row → the `resorts` upsert body. The original columns
 * are always sent (as before); the migration-025 profile columns only when
 * their header is present in the CSV.
 */
export function toResortRecord(row, warn = console.warn) {
  const record = {
    name:               row.name,
    slug:               row.slug,
    state:              row.state,
    region:             row.region,
    lat:                toNullFloat(row.lat),
    lng:                toNullFloat(row.lng),
    website_url:        blankToNull(row.website_url),
    cam_page_url:       blankToNull(row.cam_page_url),
    snotel_station_id:  blankToNull(row.snotel_station_id),
    x_url:              blankToNull(row.x_url),
    facebook_url:       blankToNull(row.facebook_url),
    instagram_url:      blankToNull(row.instagram_url),
    is_active:          toBool(row.is_active ?? ""),
    country:            row.country || "US",
  };

  for (const col of RESORT_INT_COLUMNS) {
    if (col in row) record[col] = toNullInt(row[col]);
  }
  for (const col of RESORT_ELEVATION_COLUMNS) {
    const n = toNullInt(row[col] ?? "");
    if (n != null) record[col] = n;
  }
  for (const col of RESORT_FLOAT_COLUMNS) {
    if (col in row) record[col] = toNullFloat(row[col]);
  }
  for (const col of RESORT_TEXT_COLUMNS) {
    if (col in row) record[col] = blankToNull(row[col]);
  }
  if ("description_source" in row) {
    record.description_source = parseEnum(row.description_source, DESCRIPTION_SOURCES, "description_source", warn);
  }
  if ("aliases" in row) record.aliases = parseList(row.aliases);
  if ("passes" in row) record.passes = parsePasses(row.passes, warn);

  // A description without a source is a CHECK-safe but meaningless row; a
  // source without a description is noise. Keep the pair consistent.
  if (record.description == null && record.description_source != null) record.description_source = null;

  return record;
}

/**
 * One data/cams.csv row → the `cams` upsert body. `kind`, `credit` and
 * `source_terms_url` (migration 025) are sent only when their header is
 * present. is_active / last_checked_at are never sent (see importCams).
 */
export function toCamRecord(resortId, row, warn = console.warn) {
  const record = {
    resort_id:  resortId,
    name:       row.name,
    elevation:  blankToNull(row.elevation ?? ""),
    embed_type: row.embed_type,
    embed_url:  blankToNull(row.embed_url ?? ""),
    youtube_id: blankToNull(row.youtube_id ?? ""),
  };
  if ("kind" in row) record.kind = parseEnum(row.kind, CAM_KINDS, "cam kind", warn);
  if ("credit" in row) record.credit = blankToNull(row.credit);
  if ("source_terms_url" in row) record.source_terms_url = blankToNull(row.source_terms_url);
  return record;
}

/**
 * The identity production enforces on `cams` through the hand-applied
 * constraint `cams_unique_per_resort`:
 *   (resort_id, name, COALESCE(embed_url, ''), COALESCE(youtube_id, ''))
 * It exists in no migration file (CLAUDE.md, "Known live-DB drift"). The
 * upsert targets migration 012's cams_resort_embed_url_idx on
 * (resort_id, embed_url, name) instead, where a NULL embed_url never
 * conflicts, so a YouTube-only row that already exists would go to INSERT
 * and die on 23505. Rows matching this identity are skipped up front.
 */
export function camIdentity(cam) {
  return `${cam.resort_id}|${cam.name}|${cam.embed_url ?? ""}|${cam.youtube_id ?? ""}`;
}

/**
 * Split the CSV-derived cam records into the ones to upsert and the ones
 * already present under camIdentity(). Pure; `existing` is whatever
 * fetchExistingCams() returned (or a fixture). Order is preserved. Every
 * skip is reported through `log` so a run shows what it left alone.
 */
export function partitionCamRecords(records, existing, log = console.log) {
  const present = new Set(existing.map(camIdentity));
  const toUpsert = [];
  const skipped = [];
  for (const record of records) {
    if (present.has(camIdentity(record))) {
      skipped.push(record);
      log(`  · already present, skipped: ${record.name} (${record.embed_url ?? record.youtube_id ?? "no url"})`);
    } else {
      toUpsert.push(record);
    }
  }
  return { toUpsert, skipped };
}

function dedupeBy(arr, key) {
  const seen = new Set();
  return arr.filter((item) => {
    if (seen.has(item[key])) {
      console.warn(`  ⚠  Duplicate ${key} skipped: "${item[key]}"`);
      return false;
    }
    seen.add(item[key]);
    return true;
  });
}

// ─── Import resorts ───────────────────────────────────────────────────────────

async function importResorts() {
  const csvPath = path.join(ROOT, "data/resorts.csv");
  if (!fs.existsSync(csvPath)) {
    console.error("❌  data/resorts.csv not found");
    process.exit(1);
  }

  const raw = parseCsv(csvPath);
  const rows = dedupeBy(raw, "slug");
  console.log(`\n📋 Resorts: ${rows.length} unique (${raw.length} total in CSV)`);

  // Chunk into batches of 50 to stay under Supabase request limits
  const BATCH = 50;
  const slugToId = new Map();

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map((r) => toResortRecord(r));

    const data = await supabaseUpsert("resorts", batch, "slug");
    for (const d of data) slugToId.set(d.slug, d.id);
    process.stdout.write(`  ✓ Batch ${Math.floor(i / BATCH) + 1}: ${data.length} resorts\n`);
  }

  console.log(`✅  Resorts done. ${slugToId.size} IDs mapped.`);
  return { slugToId, rows };
}

// ─── Import resort_metadata (elevation) ──────────────────────────────────────

async function importResortMetadata(rows, slugToId) {
  const records = rows
    .filter(hasElevationData)
    .map((r) => toResortMetadataRecord(slugToId.get(r.slug), r))
    .filter((r) => r.resort_id); // drop rows whose slug didn't map (shouldn't happen, defensive)

  if (records.length === 0) {
    console.log("\nℹ️  No resort_metadata rows to import (no elevation data in CSV).");
    return;
  }

  console.log(`\n⛰  Resort metadata: ${records.length} rows with elevation data`);
  const data = await supabaseUpsert("resort_metadata", records, "resort_id");
  console.log(`✅  Resort metadata done. ${data.length} upserted.`);
}

// ─── Import cams ─────────────────────────────────────────────────────────────

async function importCams(slugToId) {
  const csvPath = path.join(ROOT, "data/cams.csv");
  if (!fs.existsSync(csvPath)) {
    console.warn("⚠  data/cams.csv not found — skipping cam import.");
    return;
  }

  const rows = parseCsv(csvPath);
  console.log(`\n📷 Cams: ${rows.length} rows`);

  const skipped = [];
  const records = rows
    .filter((r) => {
      const id = slugToId.get(r.resort_slug);
      if (!id) { skipped.push(r.resort_slug); return false; }
      return true;
    })
    .map((r) => toCamRecord(slugToId.get(r.resort_slug), r));
    // toCamRecord deliberately does NOT send is_active or last_checked_at:
      // cam-health-check.mjs owns a cam's active state (auto-disable
      // after 3 consecutive failures, auto-recovery on success) and its
      // check timestamps. Sending is_active from the CSV re-enabled all
      // 47 auto-disabled dead cams on a full-CSV re-import (observed
      // live, 2026-07-13). New rows get the schema defaults
      // (is_active=true, last_checked_at=null); existing rows keep the
      // health checker's authoritative state. Every cams.csv row is
      // is_active=true anyway — nothing depended on CSV-driven
      // deactivation.

  if (skipped.length > 0) {
    const unique = [...new Set(skipped)];
    console.warn(`  ⚠  Skipped cams for unknown slugs: ${unique.join(", ")}`);
  }

  if (records.length === 0) {
    console.warn("  ⚠  No cam records to insert.");
    return;
  }

  // Rows already in the table under production's four-column identity
  // (cams_unique_per_resort, see camIdentity) are skipped, so the run is
  // idempotent whichever unique index the upsert's on_conflict hits. Rows
  // that exist only under (resort_id, embed_url, name) still merge below;
  // genuinely new rows insert.
  const existing = await fetchExistingCams();
  const { toUpsert, skipped: present } = partitionCamRecords(records, existing);
  console.log(`  ${existing.length} cams already in the table; ${present.length} CSV rows already present, ${toUpsert.length} to upsert`);
  if (toUpsert.length === 0) {
    console.log("✅  Cams done. Nothing to upsert.");
    return;
  }

  // Migration 012 added a unique index on (resort_id, embed_url, name) — real
  // upsert now, instead of the old ignore-duplicates insert (which was a
  // no-op without a unique constraint and duplicated cams on re-run).
  const BATCH = 100;
  let total = 0;
  for (let i = 0; i < toUpsert.length; i += BATCH) {
    const batch = toUpsert.slice(i, i + BATCH);
    const data = await supabaseUpsert("cams", batch, "resort_id,embed_url,name");
    total += data.length;
    process.stdout.write(`  ✓ Batch ${Math.floor(i / BATCH) + 1}: ${data.length} cams upserted\n`);
  }

  console.log(`✅  Cams done. ${total} upserted, ${present.length} already present.`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  requireEnv();
  console.log("\n🏔  PeakCam — Standalone Resort & Cam Import" + (process.argv.includes("--cams-only") ? " (cams only)" : ""));
  console.log("─────────────────────────────────────────────");
  console.log(`    Supabase: ${SUPABASE_URL}`);

  // `--cams-only` upserts data/cams.csv against the resorts already in the
  // table and leaves resorts/resort_metadata untouched — the usual case when
  // a resort adds a cam, and it avoids re-writing 148 resort rows (and any
  // hand edits made in prod) just to add one feed.
  if (process.argv.includes("--cams-only")) {
    const slugToId = await fetchSlugToId();
    console.log(`\n📋 Cams only: ${slugToId.size} resort IDs loaded from the table.`);
    await importCams(slugToId);
  } else {
    const { slugToId, rows } = await importResorts();
    await importResortMetadata(rows, slugToId);
    await importCams(slugToId);
  }

  console.log("\n🎉  Import complete.\n");
  console.log("    Note: newly-added resorts won't get a live page until the next deploy — /resorts/[slug] uses dynamicParams=false, so its static params list is fixed at build time.\n");
}

// Only run main() when this file is executed directly (e.g.
// `node scripts/import-resorts-standalone.mjs`), not when it's imported
// as a module (e.g. by scripts/import-resorts-standalone.test.mjs) — an
// import must never have the side effect of writing to the live database.
const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((err) => {
    console.error("\n❌  Fatal error:", err.message);
    process.exit(1);
  });
}
