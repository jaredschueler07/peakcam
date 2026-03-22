// ─────────────────────────────────────────────────────────────
// PeakCam — Weather Radar (RainViewer API)
// Free precipitation radar tile URLs. No API key required.
// ─────────────────────────────────────────────────────────────

export interface RadarFrame {
  time: number;
  tileUrl: string;
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
 * Fetches radar frames from RainViewer.
 * Returns the last 6 past frames plus all available nowcast frames.
 * Tile URLs follow the pattern: `{host}{path}/256/{z}/{x}/{y}/2/1_1.png`
 *
 * Cached for 5 minutes via Next.js ISR.
 */
export async function getRadarFrames(): Promise<RadarFrame[]> {
  const res = await fetch(
    "https://api.rainviewer.com/public/weather-maps.json",
    { next: { revalidate: 300 } }
  );

  if (!res.ok) {
    return [];
  }

  const data: RainViewerResponse = await res.json();
  const { host, radar } = data;

  const pastFrames = radar.past.slice(-6);
  const nowcastFrames = radar.nowcast ?? [];

  const toFrame = (entry: { time: number; path: string }): RadarFrame => ({
    time: entry.time,
    tileUrl: `${host}${entry.path}/256/{z}/{x}/{y}/2/1_1.png`,
  });

  return [...pastFrames.map(toFrame), ...nowcastFrames.map(toFrame)];
}

/**
 * Returns the tile URL for the most recent past radar frame, or null
 * if the API is unavailable.
 */
export async function getLatestRadarTileUrl(): Promise<string | null> {
  const frames = await getRadarFrames();
  if (frames.length === 0) return null;

  // Find the last past frame (before any nowcast frames)
  // Past frames come first in the array from getRadarFrames
  const now = Math.floor(Date.now() / 1000);
  const pastFrames = frames.filter((f) => f.time <= now);

  if (pastFrames.length === 0) return null;
  return pastFrames[pastFrames.length - 1].tileUrl;
}
