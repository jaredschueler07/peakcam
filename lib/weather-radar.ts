// ─────────────────────────────────────────────────────────────
// PeakCam — Weather Radar (RainViewer API)
// Free precipitation radar tile URLs. No API key required.
// ─────────────────────────────────────────────────────────────

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
    { next: { revalidate: 300 } }
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
