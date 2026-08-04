/** Standard 6°-wide UTM zones; the Norway/Svalbard exceptions do not apply to our resorts. */
export function utmZoneFor(lat: number, lon: number): { zone: number; north: boolean; epsg: number } {
  const zone = Math.floor((lon + 180) / 6) + 1;
  const north = lat >= 0;
  return { zone, north, epsg: (north ? 32600 : 32700) + zone };
}

const M_PER_DEG_LAT = 111132;
const mPerDegLon = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

/**
 * Worst-case ground error, in metres, from evaluating `mPerDegLon` once at the
 * box centre instead of per-row. Compares the east-west extent implied by the
 * centre constant against the true extent at the box's furthest edge latitude.
 */
export function metresPerSampleError(centreLat: number, halfSpanM: number): number {
  const edgeLat = centreLat + (centreLat >= 0 ? halfSpanM / M_PER_DEG_LAT : -halfSpanM / M_PER_DEG_LAT);
  const degAtCentre = halfSpanM / mPerDegLon(centreLat);
  return Math.abs(degAtCentre * mPerDegLon(edgeLat) - halfSpanM);
}
