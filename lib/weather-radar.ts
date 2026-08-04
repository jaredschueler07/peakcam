// ─────────────────────────────────────────────────────────────
// PeakCam — Weather overlays
// Radar: RainViewer (free, no key). Covers NA + Argentina (14
//   SINARAME radars) — but NOT Chile (no Chilean network exists
//   in any radar aggregator).
// Satellite: NASA GIBS GOES-East ABI GeoColor (free, no key,
//   CORS *). Full-disk Americas incl. the whole Andes — the
//   storm-watching answer where radar doesn't exist. 10-min
//   cadence; the literal "default" time segment resolves server-
//   side to the newest frame (verified ~5–25 min latency), so no
//   timestamp bookkeeping is needed.
// ─────────────────────────────────────────────────────────────

/**
 * GOES-East GeoColor XYZ template for a MapLibre raster source. GIBS's REST
 * layout is {z}/{row}/{col}, i.e. {z}/{y}/{x} — MapLibre substitutes the
 * placeholders by name, order doesn't matter. Tiles outside the GOES-East
 * disk (far Pacific/Asia) 404 and simply don't render.
 */
export const SATELLITE_TILE_URL =
  "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-East_ABI_GeoColor/default/default/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png";

/** The layer's TileMatrixSet tops out at level 7 — MapLibre overzooms past it. */
export const SATELLITE_MAX_ZOOM = 7;

export const SATELLITE_ATTRIBUTION =
  'Satellite: <a href="https://earthdata.nasa.gov/gibs">NASA EOSDIS GIBS</a>';

// Both call sites (app/page.tsx, app/map/page.tsx) already treat a rejected
// fetch as "no radar this cycle" via `.catch(() => [])`, but that only
// covers errors — a hung RainViewer connection would otherwise stall the
// `Promise.all` render for as long as the connection stays open. This bounds
// it to 5s so a stuck radar call can't hang the page.
const RADAR_TIMEOUT_MS = 5_000;

export interface RadarFrame {
  time: number;
  tileUrl: string;
  /** True for forecast (nowcast) frames; false for observed past frames. */
  nowcast: boolean;
}

interface RainViewerResponse {
  version: string;
  generated: number;
  host: string;
  radar: {
    past: { time: number; path: string }[];
    nowcast: { time: number; path: string }[];
  };
}

/**
 * Fetches radar frames from RainViewer for the animated radar loop.
 * Returns the last 6 past frames plus up to 3 nowcast frames, oldest first.
 * (Capped so the map mounts a bounded number of preloading raster layers.)
 * Tile URLs follow the pattern: `{host}{path}/256/{z}/{x}/{y}/2/1_1.png`
 *
 * Cached for 5 minutes via Next.js ISR.
 */
export async function getRadarFrames(): Promise<RadarFrame[]> {
  const res = await fetch(
    "https://api.rainviewer.com/public/weather-maps.json",
    { next: { revalidate: 300 }, signal: AbortSignal.timeout(RADAR_TIMEOUT_MS) }
  );

  if (!res.ok) {
    return [];
  }

  const data: RainViewerResponse = await res.json();
  const { host, radar } = data;

  const pastFrames = radar.past.slice(-6);
  const nowcastFrames = (radar.nowcast ?? []).slice(0, 3);

  const toFrame = (nowcast: boolean) =>
    (entry: { time: number; path: string }): RadarFrame => ({
      time: entry.time,
      tileUrl: `${host}${entry.path}/256/{z}/{x}/{y}/2/1_1.png`,
      nowcast,
    });

  return [...pastFrames.map(toFrame(false)), ...nowcastFrames.map(toFrame(true))];
}
