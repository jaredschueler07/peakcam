#!/usr/bin/env tsx

/**
 * approach-cams-sync.ts
 * ─────────────────────
 * Approach (road) cams from DOT feeds → `cams` rows with embed_type `image`,
 * kind `approach`, the agency as credit and its terms URL (parity plan P3).
 *
 * Open feeds: Caltrans districts 2/3/9/10 and DriveBC. Keyed feeds (UDOT,
 * WSDOT, COtrip) run only when UDOT_API_KEY / WSDOT_ACCESS_CODE /
 * COTRIP_API_KEY are set in .env.local; otherwise they are skipped and named
 * in the log. Matching: within 25 km of the resort, access-road cams first,
 * at most four per resort (lib/stations/road-cams.ts). Existing approach rows
 * are matched by embed_url, so a re-run adds only new cams and re-activates
 * ones the feed brought back; cams that left the feed are deactivated.
 *
 * Usage:
 *   npx tsx scripts/approach-cams-sync.ts [--dry-run] [--resort slug]
 *
 * Run by hand or from a daily job — the feeds' cam lists change rarely; the
 * frames themselves are fetched by the browser (and, where terms allow, by
 * cam-stills) straight from the agency.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseCsv } from "csv-parse/sync";
import {
  fetchCaltransCams,
  fetchCotripCams,
  fetchDriveBcCams,
  fetchUdotCams,
  fetchWsdotCams,
  keyedAgenciesStatus,
  matchApproachCams,
  ROAD_CAM_ENV,
  type ApproachCamRow,
  type ResortForMatching,
  type RoadCam,
} from "../lib/stations/road-cams.js";

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
const writeHeaders = { apikey: SERVICE_KEY ?? "", Authorization: `Bearer ${SERVICE_KEY ?? ""}`, "Content-Type": "application/json" };

interface ResortRow extends ResortForMatching {
  state: string;
  country: string;
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
  const rows = parseCsv(fs.readFileSync(path.join(ROOT, "data", "resorts.csv"), "utf-8"), { columns: true, skip_empty_lines: true, relax_column_count: true }) as Record<string, string>[];
  return rows
    .filter((r) => r.is_active !== "false" && (!ONLY_SLUG || r.slug === ONLY_SLUG))
    .map((r) => ({ id: `csv:${r.slug}`, slug: r.slug, name: r.name, state: r.state, country: r.country || "US", lat: Number(r.lat), lng: Number(r.lng) }));
}

interface ExistingCam {
  id: string;
  resort_id: string;
  embed_url: string | null;
  is_active: boolean;
}

async function fetchExistingApproachCams(): Promise<ExistingCam[]> {
  if (!SUPABASE_URL || !SERVICE_KEY) return [];
  const res = await fetch(`${SUPABASE_URL}/rest/v1/cams?select=id,resort_id,embed_url,is_active&kind=eq.approach`, { headers: writeHeaders });
  if (!res.ok) throw new Error(`cams fetch failed: ${res.status}`);
  return (await res.json()) as ExistingCam[];
}

async function insertCams(rows: ApproachCamRow[]): Promise<void> {
  if (!rows.length) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/cams`, { method: "POST", headers: { ...writeHeaders, Prefer: "resolution=ignore-duplicates" }, body: JSON.stringify(rows) });
  if (!res.ok) throw new Error(`cams insert failed (${res.status}): ${await res.text()}`);
}

async function setActive(ids: string[], active: boolean): Promise<void> {
  if (!ids.length) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/cams?id=in.(${ids.join(",")})`, { method: "PATCH", headers: writeHeaders, body: JSON.stringify({ is_active: active }) });
  if (!res.ok) throw new Error(`cams update failed (${res.status}): ${await res.text()}`);
}

async function main(): Promise<void> {
  console.log(`[approach-cams] ${DRY_RUN ? "DRY RUN — " : ""}starting${ONLY_SLUG ? ` for ${ONLY_SLUG}` : ""}\n`);
  const keyed = keyedAgenciesStatus();
  for (const [agency, present] of Object.entries(keyed)) {
    if (!present) console.log(`  skip ${agency}: set ${ROAD_CAM_ENV[agency as keyof typeof ROAD_CAM_ENV]} in .env.local to enable`);
  }

  const resorts = await fetchResorts();
  const wantCA = resorts.some((r) => r.country === "CA");
  const wantUS = resorts.some((r) => r.country === "US");
  const feeds: Array<[string, () => Promise<RoadCam[]>]> = [];
  if (wantUS) feeds.push(["caltrans", () => fetchCaltransCams()], ["udot", () => fetchUdotCams()], ["wsdot", () => fetchWsdotCams()], ["cotrip", () => fetchCotripCams()]);
  if (wantCA) feeds.push(["drivebc", () => fetchDriveBcCams()]);

  const cams: RoadCam[] = [];
  for (const [name, run] of feeds) {
    try {
      const rows = await run();
      if (rows.length) console.log(`  feed ${name}: ${rows.length} cams`);
      cams.push(...rows);
    } catch (err) {
      console.warn(`  feed ${name} failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  const matches = matchApproachCams(resorts, cams);
  const existing = await fetchExistingApproachCams();
  const existingByKey = new Map(existing.map((c) => [`${c.resort_id}|${c.embed_url}`, c]));

  const toInsert: ApproachCamRow[] = [];
  const toReactivate: string[] = [];
  const stillWanted = new Set<string>();
  let resortsWithCams = 0;
  for (const resort of resorts) {
    const hits = matches.get(resort.slug);
    if (!hits?.length) continue;
    resortsWithCams++;
    console.log(`  ${resort.name} (${resort.slug}): ${hits.map((h) => `${h.cam.name} [${h.cam.agency}${h.onAccessRoute ? ", access road" : ""}, ${h.distanceKm.toFixed(1)} km]`).join("; ")}`);
    for (const hit of hits) {
      const prior = existingByKey.get(`${resort.id}|${hit.row.embed_url}`);
      if (prior) {
        stillWanted.add(prior.id);
        if (!prior.is_active) toReactivate.push(prior.id);
      } else {
        toInsert.push(hit.row);
      }
    }
  }
  const toDeactivate = existing.filter((c) => c.is_active && !stillWanted.has(c.id) && (!ONLY_SLUG || resorts.some((r) => r.id === c.resort_id))).map((c) => c.id);

  console.log(`\n[approach-cams] ${resortsWithCams}/${resorts.length} resorts matched; insert ${toInsert.length}, reactivate ${toReactivate.length}, deactivate ${toDeactivate.length}`);
  if (DRY_RUN) {
    console.log("[approach-cams] Dry run: nothing written.");
    return;
  }
  await insertCams(toInsert);
  await setActive(toReactivate, true);
  await setActive(toDeactivate, false);
  console.log("[approach-cams] Done.");
}

main().catch((err) => {
  console.error("[approach-cams] Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
