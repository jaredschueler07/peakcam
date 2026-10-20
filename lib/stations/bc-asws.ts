// ─────────────────────────────────────────────────────────────
// Station layer — BC Automated Snow Weather Stations (ASWS).
//
// The BC River Forecast Centre publishes the current water year as hourly
// CSVs, one file per element, one column per station:
//   https://www.env.gov.bc.ca/wsd/data_searches/snow/asws/data/SD.csv  snow depth, cm
//   …/SW.csv  snow water equivalent, mm      …/TA.csv  air temperature, °C
//   (PC.csv precipitation, and *_Archive.csv for past years)
// Header: `DATE(UTC),1A01P Yellowhead Lake,…`; blank cells are "no reading".
// Station coordinates come from the BC Data Catalogue layer "Automated Snow
// Weather Station Locations" (WHSE_WATER_MANAGEMENT.SSL_SNOW_ASWS_STNS_SP),
// served as GeoJSON by the provincial WFS, keyed by LOCATION_ID (`3A25P`).
//
// Licence: Open Government Licence – British Columbia
// (https://www2.gov.bc.ca/gov/content/data/policy-standards/open-data/open-government-licence-bc).
// Attribution: "Contains information licensed under the Open Government
// Licence – British Columbia (BC River Forecast Centre ASWS)".
// ─────────────────────────────────────────────────────────────

import { celsiusToF, cmToInches, haversineKm, mmToInches, metersToFeet, num, round1, type GeoPointLike, type StationMeta, type StationObservation } from "./types";

export const BC_ASWS_DATA_BASE = "https://www.env.gov.bc.ca/wsd/data_searches/snow/asws/data";
export const BC_ASWS_STATIONS_URL =
  "https://openmaps.gov.bc.ca/geo/pub/wfs?service=WFS&version=2.0.0&request=GetFeature" +
  "&typeName=pub:WHSE_WATER_MANAGEMENT.SSL_SNOW_ASWS_STNS_SP&outputFormat=json&srsName=EPSG:4326";
export const BC_ASWS_CATALOGUE_URL = "https://catalogue.data.gov.bc.ca/dataset/automated-snow-weather-station-data";
export const BC_ASWS_TERMS_URL = "https://www2.gov.bc.ca/gov/content/data/policy-standards/open-data/open-government-licence-bc";
export const BC_ASWS_ATTRIBUTION = "BC River Forecast Centre ASWS (Open Government Licence – BC)";
const DEFAULT_TIMEOUT_MS = 30_000;

export interface BcAswsStation extends StationMeta {
  source: "bc_asws";
  kind: "bc_asws";
  status: string | null;
  operator: string | null;
}

interface WfsFeature {
  geometry?: { coordinates?: number[] } | null;
  properties?: {
    LOCATION_ID?: string;
    LOCATION_NAME?: string;
    ELEVATION?: number | null;
    STATUS?: string | null;
    LATITUDE?: number;
    LONGITUDE?: number;
    OPERATOR?: string | null;
  };
}

/** The WFS GeoJSON → station rows (elevation is metres in the layer). */
export function parseBcAswsStations(json: { features?: WfsFeature[] }): BcAswsStation[] {
  const out: BcAswsStation[] = [];
  for (const f of json.features ?? []) {
    const p = f.properties ?? {};
    const id = p.LOCATION_ID?.trim();
    const lat = num(p.LATITUDE) ?? f.geometry?.coordinates?.[1] ?? null;
    const lng = num(p.LONGITUDE) ?? f.geometry?.coordinates?.[0] ?? null;
    if (!id || lat == null || lng == null) continue;
    const elevM = num(p.ELEVATION);
    out.push({
      source: "bc_asws",
      kind: "bc_asws",
      sourceId: id,
      name: p.LOCATION_NAME?.trim() || id,
      lat,
      lng,
      elevationFt: elevM == null ? null : Math.round(metersToFeet(elevM)),
      status: p.STATUS ?? null,
      operator: p.OPERATOR ?? null,
    });
  }
  return out;
}

export interface AswsLatest {
  /** ISO instant of the newest non-blank cell for the station. */
  observedAt: string;
  value: number;
}

/** `"3A25P Squamish River Upper"` → `"3A25P"`. */
export function aswsColumnId(header: string): string {
  return header.trim().split(/\s+/)[0] ?? header.trim();
}

/** `2026-10-18 22:00` (UTC) → ISO instant. */
function aswsInstant(cell: string): string | null {
  const m = cell.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00.000Z`;
}

/**
 * One element CSV → the newest non-blank reading per station id. Reads the
 * whole file (the current water year, a few hundred KB in October, a few MB
 * by spring) once; callers pass the three parsed maps to `bcAswsObservation`.
 * Sentinel negatives (an unplugged depth sensor reports -1 cm) are blanks.
 */
export function parseAswsCsv(text: string): Map<string, AswsLatest> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return new Map();
  const header = lines[0].split(",");
  const ids = header.map(aswsColumnId);
  const latest = new Map<string, AswsLatest>();
  for (let i = lines.length - 1; i >= 1; i--) {
    const cells = lines[i].split(",");
    const at = aswsInstant(cells[0] ?? "");
    if (!at) continue;
    for (let c = 1; c < cells.length && c < ids.length; c++) {
      if (latest.has(ids[c])) continue;
      const v = num(cells[c]);
      if (v == null || v < 0) continue;
      latest.set(ids[c], { observedAt: at, value: v });
    }
    if (latest.size >= ids.length - 1) break;
  }
  return latest;
}

export interface AswsElementMaps {
  depthCm: Map<string, AswsLatest>;
  sweMm: Map<string, AswsLatest>;
  tempC: Map<string, AswsLatest>;
}

/** Combine the three element files for one station; null when none has a reading for it. */
export function bcAswsObservation(station: BcAswsStation, maps: AswsElementMaps): StationObservation | null {
  const depth = maps.depthCm.get(station.sourceId) ?? null;
  const swe = maps.sweMm.get(station.sourceId) ?? null;
  const temp = maps.tempC.get(station.sourceId) ?? null;
  const stamps = [depth, swe, temp].filter((x): x is AswsLatest => x != null).map((x) => x.observedAt);
  if (!stamps.length) return null;
  stamps.sort();
  return {
    source: station.source,
    sourceId: station.sourceId,
    name: station.name,
    lat: station.lat,
    lng: station.lng,
    elevationFt: station.elevationFt,
    kind: station.kind,
    observedAt: stamps[stamps.length - 1],
    snowDepthIn: depth ? round1(cmToInches(depth.value)) : null,
    sweIn: swe ? round1(mmToInches(swe.value)) : null,
    newSnowIn: null,
    tempF: temp ? round1(celsiusToF(temp.value)) : null,
    windMph: null,
    payload: { snowDepthCm: depth, sweMm: swe, airTempC: temp, operator: station.operator, status: station.status },
  };
}

export function nearestBcAswsStations(point: GeoPointLike, stations: readonly BcAswsStation[], { maxKm = 25, limit = 10 } = {}) {
  return stations
    .filter((s) => !s.status || /active/i.test(s.status))
    .map((s) => ({ ...s, distanceKm: haversineKm(point, s) }))
    .filter((s) => s.distanceKm <= maxKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}

// ── Network ──────────────────────────────────────────────────

export interface BcAswsFetchOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

async function getText(url: string, options: BcAswsFetchOptions): Promise<string> {
  const f = options.fetchImpl ?? fetch;
  const res = await f(url, { signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`BC ASWS ${res.status} for ${url}`);
  return res.text();
}

export async function fetchBcAswsStations(options: BcAswsFetchOptions = {}): Promise<BcAswsStation[]> {
  return parseBcAswsStations(JSON.parse(await getText(BC_ASWS_STATIONS_URL, options)));
}

/** The three current-water-year element files, parsed to latest-per-station maps. One download set per sync. */
export async function fetchBcAswsElements(options: BcAswsFetchOptions = {}): Promise<AswsElementMaps> {
  const [sd, sw, ta] = await Promise.all([
    getText(`${BC_ASWS_DATA_BASE}/SD.csv`, options),
    getText(`${BC_ASWS_DATA_BASE}/SW.csv`, options),
    getText(`${BC_ASWS_DATA_BASE}/TA.csv`, options),
  ]);
  return { depthCm: parseAswsCsv(sd), sweMm: parseAswsCsv(sw), tempC: parseAswsCsv(ta) };
}
