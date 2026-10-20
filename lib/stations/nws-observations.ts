// ─────────────────────────────────────────────────────────────
// Station layer — NWS surface observations (api.weather.gov).
//
// Two discovery paths. `/points/{lat},{lon}` → `observationStations` is the
// documented one, but that list is the forecast grid's METAR set: for Alta
// it is 27 airports and one UDOT sensor, nothing above 7,200 ft. The state
// listing `/stations?state=UT` (paginated, 500 a page) carries the MADIS
// mesonet rows too — Alta Mt Baldy at 11,066 ft, Hidden Peak, Top of
// Collins — so the sync caches one state listing per run and ranks by
// distance, falling back to the points list when a state has none.
// `/stations/{id}/observations/latest` gives temperature (°C), wind (km/h)
// and, where the sensor reports it, nothing about snow: METAR has no depth.
//
// Rules: a User-Agent that identifies the app (lib/weather.ts's
// NWS_USER_AGENT), 5 s timeout per call, no key. NWS data is US public
// domain; attribution "NOAA National Weather Service".
// ─────────────────────────────────────────────────────────────

import { NWS_USER_AGENT, NWS_TIMEOUT_MS } from "../weather";
import {
  celsiusToF,
  haversineKm,
  kmhToMph,
  metersToFeet,
  msToMph,
  num,
  round1,
  type GeoPointLike,
  type StationMeta,
  type StationObservation,
} from "./types";

export const NWS_API_BASE = "https://api.weather.gov";
export const NWS_ATTRIBUTION = "NOAA National Weather Service";
export const NWS_TERMS_URL = "https://www.weather.gov/disclaimer";
/** Cap on state-listing pages (500 rows each); the largest states fit in three. */
export const NWS_MAX_STATION_PAGES = 6;

interface NwsQuantity {
  unitCode?: string;
  value: number | null;
  qualityControl?: string;
}

interface NwsStationFeature {
  geometry?: { coordinates?: [number, number] } | null;
  properties?: {
    stationIdentifier?: string;
    name?: string;
    elevation?: NwsQuantity | null;
  };
}

export interface NwsStationCollection {
  features?: NwsStationFeature[];
  pagination?: { next?: string };
  /** `/points` style: the URL of the gridpoint's station list. */
  properties?: { observationStations?: string };
}

export interface NwsObservationDocument {
  properties?: {
    timestamp?: string;
    temperature?: NwsQuantity | null;
    windSpeed?: NwsQuantity | null;
    windGust?: NwsQuantity | null;
    windDirection?: NwsQuantity | null;
    textDescription?: string;
    rawMessage?: string;
    elevation?: NwsQuantity | null;
  };
}

/** METAR identifiers are four letters starting with K/C/P; everything else is a mesonet or RAWS sensor. */
export function nwsStationKind(id: string): StationMeta["kind"] {
  return /^[KCP][A-Z0-9]{3}$/.test(id) ? "metar" : "nws_obs";
}

/** A `/stations` FeatureCollection → station metadata rows; rows without an id or coordinates are dropped. */
export function parseNwsStations(json: NwsStationCollection): StationMeta[] {
  const out: StationMeta[] = [];
  for (const feature of json.features ?? []) {
    const id = feature.properties?.stationIdentifier;
    const coords = feature.geometry?.coordinates;
    if (!id || !coords || coords.length < 2) continue;
    const [lng, lat] = coords;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const elevM = num(feature.properties?.elevation?.value);
    out.push({
      source: "nws",
      sourceId: id,
      name: feature.properties?.name?.trim() || id,
      lat,
      lng,
      elevationFt: elevM == null ? null : Math.round(metersToFeet(elevM)),
      kind: nwsStationKind(id),
    });
  }
  return out;
}

export interface NearestOptions {
  maxKm?: number;
  limit?: number;
}

/** Stations within `maxKm` of a point, nearest first. */
export function nearestStations<T extends GeoPointLike>(point: GeoPointLike, stations: readonly T[], { maxKm = 25, limit = 10 }: NearestOptions = {}): Array<T & { distanceKm: number }> {
  return stations
    .map((s) => ({ ...s, distanceKm: haversineKm(point, s) }))
    .filter((s) => Number.isFinite(s.distanceKm) && s.distanceKm <= maxKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}

/** A quantity in °C → °F, respecting the unit code when NWS sends °F. */
function tempF(q: NwsQuantity | null | undefined): number | null {
  const v = num(q?.value);
  if (v == null) return null;
  return q?.unitCode?.endsWith("degF") ? v : celsiusToF(v);
}

/** A wind quantity → mph; NWS sends km/h today and m/s historically. */
function windMph(q: NwsQuantity | null | undefined): number | null {
  const v = num(q?.value);
  if (v == null) return null;
  if (q?.unitCode?.endsWith("m_s-1")) return msToMph(v);
  if (q?.unitCode?.endsWith("mi_h-1")) return v;
  return kmhToMph(v);
}

/** `/stations/{id}/observations/latest` → a StationObservation; null without a timestamp. */
export function parseNwsObservation(meta: StationMeta, json: NwsObservationDocument): StationObservation | null {
  const p = json.properties;
  if (!p?.timestamp) return null;
  const ms = Date.parse(p.timestamp);
  if (Number.isNaN(ms)) return null;
  return {
    ...meta,
    observedAt: new Date(ms).toISOString(),
    snowDepthIn: null,
    sweIn: null,
    newSnowIn: null,
    tempF: round1(tempF(p.temperature)),
    windMph: round1(windMph(p.windSpeed)),
    payload: {
      timestamp: p.timestamp,
      temperature: p.temperature ?? null,
      windSpeed: p.windSpeed ?? null,
      windGust: p.windGust ?? null,
      windDirection: p.windDirection ?? null,
      textDescription: p.textDescription ?? null,
      rawMessage: p.rawMessage ?? null,
    },
  };
}

// ── Network ──────────────────────────────────────────────────

export interface NwsFetchOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

async function nwsGet<T>(url: string, options: NwsFetchOptions): Promise<T | null> {
  const f = options.fetchImpl ?? fetch;
  const res = await f(url, {
    headers: { "User-Agent": NWS_USER_AGENT, Accept: "application/geo+json" },
    signal: AbortSignal.timeout(options.timeoutMs ?? NWS_TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`NWS ${res.status} for ${url}`);
  return (await res.json()) as T;
}

/**
 * Every observation station NWS lists for a state (two-letter code), across
 * the paginated listing. Callers cache the result: one call per state per
 * sync, not per resort.
 */
export async function fetchNwsStationsByState(state: string, options: NwsFetchOptions = {}): Promise<StationMeta[]> {
  const out: StationMeta[] = [];
  let url: string | undefined = `${NWS_API_BASE}/stations?${new URLSearchParams({ state: state.toUpperCase(), limit: "500" })}`;
  for (let page = 0; url && page < NWS_MAX_STATION_PAGES; page++) {
    const json: NwsStationCollection | null = await nwsGet<NwsStationCollection>(url, options);
    if (!json) break;
    const rows = parseNwsStations(json);
    out.push(...rows);
    url = rows.length === 500 ? json.pagination?.next : undefined;
  }
  return out;
}

/** The forecast grid's own station list for a point (`/points` → `observationStations`). */
export async function fetchNwsStationsForPoint(point: GeoPointLike, options: NwsFetchOptions = {}): Promise<StationMeta[]> {
  const points = await nwsGet<NwsStationCollection>(`${NWS_API_BASE}/points/${point.lat.toFixed(4)},${point.lng.toFixed(4)}`, options);
  const url = points?.properties?.observationStations;
  if (!url) return [];
  const list = await nwsGet<NwsStationCollection>(url, options);
  return list ? parseNwsStations(list) : [];
}

/** Latest observation for one station; null when NWS has none (404) or the document is empty. */
export async function fetchNwsLatestObservation(meta: StationMeta, options: NwsFetchOptions = {}): Promise<StationObservation | null> {
  const json = await nwsGet<NwsObservationDocument>(`${NWS_API_BASE}/stations/${encodeURIComponent(meta.sourceId)}/observations/latest`, options);
  return json ? parseNwsObservation(meta, json) : null;
}
