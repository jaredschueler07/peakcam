// ─────────────────────────────────────────────────────────────
// SNOTEL station lookup.
//
// The catalogue stores a resort's station as an NRCS triplet
// ("415:CO:SNTL"); the station's name and elevation live only in
// lib/public-api/stations.json, a 72-row trim of data/snotel_stations.json
// (see the comment on that table in lib/public-api/serialize.ts). This module
// is the one place that joins the two, so the resort page sentence, the API
// serializer and the markdown alternate all name the same station. Pure, no
// database: callers pass the resort row in.
// ─────────────────────────────────────────────────────────────

import type { ResortWithData } from "./types";
import type { StationInfo } from "./quotable";
import stationIndex from "./public-api/stations.json";

export interface StationMeta {
  name: string;
  elevationFt: number | null;
}

/** Every triplet the catalogue references → its NRCS name and elevation. */
export const STATION_INDEX: Record<string, StationMeta> = stationIndex as Record<string, StationMeta>;

/** The metadata row for a triplet, or null when the table has no entry for it. */
export function stationMeta(
  tripletId: string | null | undefined,
  stations: Record<string, StationMeta> = STATION_INDEX,
): StationMeta | null {
  if (!tripletId) return null;
  const meta = stations[tripletId];
  return meta?.name ? { name: meta.name, elevationFt: meta.elevationFt ?? null } : null;
}

/**
 * The station a resort's readings come from, shaped for
 * `resortSentence(…, { station })`. Null for a resort without a triplet and
 * for a triplet the table does not know, so the sentence falls back to its
 * unnamed wording instead of printing a blank.
 */
export function stationFor(
  resort: Pick<ResortWithData, "snotel_station_id">,
  stations: Record<string, StationMeta> = STATION_INDEX,
): StationInfo | null {
  return stationMeta(resort.snotel_station_id, stations);
}
