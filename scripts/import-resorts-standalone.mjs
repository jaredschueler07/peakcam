/**
 * import-resorts-standalone.mjs
 * ─────────────────────────────
 * Zero-dependency resort + cam importer.
 * Requires ONLY Node.js 18+ (no npm install needed).
 *
 * Usage:
 *   node scripts/import-resorts-standalone.mjs
 *
 * Reads:  .env.local, data/resorts.csv, data/cams.csv
 * Writes: Supabase (resorts table, then cams table)
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

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "\n❌  Missing env vars.\n" +
    "    Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local\n"
  );
  process.exit(1);
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
    const batch = rows.slice(i, i + BATCH).map((r) => ({
      name:               r.name,
      slug:               r.slug,
      state:              r.state,
      region:             r.region,
      lat:                toNullFloat(r.lat),
      lng:                toNullFloat(r.lng),
      website_url:        blankToNull(r.website_url),
      cam_page_url:       blankToNull(r.cam_page_url),
      snotel_station_id:  blankToNull(r.snotel_station_id),
      x_url:              blankToNull(r.x_url),
      facebook_url:       blankToNull(r.facebook_url),
      instagram_url:      blankToNull(r.instagram_url),
      is_active:          toBool(r.is_active),
      country:            r.country || "US",
    }));

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
    .map((r) => ({
      resort_id:       slugToId.get(r.resort_slug),
      name:            r.name,
      elevation:       blankToNull(r.elevation),
      embed_type:      r.embed_type,
      embed_url:       blankToNull(r.embed_url),
      youtube_id:      blankToNull(r.youtube_id),
      // Deliberately NOT sending is_active or last_checked_at:
      // cam-health-check.mjs owns a cam's active state (auto-disable
      // after 3 consecutive failures, auto-recovery on success) and its
      // check timestamps. Sending is_active from the CSV re-enabled all
      // 47 auto-disabled dead cams on a full-CSV re-import (observed
      // live, 2026-07-13). New rows get the schema defaults
      // (is_active=true, last_checked_at=null); existing rows keep the
      // health checker's authoritative state. Every cams.csv row is
      // is_active=true anyway — nothing depended on CSV-driven
      // deactivation.
    }));

  if (skipped.length > 0) {
    const unique = [...new Set(skipped)];
    console.warn(`  ⚠  Skipped cams for unknown slugs: ${unique.join(", ")}`);
  }

  if (records.length === 0) {
    console.warn("  ⚠  No cam records to insert.");
    return;
  }

  // Migration 012 added a unique index on (resort_id, embed_url, name) — real
  // upsert now, instead of the old ignore-duplicates insert (which was a
  // no-op without a unique constraint and duplicated cams on re-run).
  const BATCH = 100;
  let total = 0;
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    const data = await supabaseUpsert("cams", batch, "resort_id,embed_url,name");
    total += data.length;
    process.stdout.write(`  ✓ Batch ${Math.floor(i / BATCH) + 1}: ${data.length} cams upserted\n`);
  }

  console.log(`✅  Cams done. ${total} upserted.`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🏔  PeakCam — Standalone Resort & Cam Import");
  console.log("─────────────────────────────────────────────");
  console.log(`    Supabase: ${SUPABASE_URL}`);

  const { slugToId, rows } = await importResorts();
  await importResortMetadata(rows, slugToId);
  await importCams(slugToId);

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
