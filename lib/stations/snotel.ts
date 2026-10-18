// ─────────────────────────────────────────────────────────────
// Station layer — NRCS SNOTEL / SCAN via the AWDB REST API.
//
// Same endpoints and parsing as scripts/snotel-sync.ts (the production
// feed): `/stations` for metadata, `/data` with DAILY duration for the
// latest values. QC is lib/snow-quality.ts's validateReading — imported,
// not re-implemented — so the station layer and the snow report can never
// disagree about whether a reading is suspect.
//
// Source: USDA NRCS Air and Water Database (AWDB) REST API,
// https://wcc.sc.egov.usda.gov/awdbRestApi/ — US government work, public
// domain, no key. Attribution: "USDA NRCS SNOTEL".
// ─────────────────────────────────────────────────────────────

import { validateReading, type PreviousDay, type RawSnotelReading } from "../snow-quality";
import { endOfDayUtc, isoDay, num, round1, type StationMeta, type StationObservation } from "./types";

export const AWDB_BASE = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1";
export const SNOTEL_ATTRIBUTION = "USDA NRCS SNOTEL";
export const SNOTEL_TERMS_URL = "https://www.nrcs.usda.gov/wps/portal/wcc/home/dataAccessHelp/webService/";
export const SNOTEL_ELEMENTS = "SNWD,WTEQ,PREC,TOBS,TMAX,TMIN";
const DEFAULT_TIMEOUT_MS = 15_000;

/** One row of AWDB `/stations`. */
export interface AwdbStation {
  stationTriplet: string;
  stationId?: string;
  stateCode?: string;
  networkCode?: string;
  name: string;
  elevation?: number | null;
  latitude: number;
  longitude: number;
  beginDate?: string;
  endDate?: string;
}

interface AwdbValue {
  date: string;
  value: number | null;
}

interface AwdbElement {
  stationElement: { elementCode: string };
  values?: AwdbValue[];
}

interface AwdbDataRow {
  stationTriplet: string;
  data?: AwdbElement[];
}

/** One day of raw AWDB values, before QC. */
export interface SnotelDay {
  date: string;
  snowDepthIn: number | null;
  sweIn: number | null;
  precipAccumIn: number | null;
  tempObsF: number | null;
  tempMaxF: number | null;
  tempMinF: number | null;
}

/** `"842:CO:SNTL"` stays; a bare `"842"` becomes `"842:CO:SNTL"` (the importer stored both forms). */
export function normalizeTriplet(stationId: string, stateCode: string): string {
  return stationId.includes(":") ? stationId : `${stationId}:${stateCode}:SNTL`;
}

export function stationMetaFromAwdb(row: AwdbStation): StationMeta {
  const network = (row.networkCode ?? row.stationTriplet.split(":")[2] ?? "SNTL").toUpperCase();
  return {
    source: "snotel",
    sourceId: row.stationTriplet,
    name: row.name,
    lat: row.latitude,
    lng: row.longitude,
    elevationFt: num(row.elevation),
    kind: network === "SCAN" ? "scan" : "snotel",
  };
}

/** AWDB `/data` → day rows, oldest first. Null when the station reported nothing in the window. */
export function parseAwdbDaily(json: unknown): SnotelDay[] | null {
  const rows = Array.isArray(json) ? (json as AwdbDataRow[]) : [];
  const elements = rows[0]?.data;
  if (!elements?.length) return null;

  const byCode: Record<string, AwdbValue[]> = {};
  for (const el of elements) {
    byCode[el.stationElement.elementCode] = (el.values ?? []).filter((v) => num(v.value) != null);
  }
  const dates = new Set<string>();
  for (const vals of Object.values(byCode)) for (const v of vals) dates.add(v.date.slice(0, 10));
  const lookup = (code: string, date: string): number | null => {
    const hit = (byCode[code] ?? []).find((v) => v.date.slice(0, 10) === date);
    return hit ? num(hit.value) : null;
  };
  const days = [...dates].sort().map((date) => ({
    date,
    snowDepthIn: lookup("SNWD", date),
    sweIn: lookup("WTEQ", date),
    precipAccumIn: lookup("PREC", date),
    tempObsF: lookup("TOBS", date),
    tempMaxF: lookup("TMAX", date),
    tempMinF: lookup("TMIN", date),
  }));
  return days.length ? days : null;
}

/**
 * The latest QC'd day as a StationObservation. New snow is the positive
 * depth change from the previous day, the same rule as snotel-sync's
 * computeDeltas, so the two feeds print the same "24 h" number.
 */
export function snotelObservation(meta: StationMeta, days: SnotelDay[]): StationObservation | null {
  if (!days.length) return null;
  const latest = days[days.length - 1];
  const prev = days.length >= 2 ? days[days.length - 2] : null;
  const previous: PreviousDay | null = prev
    ? { snowDepthIn: prev.snowDepthIn, sweIn: prev.sweIn, precipAccumIn: prev.precipAccumIn }
    : null;
  const raw: RawSnotelReading = {
    snowDepthIn: latest.snowDepthIn,
    sweIn: latest.sweIn,
    precipAccumIn: latest.precipAccumIn,
    tempObsF: latest.tempObsF,
    tempMaxF: latest.tempMaxF,
    tempMinF: latest.tempMinF,
  };
  const qc = validateReading(raw, previous);
  const newSnow =
    qc.snowDepthIn != null && prev?.snowDepthIn != null ? Math.max(0, Math.round(qc.snowDepthIn - prev.snowDepthIn)) : null;
  return {
    ...meta,
    observedAt: endOfDayUtc(latest.date),
    snowDepthIn: round1(qc.snowDepthIn),
    sweIn: round1(qc.sweIn),
    newSnowIn: newSnow,
    tempF: round1(qc.tempObsF),
    windMph: null,
    payload: { ...latest, qcFlag: qc.qcFlag, qcNotes: qc.notes, previousDay: prev },
  };
}

// ── Network ──────────────────────────────────────────────────

export interface SnotelFetchOptions {
  fetchImpl?: typeof fetch;
  now?: Date;
  /** Days of history to request (the previous day is needed for new snow). */
  days?: number;
  timeoutMs?: number;
}

export async function fetchSnotelStation(triplet: string, options: SnotelFetchOptions = {}): Promise<StationMeta | null> {
  const f = options.fetchImpl ?? fetch;
  const res = await f(`${AWDB_BASE}/stations?${new URLSearchParams({ stationTriplets: triplet })}`, {
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`AWDB stations ${res.status} for ${triplet}`);
  const rows = (await res.json()) as AwdbStation[];
  return rows[0] ? stationMetaFromAwdb(rows[0]) : null;
}

/** Metadata plus the latest QC'd daily reading; null when the station has no data in the window. */
export async function fetchSnotelObservation(triplet: string, options: SnotelFetchOptions = {}): Promise<StationObservation | null> {
  const f = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const begin = new Date(now);
  begin.setUTCDate(begin.getUTCDate() - (options.days ?? 8));
  const meta = await fetchSnotelStation(triplet, options);
  if (!meta) return null;
  const params = new URLSearchParams({
    stationTriplets: triplet,
    elements: SNOTEL_ELEMENTS,
    duration: "DAILY",
    getFlags: "false",
    beginDate: isoDay(begin),
    endDate: isoDay(now),
  });
  const res = await f(`${AWDB_BASE}/data?${params}`, { signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`AWDB data ${res.status} for ${triplet}`);
  const days = parseAwdbDaily(await res.json());
  return days ? snotelObservation(meta, days) : null;
}
