import proj4 from 'proj4';
import { utmZoneFor } from './utm';

/** Offline only. Use the DEM's UTM grid, never a degrees-to-metres approximation.
 * This transforms horizontal coordinates only; it does NOT convert vertical datums.
 */
export function localProjection(center: readonly [number, number], epsg = utmZoneFor(...center).epsg) {
  if (epsg !== utmZoneFor(...center).epsg) throw new Error('DEM CRS differs from configured resort UTM zone');
  const transform = proj4('EPSG:4326', `EPSG:${epsg}`);
  const origin = transform.forward([center[1], center[0]]);
  return {
    epsg,
    origin,
    forward(lat: number, lon: number): [number, number] {
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('Invalid geographic coordinate');
      const p = transform.forward([lon, lat]);
      return [p[0] - origin[0], p[1] - origin[1]];
    },
    inverse(x: number, y: number): [number, number] {
      const p = transform.inverse([x + origin[0], y + origin[1]]);
      return [p[1], p[0]];
    },
  };
}
