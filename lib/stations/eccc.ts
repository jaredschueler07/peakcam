// ─────────────────────────────────────────────────────────────
// Station layer — Environment and Climate Change Canada hourly observations.
//
// Endpoint: the MSC GeoMet OGC API, collection `swob-realtime`
//   https://api.weather.gc.ca/collections/swob-realtime/items
//     ?bbox=w,s,e,n&limit=…&f=json&sortby=-date_tm-value&_is-minutely_obs-value=false
// One GeoJSON feature per station per report. Hourly reports carry the
// numbers as plain keys (`air_temp` °C, `avg_wnd_spd_10m_pst1hr` km/h,
// `avg_snw_dpth_pst5mts` cm, negative = sensor missing); the minutely rows
// carry flags only, hence the filter. Station identity is `msc_id-value`,
// the name `stn_nam-value`, elevation the third coordinate (m). NAV CANADA
// aviation reports (`data_pvdr-value`) come with an attribution note that
// must travel with the value; it is kept in the payload.
//
// Licence: Environment and Climate Change Canada Data Servers End-use
// Licence (https://eccc-msc.github.io/open-data/licence/readme_en/).
// Attribution: "Data Source: Environment and Climate Change Canada".
// ─────────────────────────────────────────────────────────────

import { celsiusToF, cmToInches, haversineKm, kmhToMph, metersToFeet, num, round1, type GeoPointLike, type StationObservation } from "./types";

export const ECCC_SWOB_URL = "https://api.weather.gc.ca/collections/swob-realtime/items";
export const ECCC_ATTRIBUTION = "Environment and Climate Change Canada";
export const ECCC_TERMS_URL = "https://eccc-msc.github.io/open-data/licence/readme_en/";
const DEFAULT_TIMEOUT_MS = 30_000;

interface SwobFeature {
  geometry?: { coordinates?: number[] } | null;
  properties?: Record<string, unknown>;
}

export interface SwobCollection {
  features?: SwobFeature[];
  numberMatched?: number;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * The newest hourly report per station in a collection → observations.
 * Depth sensors report -1 when unplugged; `num` keeps it, so negatives are
 * dropped here. Wind prefers the hourly mean over the 10-minute mean.
 */
export function parseSwobFeatures(json: SwobCollection): StationObservation[] {
  const byStation = new Map<string, StationObservation>();
  for (const f of json.features ?? []) {
    const p = f.properties ?? {};
    if (p["_is-minutely_obs-value"] === true) continue;
    const id = str(p["msc_id-value"]) ?? str(p["clim_id-value"]) ?? str(p["icao_stn_id-value"]);
    const at = str(p["date_tm-value"]);
    const coords = f.geometry?.coordinates;
    if (!id || !at || !coords || coords.length < 2) continue;
    const ms = Date.parse(at);
    if (Number.isNaN(ms)) continue;
    const observedAt = new Date(ms).toISOString();
    const prev = byStation.get(id);
    if (prev && prev.observedAt >= observedAt) continue;
    const elevM = coords.length > 2 ? num(coords[2]) : num(p["stn_elev"]);
    const tempC = num(p["air_temp"]) ?? num(p["avg_air_temp_pst1hr"]);
    const windKmh = num(p["avg_wnd_spd_10m_pst1hr"]) ?? num(p["avg_wnd_spd_10m_pst10mts"]) ?? num(p["avg_wnd_spd_10m_pst2mts"]);
    const depthCm = num(p["avg_snw_dpth_pst5mts"]) ?? num(p["snw_dpth"]);
    const provider = str(p["data_pvdr-value"]);
    const icao = str(p["icao_stn_id-value"]);
    byStation.set(id, {
      source: "eccc",
      sourceId: id,
      name: str(p["stn_nam-value"]) ?? id,
      lat: coords[1],
      lng: coords[0],
      elevationFt: elevM == null ? null : Math.round(metersToFeet(elevM)),
      kind: icao ? "metar" : "eccc",
      observedAt,
      snowDepthIn: depthCm != null && depthCm >= 0 ? round1(cmToInches(depthCm)) : null,
      sweIn: null,
      newSnowIn: null,
      tempF: tempC == null ? null : round1(celsiusToF(tempC)),
      windMph: windKmh == null ? null : round1(kmhToMph(windKmh)),
      payload: {
        date_tm: at,
        stn_nam: p["stn_nam-value"] ?? null,
        msc_id: p["msc_id-value"] ?? null,
        clim_id: p["clim_id-value"] ?? null,
        icao_stn_id: icao,
        data_pvdr: provider,
        data_attrib_not: p["data_attrib_not-value"] ?? null,
        air_temp: p["air_temp"] ?? null,
        avg_wnd_spd_10m_pst1hr: p["avg_wnd_spd_10m_pst1hr"] ?? null,
        max_wnd_spd_10m_pst1hr: p["max_wnd_spd_10m_pst1hr"] ?? null,
        avg_snw_dpth_pst5mts: p["avg_snw_dpth_pst5mts"] ?? null,
        pcpn_amt_pst1hr: p["pcpn_amt_pst1hr"] ?? null,
      },
    });
  }
  return [...byStation.values()];
}

/** A bbox string `w,s,e,n` of `radiusKm` around a point (good enough at 50° N for a 25 km search). */
export function bboxAround(point: GeoPointLike, radiusKm: number): string {
  const dLat = radiusKm / 111.32;
  const dLng = radiusKm / (111.32 * Math.cos((point.lat * Math.PI) / 180));
  return [point.lng - dLng, point.lat - dLat, point.lng + dLng, point.lat + dLat].map((v) => v.toFixed(4)).join(",");
}

export function swobItemsUrl(point: GeoPointLike, radiusKm: number, limit = 200): string {
  const params = new URLSearchParams({
    bbox: bboxAround(point, radiusKm),
    limit: String(limit),
    f: "json",
    sortby: "-date_tm-value",
    "_is-minutely_obs-value": "false",
  });
  return `${ECCC_SWOB_URL}?${params}`;
}

export interface EcccFetchOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  radiusKm?: number;
}

/** Hourly observations from every station within `radiusKm` (default 25) of a point, nearest first. */
export async function fetchEcccObservations(point: GeoPointLike, options: EcccFetchOptions = {}): Promise<Array<StationObservation & { distanceKm: number }>> {
  const f = options.fetchImpl ?? fetch;
  const radius = options.radiusKm ?? 25;
  const res = await f(swobItemsUrl(point, radius), { signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`ECCC GeoMet ${res.status}`);
  const json = (await res.json()) as SwobCollection;
  return parseSwobFeatures(json)
    .map((o) => ({ ...o, distanceKm: haversineKm(point, o) }))
    .filter((o) => o.distanceKm <= radius)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}
