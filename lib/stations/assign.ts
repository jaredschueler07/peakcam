// ─────────────────────────────────────────────────────────────
// Station layer — picking a resort's stations by role.
//
// Up to three stations per resort, one per elevation band when the
// candidates allow it. The band comes from the station's elevation against
// the resort's base and summit: the top third of the vertical is `summit`,
// the bottom third `base`, between them `mid`. Without resort elevations the
// highest candidate is the summit and the lowest the base. Within a band the
// provider order wins — SNOTEL (measured depth and SWE) first, then GHCN
// daily (depth and new snow), then NWS or ECCC hourly (temperature and
// wind) — then distance. SNOTEL stays the base-depth truth: a SNOTEL
// candidate is never displaced from its band by a later source.
// ─────────────────────────────────────────────────────────────

import type { StationObservation, StationRole, StationSource } from "./types";

export const SOURCE_PRIORITY: Record<StationSource, number> = { snotel: 0, bc_asws: 1, ghcn: 2, eccc: 3, nws: 4 };
export const MAX_STATIONS_PER_RESORT = 3;
export const MAX_STATION_DISTANCE_KM = 25;

export interface Candidate {
  observation: StationObservation;
  distanceKm: number;
}

export interface ResortElevations {
  baseFt: number | null;
  summitFt: number | null;
}

export interface AssignedStation extends Candidate {
  role: StationRole;
  rank: number;
}

/** The band a station elevation falls in, or null when the resort has no usable elevations. */
export function roleForElevation(elevationFt: number | null, resort: ResortElevations): StationRole | null {
  const { baseFt, summitFt } = resort;
  if (elevationFt == null || baseFt == null || summitFt == null || summitFt <= baseFt) return null;
  const frac = (elevationFt - baseFt) / (summitFt - baseFt);
  if (frac >= 2 / 3) return "summit";
  if (frac <= 1 / 3) return "base";
  return "mid";
}

function priority(c: Candidate): number {
  return SOURCE_PRIORITY[c.observation.source];
}

/**
 * Up to `max` stations for one resort. Candidates beyond `maxKm` are dropped
 * first. Each band is filled with its best candidate (provider, then
 * distance); leftover slots go to the best remaining candidates, whose role is
 * their band or, lacking elevations, inferred from the ordering (highest left
 * = summit, lowest = base, else mid).
 */
export function assignStations(candidates: readonly Candidate[], resort: ResortElevations, { max = MAX_STATIONS_PER_RESORT, maxKm = MAX_STATION_DISTANCE_KM } = {}): AssignedStation[] {
  const pool = candidates
    .filter((c) => c.distanceKm <= maxKm)
    .filter((c, i, all) => all.findIndex((o) => o.observation.source === c.observation.source && o.observation.sourceId === c.observation.sourceId) === i)
    .sort((a, b) => priority(a) - priority(b) || a.distanceKm - b.distanceKm);
  const chosen: AssignedStation[] = [];
  const taken = new Set<Candidate>();
  const bands: StationRole[] = ["base", "summit", "mid"];

  for (const band of bands) {
    if (chosen.length >= max) break;
    const hit = pool.find((c) => !taken.has(c) && roleForElevation(c.observation.elevationFt, resort) === band);
    if (hit) {
      taken.add(hit);
      chosen.push({ ...hit, role: band, rank: 0 });
    }
  }
  for (const c of pool) {
    if (chosen.length >= max) break;
    if (taken.has(c)) continue;
    taken.add(c);
    chosen.push({ ...c, role: roleForElevation(c.observation.elevationFt, resort) ?? "mid", rank: 0 });
  }

  // No elevations on file: name the extremes by what we do know.
  if (chosen.length > 1 && chosen.every((c) => roleForElevation(c.observation.elevationFt, resort) == null)) {
    const withElev = chosen.filter((c) => c.observation.elevationFt != null);
    if (withElev.length >= 2) {
      const sorted = [...withElev].sort((a, b) => (b.observation.elevationFt ?? 0) - (a.observation.elevationFt ?? 0));
      for (const c of chosen) c.role = "mid";
      sorted[0].role = "summit";
      sorted[sorted.length - 1].role = "base";
    }
  }

  const order: Record<StationRole, number> = { summit: 0, mid: 1, base: 2, approach: 3 };
  chosen.sort((a, b) => order[a.role] - order[b.role] || priority(a) - priority(b) || a.distanceKm - b.distanceKm);
  return chosen.map((c, i) => ({ ...c, rank: i + 1 }));
}
