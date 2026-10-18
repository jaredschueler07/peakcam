#!/usr/bin/env tsx

/**
 * stations-sync.ts
 * ────────────────
 * The station layer's hourly job (parity plan block P3). For every active
 * resort it gathers candidate stations from the open networks that cover it,
 * picks up to three by role (summit / mid / base, lib/stations/assign.ts),
 * and stores them:
 *
 *   stations             upsert on (source, source_id)
 *   resort_stations      the resort's current set (rows no longer chosen are removed)
 *   station_observations insert, idempotent on (station_id, observed_at)
 *
 * Sources, in priority order: SNOTEL (the resort's own triplet, via the same
 * AWDB calls and QC as snotel-sync), GHCN-Daily (NCEI, nearest active snow
 * reporters), then hourly NWS observations (US) or BC ASWS + ECCC SWOB (CA).
 * SNOTEL stays the base-depth truth: the snow report is untouched by this job.
 *
 * Usage:
 *   npx tsx scripts/stations-sync.ts                 # every active resort, writes
 *   npx tsx scripts/stations-sync.ts --dry-run       # fetch and print, write nothing
 *   npx tsx scripts/stations-sync.ts --resort alta   # one resort (combine with --dry-run)
 *   npx tsx scripts/stations-sync.ts --no-ghcn       # skip NCEI (it is often slow)
 *
 * Reads:  .env.local (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
 *         A dry run needs no service key: it reads the catalogue with the
 *         anon key when present, else from data/resorts.csv.
 * Writes: stations, resort_stations, station_observations (service role).
 * Cache:  data/cache/ghcnd-{stations,inventory}.txt (gitignored, refreshed weekly).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseCsv } from "csv-parse/sync";

import { assignStations, type AssignedStation, type Candidate, MAX_STATION_DISTANCE_KM } from "../lib/stations/assign.js";
import { haversineKm, ageMinutes, type StationMeta, type StationObservation } from "../lib/stations/types.js";
import { STATION_SOURCES } from "../lib/stations/index.js";
import { fetchSnotelObservation, normalizeTriplet } from "../lib/stations/snotel.js";
import { fetchNwsLatestObservation, fetchNwsStationsByState, fetchNwsStationsForPoint, nearestStations } from "../lib/stations/nws-observations.js";
import { GHCND_INVENTORY_URL, GHCND_STATIONS_URL, fetchGhcnObservation, nearestGhcnStations, parseGhcndInventory, parseGhcndStations, type GhcnStation } from "../lib/stations/ghcn.js";
import { bcAswsObservation, fetchBcAswsElements, fetchBcAswsStations, nearestBcAswsStations, type AswsElementMaps, type BcAswsStation } from "../lib/stations/bc-asws.js";
import { fetchEcccObservations } from "../lib/stations/eccc.js";

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
const SKIP_GHCN = args.includes("--no-ghcn");
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

const CACHE_DIR = path.join(ROOT, "data", "cache");
const GHCN_CACHE_MAX_AGE_MS = 7 * 24 * 3600_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Resorts ──────────────────────────────────────────────────────────────

interface ResortRow {
  id: string;
  slug: string;
  name: string;
  state: string;
  country: string;
  lat: number;
  lng: number;
  snotel_station_id: string | null;
  elevation_base_ft: number | null;
  elevation_summit_ft: number | null;
}

async function fetchResorts(): Promise<ResortRow[]> {
  const key = SERVICE_KEY ?? ANON_KEY;
  if (SUPABASE_URL && key) {
    const select = "id,slug,name,state,country,lat,lng,snotel_station_id,elevation_base_ft,elevation_summit_ft";
    let url = `${SUPABASE_URL}/rest/v1/resorts?select=${select}&is_active=eq.true&order=slug`;
    if (ONLY_SLUG) url += `&slug=eq.${encodeURIComponent(ONLY_SLUG)}`;
    const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (res.ok) return (await res.json()) as ResortRow[];
    // Migration 025 not applied yet: the elevation columns are missing; fall back to the legacy table.
    console.warn(`[stations-sync] resorts query ${res.status}; retrying without the 025 elevation columns`);
    const legacy = await fetch(url.replace(",elevation_base_ft,elevation_summit_ft", ",resort_metadata(elevation_base_ft,elevation_summit_ft)"), {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!legacy.ok) throw new Error(`Supabase resorts fetch failed: ${legacy.status}`);
    const rows = (await legacy.json()) as Array<ResortRow & { resort_metadata: { elevation_base_ft: number | null; elevation_summit_ft: number | null } | null }>;
    return rows.map((r) => ({ ...r, elevation_base_ft: r.resort_metadata?.elevation_base_ft ?? null, elevation_summit_ft: r.resort_metadata?.elevation_summit_ft ?? null }));
  }
  // No keys at all (a dev box): the seed CSV has everything but ids.
  const csv = fs.readFileSync(path.join(ROOT, "data", "resorts.csv"), "utf-8");
  const rows = parseCsv(csv, { columns: true, skip_empty_lines: true, relax_column_count: true }) as Record<string, string>[];
  return rows
    .filter((r) => r.is_active !== "false" && (!ONLY_SLUG || r.slug === ONLY_SLUG))
    .map((r) => ({
      id: `csv:${r.slug}`,
      slug: r.slug,
      name: r.name,
      state: r.state,
      country: r.country || "US",
      lat: Number(r.lat),
      lng: Number(r.lng),
      snotel_station_id: r.snotel_station_id || null,
      elevation_base_ft: r.elevation_base_ft ? Number(r.elevation_base_ft) : null,
      elevation_summit_ft: r.elevation_summit_ft ? Number(r.elevation_summit_ft) : null,
    }));
}

// ─── Per-network caches (one download per run) ────────────────────────────

const nwsByState = new Map<string, Promise<StationMeta[]>>();
function nwsStations(state: string): Promise<StationMeta[]> {
  let p = nwsByState.get(state);
  if (!p) {
    p = fetchNwsStationsByState(state).catch((err) => {
      console.warn(`  [nws] state listing ${state} failed: ${err instanceof Error ? err.message : err}`);
      return [];
    });
    nwsByState.set(state, p);
  }
  return p;
}

async function cachedText(url: string, file: string): Promise<string> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const target = path.join(CACHE_DIR, file);
  if (fs.existsSync(target) && Date.now() - fs.statSync(target).mtimeMs < GHCN_CACHE_MAX_AGE_MS) return fs.readFileSync(target, "utf-8");
  // NCEI serves these 11 MB files slowly; a weekly refresh can afford five minutes.
  const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  const text = await res.text();
  fs.writeFileSync(target, text);
  return text;
}

let ghcnIndex: Promise<{ stations: GhcnStation[]; active: Set<string> } | null> | null = null;
function ghcnStations() {
  if (!ghcnIndex) {
    ghcnIndex = (async () => {
      try {
        const [stationsText, inventoryText] = await Promise.all([
          cachedText(GHCND_STATIONS_URL, "ghcnd-stations.txt"),
          cachedText(GHCND_INVENTORY_URL, "ghcnd-inventory.txt"),
        ]);
        const minYear = new Date().getUTCFullYear() - 1;
        return { stations: parseGhcndStations(stationsText), active: parseGhcndInventory(inventoryText, minYear) };
      } catch (err) {
        console.warn(`  [ghcn] inventory unavailable: ${err instanceof Error ? err.message : err}`);
        return null;
      }
    })();
  }
  return ghcnIndex;
}

let bcIndex: Promise<{ stations: BcAswsStation[]; elements: AswsElementMaps } | null> | null = null;
function bcAsws() {
  if (!bcIndex) {
    bcIndex = (async () => {
      try {
        const [stations, elements] = await Promise.all([fetchBcAswsStations(), fetchBcAswsElements()]);
        return { stations, elements };
      } catch (err) {
        console.warn(`  [bc-asws] unavailable: ${err instanceof Error ? err.message : err}`);
        return null;
      }
    })();
  }
  return bcIndex;
}

// ─── Candidates per resort ────────────────────────────────────────────────

async function collectCandidates(resort: ResortRow): Promise<Candidate[]> {
  const point = { lat: resort.lat, lng: resort.lng };
  const out: Candidate[] = [];
  const add = (obs: StationObservation | null | undefined) => {
    if (obs) out.push({ observation: obs, distanceKm: haversineKm(point, obs) });
  };

  // SNOTEL: the resort's own station, exactly as snotel-sync reads it.
  if (resort.snotel_station_id) {
    try {
      add(await fetchSnotelObservation(normalizeTriplet(resort.snotel_station_id, resort.state)));
    } catch (err) {
      console.warn(`  [snotel] ${resort.slug}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // GHCN-Daily: nearest active snow reporters (US and CA).
  if (!SKIP_GHCN && (resort.country === "US" || resort.country === "CA")) {
    const index = await ghcnStations();
    if (index) {
      for (const station of nearestGhcnStations(point, index.stations, { active: index.active, maxKm: MAX_STATION_DISTANCE_KM, limit: 3 })) {
        try {
          add(await fetchGhcnObservation(station, { timeoutMs: 20_000 }));
        } catch (err) {
          console.warn(`  [ghcn] ${station.sourceId}: ${err instanceof Error ? err.message : err}`);
        }
      }
    }
  }

  if (resort.country === "US") {
    let stations = await nwsStations(resort.state);
    if (!stations.length) stations = await fetchNwsStationsForPoint(point).catch(() => []);
    // The eight nearest by distance, plus the highest sensor in range (the
    // summit role is what the airports cannot fill) and the sensor nearest
    // the mid-mountain elevation, so every band has a candidate when one exists.
    const near = nearestStations(point, stations, { maxKm: MAX_STATION_DISTANCE_KM, limit: 60 });
    const picked = near.slice(0, 8);
    const highest = [...near].sort((a, b) => (b.elevationFt ?? 0) - (a.elevationFt ?? 0))[0];
    if (highest && !picked.includes(highest)) picked.push(highest);
    if (resort.elevation_base_ft != null && resort.elevation_summit_ft != null) {
      const midFt = (resort.elevation_base_ft + resort.elevation_summit_ft) / 2;
      const nearestMid = [...near].filter((s) => s.elevationFt != null).sort((a, b) => Math.abs(a.elevationFt! - midFt) - Math.abs(b.elevationFt! - midFt))[0];
      if (nearestMid && !picked.includes(nearestMid)) picked.push(nearestMid);
    }
    for (const station of picked) {
      try {
        add(await fetchNwsLatestObservation(station));
      } catch (err) {
        console.warn(`  [nws] ${station.sourceId}: ${err instanceof Error ? err.message : err}`);
      }
      await sleep(150);
    }
  } else if (resort.country === "CA") {
    if (resort.state === "BC") {
      const bc = await bcAsws();
      if (bc) for (const station of nearestBcAswsStations(point, bc.stations, { maxKm: MAX_STATION_DISTANCE_KM, limit: 4 })) add(bcAswsObservation(station, bc.elements));
    }
    try {
      for (const obs of (await fetchEcccObservations(point, { radiusKm: MAX_STATION_DISTANCE_KM })).slice(0, 6)) add(obs);
    } catch (err) {
      console.warn(`  [eccc] ${resort.slug}: ${err instanceof Error ? err.message : err}`);
    }
  }
  // Andes resorts: no open station network with an API; Open-Meteo stays their source (model-sync).
  return out;
}

// ─── Writes ───────────────────────────────────────────────────────────────

async function upsertStations(metas: StationMeta[]): Promise<Map<string, string>> {
  const body = metas.map((m) => ({ source: m.source, source_id: m.sourceId, name: m.name, lat: m.lat, lng: m.lng, elevation_ft: m.elevationFt == null ? null : Math.round(m.elevationFt), kind: m.kind }));
  const res = await fetch(`${SUPABASE_URL}/rest/v1/stations?on_conflict=source,source_id&select=id,source,source_id`, {
    method: "POST",
    headers: { ...writeHeaders, Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`stations upsert failed (${res.status}): ${await res.text()}`);
  const rows = (await res.json()) as Array<{ id: string; source: string; source_id: string }>;
  return new Map(rows.map((r) => [`${r.source}:${r.source_id}`, r.id]));
}

async function replaceResortStations(resortId: string, assigned: AssignedStation[], ids: Map<string, string>): Promise<void> {
  const rows = assigned.map((a) => ({
    resort_id: resortId,
    station_id: ids.get(`${a.observation.source}:${a.observation.sourceId}`)!,
    role: a.role,
    distance_km: Math.round(a.distanceKm * 10) / 10,
    rank: a.rank,
  }));
  if (rows.length) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/resort_stations?on_conflict=resort_id,station_id`, {
      method: "POST",
      headers: { ...writeHeaders, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(rows),
    });
    if (!res.ok) throw new Error(`resort_stations upsert failed (${res.status}): ${await res.text()}`);
  }
  // Stations no longer chosen for this resort leave the set, so a role never points at a stale sensor.
  const keep = rows.map((r) => r.station_id);
  const filter = keep.length ? `&station_id=not.in.(${keep.join(",")})` : "";
  const del = await fetch(`${SUPABASE_URL}/rest/v1/resort_stations?resort_id=eq.${resortId}&role=neq.approach${filter}`, { method: "DELETE", headers: writeHeaders });
  if (!del.ok) throw new Error(`resort_stations prune failed (${del.status}): ${await del.text()}`);
}

async function insertObservations(assigned: AssignedStation[], ids: Map<string, string>): Promise<void> {
  const rows = assigned.map((a) => {
    const o = a.observation;
    return {
      station_id: ids.get(`${o.source}:${o.sourceId}`)!,
      observed_at: o.observedAt,
      snow_depth_in: o.snowDepthIn,
      swe_in: o.sweIn,
      new_snow_in: o.newSnowIn,
      temp_f: o.tempF,
      wind_mph: o.windMph,
      source_payload: o.payload,
    };
  });
  if (!rows.length) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/station_observations?on_conflict=station_id,observed_at`, {
    method: "POST",
    headers: { ...writeHeaders, Prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`station_observations insert failed (${res.status}): ${await res.text()}`);
}

// ─── Output ───────────────────────────────────────────────────────────────

function describe(a: AssignedStation, now: Date): string {
  const o = a.observation;
  const parts = [
    `${a.role} ${o.name} (${STATION_SOURCES[o.source].label} ${o.sourceId}${o.elevationFt != null ? `, ${o.elevationFt.toLocaleString("en-US")} ft` : ""}, ${a.distanceKm.toFixed(1)} km)`,
  ];
  const vals: string[] = [];
  if (o.snowDepthIn != null) vals.push(`depth ${o.snowDepthIn} in`);
  if (o.newSnowIn != null) vals.push(`new ${o.newSnowIn} in`);
  if (o.sweIn != null) vals.push(`SWE ${o.sweIn} in`);
  if (o.tempF != null) vals.push(`${o.tempF} °F`);
  if (o.windMph != null) vals.push(`${o.windMph} mph`);
  const age = ageMinutes(o.observedAt, now);
  parts.push(vals.length ? vals.join(", ") : "no values");
  parts.push(age == null ? "" : age < 120 ? `${age} min ago` : age < 2880 ? `${Math.round(age / 60)} h ago` : `${Math.round(age / 1440)} d ago`);
  return parts.filter(Boolean).join(" — ");
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const now = new Date();
  console.log(`[stations-sync] ${DRY_RUN ? "DRY RUN — " : ""}starting${ONLY_SLUG ? ` for ${ONLY_SLUG}` : ""}${SKIP_GHCN ? " (GHCN skipped)" : ""}\n`);
  const resorts = await fetchResorts();
  if (!resorts.length) {
    console.error(`[stations-sync] no resorts${ONLY_SLUG ? ` matching "${ONLY_SLUG}"` : ""}`);
    process.exit(1);
  }
  console.log(`[stations-sync] ${resorts.length} resorts\n`);

  let withStations = 0;
  let twoPlus = 0;
  let failed = 0;
  const bySource = new Map<string, number>();

  for (const resort of resorts) {
    try {
      const candidates = await collectCandidates(resort);
      const assigned = assignStations(candidates, { baseFt: resort.elevation_base_ft, summitFt: resort.elevation_summit_ft });
      if (!assigned.length) {
        console.log(`  NONE ${resort.name} — ${candidates.length} candidates, none within ${MAX_STATION_DISTANCE_KM} km`);
        continue;
      }
      withStations++;
      if (new Set(assigned.map((a) => a.observation.source)).size >= 2) twoPlus++;
      for (const a of assigned) bySource.set(a.observation.source, (bySource.get(a.observation.source) ?? 0) + 1);

      if (!DRY_RUN) {
        const ids = await upsertStations(assigned.map((a) => a.observation));
        await replaceResortStations(resort.id, assigned, ids);
        await insertObservations(assigned, ids);
      }
      console.log(`  OK   ${resort.name} (${resort.slug}) — ${candidates.length} candidates, ${assigned.length} kept`);
      for (const a of assigned) console.log(`       ${describe(a, now)}`);
    } catch (err) {
      failed++;
      console.error(`  FAIL ${resort.name} — ${err instanceof Error ? err.message : String(err)}`);
    }
    await sleep(200);
  }

  const sources = [...bySource.entries()].map(([s, n]) => `${s} ${n}`).join(", ");
  console.log(`\n[stations-sync] Done. ${withStations}/${resorts.length} resorts with ≥1 station, ${twoPlus} with ≥2 sources, ${failed} failed. Stations by source: ${sources || "none"}.${DRY_RUN ? " Nothing written." : ""}`);
}

main().catch((err) => {
  console.error("[stations-sync] Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
