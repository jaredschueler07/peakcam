// ─────────────────────────────────────────────────────────────
// PeakCam — SNOTEL Adapter
// Thin wrapper around existing lib/snotel.ts, converting
// SnotelSnapshot into the pipeline's SourceReading format.
// ─────────────────────────────────────────────────────────────

import { SourceReading, emptyReading, ResortContext } from "../types";
import { getSnotelSnapshot } from "../../snotel";

export async function fetchSnotel(
  resort: ResortContext,
): Promise<SourceReading | null> {
  if (!resort.snotel_station_id) return null;

  try {
    const snapshot = await getSnotelSnapshot(resort.snotel_station_id, resort.name);
    if (!snapshot || !snapshot.current) return null;

    const { current } = snapshot;

    const reading = emptyReading(resort.id, "snotel");
    reading.reading_date = current.date;
    reading.snow_depth_in = current.snowDepthIn;
    reading.swe_in = current.sweIn;
    reading.new_snow_24h_in = snapshot.newSnow24h;
    reading.new_snow_48h_in = snapshot.newSnow48h;
    reading.temp_f = current.tempF;
    reading.temp_high_f = current.tempMaxF;
    reading.temp_low_f = current.tempMinF;
    reading.source_confidence = 1.0;
    reading.raw_json = snapshot as unknown as Record<string, unknown>;

    return reading;
  } catch (err) {
    console.warn(`[PeakCam] SNOTEL adapter failed for ${resort.slug}:`, err);
    return null;
  }
}
