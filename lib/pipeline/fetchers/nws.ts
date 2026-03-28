// ─────────────────────────────────────────────────────────────
// PeakCam — NWS Adapter
// Thin wrapper around existing lib/weather.ts, converting
// NWS forecast data into the pipeline's SourceReading format.
// ─────────────────────────────────────────────────────────────

import { SourceReading, emptyReading, ResortContext } from "../types";
import { getWeatherForecast } from "../../weather";

export async function fetchNws(
  resort: ResortContext,
): Promise<SourceReading | null> {
  try {
    const periods = await getWeatherForecast(resort.lat, resort.lng);
    if (!periods || periods.length === 0) return null;

    const today = periods[0];

    // Sum forecast snow over next 48h (up to 2 days)
    const forecastSnow48h = periods
      .slice(0, 2)
      .reduce((sum, p) => sum + (p.snowInches ?? 0), 0);

    // Max high temp in next 48h
    const forecastHigh48h = periods
      .slice(0, 2)
      .reduce((max, p) => Math.max(max, p.high ?? 0), -999);

    const reading = emptyReading(resort.id, "nws");
    reading.temp_high_f = today.high ?? null;
    reading.temp_low_f = today.low ?? null;
    reading.new_snow_24h_in = today.snowInches ?? null;
    reading.forecast_snow_48h_in = forecastSnow48h > 0 ? forecastSnow48h : null;
    reading.forecast_high_48h_f = forecastHigh48h > -999 ? forecastHigh48h : null;
    reading.source_confidence = 0.8;
    reading.raw_json = { periods } as Record<string, unknown>;

    return reading;
  } catch (err) {
    console.warn(`[PeakCam] NWS adapter failed for ${resort.slug}:`, err);
    return null;
  }
}
