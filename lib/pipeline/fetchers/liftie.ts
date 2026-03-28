// ─────────────────────────────────────────────────────────────
// PeakCam — Liftie Fetcher
// Pulls real-time lift status from liftie.info
// ─────────────────────────────────────────────────────────────

import { SourceReading, emptyReading, ResortContext } from "../types";

const USER_AGENT = "PeakCam/1.0 (contact@peakcam.io)";

interface LiftieResponse {
  id: string;
  name: string;
  lifts: {
    status: Record<string, string>;
    stats: {
      open: number;
      hold: number;
      scheduled: number;
      closed: number;
      percentage: {
        open: number;
        hold: number;
        scheduled: number;
        closed: number;
      };
    };
  };
}

export async function fetchLiftie(
  resort: ResortContext,
): Promise<SourceReading | null> {
  const slug = resort.metadata?.liftie_slug ?? resort.slug;

  try {
    const res = await fetch(`https://liftie.info/api/resort/${slug}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return null;

    const data: LiftieResponse = await res.json();
    const stats = data.lifts?.stats;
    if (!stats) return null;

    const totalLifts = stats.open + stats.hold + stats.scheduled + stats.closed;

    const reading = emptyReading(resort.id, "liftie");
    reading.lifts_open = stats.open;
    reading.lifts_total = totalLifts;
    reading.source_confidence = totalLifts > 0 ? 1.0 : 0.3;
    reading.raw_json = data as unknown as Record<string, unknown>;

    return reading;
  } catch (err) {
    console.warn(`[PeakCam] Liftie fetch failed for ${slug}:`, err);
    return null;
  }
}
