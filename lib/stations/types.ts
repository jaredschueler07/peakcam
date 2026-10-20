// ─────────────────────────────────────────────────────────────
// Station layer — shared shapes and unit helpers.
//
// Every fetcher under lib/stations/ (SNOTEL, NWS observations, GHCN-Daily,
// BC ASWS, ECCC SWOB) returns the same normalised StationObservation, so
// scripts/stations-sync.ts can rank and store them without knowing which
// agency produced the number. Pure: no fetch, no env, no Node-only imports,
// so the fetchers' parse functions and this module run in node:test with
// recorded fixtures and in the Next.js server alike.
// ─────────────────────────────────────────────────────────────

/** Provider slug, stored in `stations.source` (migration 026). */
export type StationSource = "snotel" | "nws" | "ghcn" | "bc_asws" | "eccc";

/** `stations.kind` — the instrument class, finer than the provider. */
export type StationKind = "snotel" | "scan" | "nws_obs" | "metar" | "ghcn" | "bc_asws" | "eccc" | "road_cam";

/** `resort_stations.role`: where the station sits relative to the resort. */
export type StationRole = "summit" | "mid" | "base" | "approach";

export const STATION_ROLES: readonly StationRole[] = ["summit", "mid", "base", "approach"];

/** A station's fixed metadata; one `stations` row. */
export interface StationMeta {
  source: StationSource;
  /** Provider's own id: NRCS triplet, NWS station id, GHCN id, BC location id, MSC id. */
  sourceId: string;
  name: string;
  lat: number;
  lng: number;
  elevationFt: number | null;
  kind: StationKind;
}

/** The normalised reading every fetcher returns. `null` means "not measured here", never zero. */
export interface StationObservation extends StationMeta {
  /** ISO-8601 UTC instant of the observation (a daily value is stamped at the day's end, UTC). */
  observedAt: string;
  snowDepthIn: number | null;
  sweIn: number | null;
  /** New snow over the provider's own period: 24 h for daily sources, null for hourly ones. */
  newSnowIn: number | null;
  tempF: number | null;
  windMph: number | null;
  /** The provider's record as received, for `station_observations.source_payload`. */
  payload: Record<string, unknown>;
}

export interface GeoPointLike {
  lat: number;
  lng: number;
}

// ── Units ────────────────────────────────────────────────────

export const KM_PER_MILE = 1.609344;

const DEG_TO_RAD = Math.PI / 180;
/** IUGG mean Earth radius, km. */
const EARTH_RADIUS_KM = 6371.0088;

/** Great-circle distance in kilometres (lib/geo.ts has the miles version for the page). */
export function haversineKm(a: GeoPointLike, b: GeoPointLike): number {
  const lat1 = a.lat * DEG_TO_RAD;
  const lat2 = b.lat * DEG_TO_RAD;
  const dLat = lat2 - lat1;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

export function metersToFeet(m: number): number {
  return m * 3.28084;
}

export function cmToInches(cm: number): number {
  return cm / 2.54;
}

export function mmToInches(mm: number): number {
  return mm / 25.4;
}

export function celsiusToF(c: number): number {
  return (c * 9) / 5 + 32;
}

export function kmhToMph(kmh: number): number {
  return kmh / KM_PER_MILE;
}

export function msToMph(ms: number): number {
  return ms * 2.236936;
}

/** A finite number or null; strings are parsed, blanks and sentinels (-99, -9999) become null. */
export function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return null;
  if (n === -99 || n === -999 || n === -9999) return null;
  return n;
}

/** Round to one decimal for storage; null passes through. */
export function round1(value: number | null): number | null {
  return value == null ? null : Math.round(value * 10) / 10;
}

/** Whole minutes between an observation and `now`; null when the instant does not parse. */
export function ageMinutes(observedAt: string | null | undefined, now: Date): number | null {
  if (!observedAt) return null;
  const ms = Date.parse(observedAt);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.round((now.getTime() - ms) / 60_000));
}

/** `YYYY-MM-DD` in UTC. */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The end of a UTC calendar day as an instant, the stamp a daily value carries. */
export function endOfDayUtc(day: string): string {
  return `${day}T23:59:59.000Z`;
}
