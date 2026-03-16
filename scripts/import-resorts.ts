/**
 * import-resorts.ts
 * -----------------
 * Reads data/resorts.csv and data/cams.csv, then upserts both into Supabase.
 * Safe to run multiple times — idempotent on slug (resorts) and embed_url (cams).
 *
 * Usage:
 *   npx ts-node --esm scripts/import-resorts.ts
 *   (or via the package.json script: npm run import-resorts)
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env.local (not the anon key).
 */

import { createClient } from "@supabase/supabase-js";
import { parse } from "csv-parse/sync";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

// ─── Load .env.local ────────────────────────────────────────────────────────
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  console.warn("⚠  .env.local not found — falling back to process env");
}

// ─── Supabase client (service role — bypasses RLS for writes) ───────────────
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
    "    Copy .env.local.example → .env.local and fill in your project values."
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

// ─── Types ───────────────────────────────────────────────────────────────────

interface ResortRow {
  name: string;
  slug: string;
  state: string;
  region: string;
  lat: string;
  lng: string;
  website_url: string;
  cam_page_url: string;
  snotel_station_id: string;
  is_active: string;
}

interface CamRow {
  resort_slug: string;
  name: string;
  elevation: string;
  embed_type: string;    // youtube | iframe | link
  embed_url: string;
  youtube_id: string;
  is_active: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readCsv<T>(filePath: string): T[] {
  const raw = fs.readFileSync(filePath, "utf-8");
  return parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as T[];
}

function toBool(val: string): boolean {
  return val.toLowerCase() === "true";
}

function toNullableInt(val: string): number | null {
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

function toNullableFloat(val: string): number | null {
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function blankToNull(val: string): string | null {
  return val.trim() === "" ? null : val.trim();
}

// ─── Deduplication helper ────────────────────────────────────────────────────
// Resorts CSV occasionally has duplicate slugs — keep first occurrence only.
function dedupeBySlug(rows: ResortRow[]): ResortRow[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (seen.has(r.slug)) {
      console.warn(`  ⚠  Duplicate slug skipped: "${r.slug}"`);
      return false;
    }
    seen.add(r.slug);
    return true;
  });
}

// ─── Import resorts ──────────────────────────────────────────────────────────

async function importResorts(): Promise<Map<string, string>> {
  const csvPath = path.resolve(process.cwd(), "data/resorts.csv");
  if (!fs.existsSync(csvPath)) {
    console.error("❌  data/resorts.csv not found.");
    process.exit(1);
  }

  const raw = readCsv<ResortRow>(csvPath);
  const rows = dedupeBySlug(raw);
  console.log(`\n📋 Resorts: ${rows.length} unique rows (${raw.length} total in CSV)`);

  const records = rows.map((r) => ({
    name: r.name.trim(),
    slug: r.slug.trim(),
    state: r.state.trim(),
    region: r.region.trim(),
    lat: toNullableFloat(r.lat),
    lng: toNullableFloat(r.lng),
    website_url: blankToNull(r.website_url),
    cam_page_url: blankToNull(r.cam_page_url),
    snotel_station_id: toNullableInt(r.snotel_station_id),
    is_active: toBool(r.is_active),
  }));

  const { data, error } = await supabase
    .from("resorts")
    .upsert(records, { onConflict: "slug" })
    .select("id, slug");

  if (error) {
    console.error("❌  Resort upsert failed:", error.message);
    process.exit(1);
  }

  console.log(`✅  Resorts upserted: ${data?.length ?? 0}`);

  // Return slug → id map for cam import
  const slugToId = new Map<string, string>();
  for (const d of data ?? []) slugToId.set(d.slug, d.id);
  return slugToId;
}

// ─── Import cams ─────────────────────────────────────────────────────────────

async function importCams(slugToId: Map<string, string>): Promise<void> {
  const csvPath = path.resolve(process.cwd(), "data/cams.csv");
  if (!fs.existsSync(csvPath)) {
    console.warn("⚠  data/cams.csv not found — skipping cam import.");
    return;
  }

  const rows = readCsv<CamRow>(csvPath);
  console.log(`\n📷 Cams: ${rows.length} rows`);

  const skipped: string[] = [];
  const records = rows
    .filter((r) => {
      const id = slugToId.get(r.resort_slug.trim());
      if (!id) {
        skipped.push(r.resort_slug);
        return false;
      }
      return true;
    })
    .map((r) => ({
      resort_id: slugToId.get(r.resort_slug.trim())!,
      name: r.name.trim(),
      elevation: toNullableInt(r.elevation),
      embed_type: r.embed_type.trim() as "youtube" | "iframe" | "link",
      embed_url: blankToNull(r.embed_url),
      youtube_id: blankToNull(r.youtube_id),
      is_active: toBool(r.is_active),
      last_checked_at: new Date().toISOString(),
    }));

  if (skipped.length > 0) {
    console.warn(`  ⚠  Skipped cams for unknown slugs: ${[...new Set(skipped)].join(", ")}`);
  }

  if (records.length === 0) {
    console.warn("  ⚠  No cam records to upsert.");
    return;
  }

  // Upsert on embed_url — safe to rerun
  const { data, error } = await supabase
    .from("cams")
    .upsert(records, { onConflict: "embed_url" })
    .select("id");

  if (error) {
    console.error("❌  Cam upsert failed:", error.message);
    process.exit(1);
  }

  console.log(`✅  Cams upserted: ${data?.length ?? 0}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🏔  PeakCam — Resort & Cam Import");
  console.log("───────────────────────────────────");

  const slugToId = await importResorts();
  await importCams(slugToId);

  console.log("\n🎉  Import complete.\n");
}

main().catch((err) => {
  console.error("❌  Unexpected error:", err);
  process.exit(1);
});
