// ─────────────────────────────────────────────────────────────
// Station layer — GHCN-Daily via the NCEI Access Data Service.
//
// Data: https://www.ncei.noaa.gov/access/services/data/v1?dataset=daily-summaries
//   &dataTypes=SNOW,SNWD,TMAX,TMIN&stations=…&startDate=…&endDate=…&format=json
//   &units=standard&includeStationName=true&includeStationLocation=1
//   — no token; `units=standard` returns inches and °F (default is metric
//   tenths). Rows are strings; a missing element is an absent key or "".
// Discovery: the GHCND station inventory, two fixed-width files cached
// locally by the sync (`ghcnd-stations.txt`, 11 MB, and `ghcnd-inventory.txt`
// with first/last year per element), filtered to stations that still
// report SNWD or SNOW this water year.
//
// Terms: NOAA NCEI data are US public domain; NCEI asks for the citation
// "Menne et al., GHCN-Daily, NOAA NCEI". Attribution: "NOAA NCEI GHCN-Daily".
// ─────────────────────────────────────────────────────────────

import { endOfDayUtc, haversineKm, isoDay, metersToFeet, num, round1, type GeoPointLike, type StationMeta, type StationObservation } from "./types";

export const NCEI_DATA_URL = "https://www.ncei.noaa.gov/access/services/data/v1";
export const GHCND_STATIONS_URL = "https://www.ncei.noaa.gov/pub/data/ghcn/daily/ghcnd-stations.txt";
export const GHCND_INVENTORY_URL = "https://www.ncei.noaa.gov/pub/data/ghcn/daily/ghcnd-inventory.txt";
export const GHCN_ATTRIBUTION = "NOAA NCEI GHCN-Daily";
export const GHCN_TERMS_URL = "https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.ncdc:C00861";
export const GHCN_DATA_TYPES = "SNOW,SNWD,TMAX,TMIN";
const DEFAULT_TIMEOUT_MS = 30_000;

export interface GhcnStation extends StationMeta {
  source: "ghcn";
  kind: "ghcn";
  /** ISO 3166-1 alpha-2 derived from the id prefix (US, CA). */
  country: string;
  /** US state / CA province from the inventory, when the row carries one. */
  state: string | null;
}

/**
 * ghcnd-stations.txt is fixed width (readme.txt, section IV):
 *   ID 1-11, LATITUDE 13-20, LONGITUDE 22-30, ELEVATION 32-37 (m, -999.9 missing),
 *   STATE 39-40, NAME 42-71, GSN FLAG 73-75, HCN/CRN FLAG 77-79, WMO ID 81-85.
 */
export function parseGhcndStations(text: string, countries: readonly string[] = ["US", "CA"]): GhcnStation[] {
  const out: GhcnStation[] = [];
  for (const line of text.split("\n")) {
    if (line.length < 41) continue;
    const id = line.slice(0, 11).trim();
    const country = id.slice(0, 2);
    if (!countries.includes(country)) continue;
    const lat = num(line.slice(12, 20));
    const lng = num(line.slice(21, 30));
    if (lat == null || lng == null) continue;
    const elevM = num(line.slice(31, 37));
    const state = line.slice(38, 40).trim() || null;
    const name = line.slice(41, 71).trim();
    out.push({
      source: "ghcn",
      kind: "ghcn",
      sourceId: id,
      name: name || id,
      lat,
      lng,
      elevationFt: elevM == null || elevM <= -999 ? null : Math.round(metersToFeet(elevM)),
      country,
      state,
    });
  }
  return out;
}

/**
 * ghcnd-inventory.txt: ID 1-11, LAT, LON, ELEMENT 32-35, FIRSTYEAR 37-40, LASTYEAR 42-45.
 * Returns the ids whose SNWD or SNOW series reaches `minLastYear`.
 */
export function parseGhcndInventory(text: string, minLastYear: number, elements: readonly string[] = ["SNWD", "SNOW"]): Set<string> {
  const ids = new Set<string>();
  for (const line of text.split("\n")) {
    if (line.length < 45) continue;
    const element = line.slice(31, 35);
    if (!elements.includes(element)) continue;
    const last = Number(line.slice(41, 45));
    if (last >= minLastYear) ids.add(line.slice(0, 11).trim());
  }
  return ids;
}

/** Stations within `maxKm`, nearest first, limited to those in `active` when given. */
export function nearestGhcnStations(point: GeoPointLike, stations: readonly GhcnStation[], { maxKm = 25, limit = 10, active }: { maxKm?: number; limit?: number; active?: Set<string> } = {}) {
  return stations
    .filter((s) => !active || active.has(s.sourceId))
    .map((s) => ({ ...s, distanceKm: haversineKm(point, s) }))
    .filter((s) => s.distanceKm <= maxKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}

/** One row of the Access Data Service JSON (every value a string). */
export interface GhcnDailyRow {
  DATE: string;
  STATION: string;
  NAME?: string;
  LATITUDE?: string;
  LONGITUDE?: string;
  ELEVATION?: string;
  SNOW?: string;
  SNWD?: string;
  TMAX?: string;
  TMIN?: string;
}

/**
 * The newest row that measured anything → a StationObservation. Daily values
 * are stamped at the end of their day (UTC); COOP observers read once a day,
 * so a row is "yesterday's snow" by the time it is published.
 */
export function parseGhcnDaily(meta: StationMeta, rows: readonly GhcnDailyRow[]): StationObservation | null {
  const measured = rows
    .filter((r) => r.DATE && [r.SNOW, r.SNWD, r.TMAX, r.TMIN].some((v) => num(v) != null))
    .sort((a, b) => (a.DATE < b.DATE ? -1 : a.DATE > b.DATE ? 1 : 0));
  const latest = measured[measured.length - 1];
  if (!latest) return null;
  const tmax = num(latest.TMAX);
  const tmin = num(latest.TMIN);
  const elevM = num(latest.ELEVATION);
  return {
    ...meta,
    name: latest.NAME?.trim() || meta.name,
    elevationFt: meta.elevationFt ?? (elevM == null ? null : Math.round(metersToFeet(elevM))),
    observedAt: endOfDayUtc(latest.DATE.slice(0, 10)),
    snowDepthIn: round1(num(latest.SNWD)),
    sweIn: null,
    newSnowIn: round1(num(latest.SNOW)),
    // A daily station has no spot temperature: the day's mean of max/min is the honest stand-in.
    tempF: tmax != null && tmin != null ? round1((tmax + tmin) / 2) : round1(tmax ?? tmin),
    windMph: null,
    payload: { ...latest },
  };
}

// ── Network ──────────────────────────────────────────────────

export interface GhcnFetchOptions {
  fetchImpl?: typeof fetch;
  now?: Date;
  /** Days back to request; COOP rows arrive a day or two late. */
  days?: number;
  timeoutMs?: number;
}

export function ghcnDailyUrl(stationId: string, startDate: string, endDate: string): string {
  const params = new URLSearchParams({
    dataset: "daily-summaries",
    dataTypes: GHCN_DATA_TYPES,
    stations: stationId,
    startDate,
    endDate,
    format: "json",
    units: "standard",
    includeStationName: "true",
    includeStationLocation: "1",
  });
  return `${NCEI_DATA_URL}?${params}`;
}

export async function fetchGhcnObservation(meta: StationMeta, options: GhcnFetchOptions = {}): Promise<StationObservation | null> {
  const f = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - (options.days ?? 10));
  const res = await f(ghcnDailyUrl(meta.sourceId, isoDay(start), isoDay(now)), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`NCEI ${res.status} for ${meta.sourceId}`);
  const rows = (await res.json()) as GhcnDailyRow[];
  return parseGhcnDaily(meta, Array.isArray(rows) ? rows : []);
}
