// ─────────────────────────────────────────────────────────────
// PeakCam — Weather Unlocked Fetcher
// Pulls elevation-specific ski resort forecasts from the
// Weather Unlocked Ski Resort API.
// ─────────────────────────────────────────────────────────────

import { SourceReading, emptyReading, ResortContext } from "../types";

// Elevation-level weather data (base, mid, upper)
interface ElevationData {
  temp_c: number | null;
  temp_f: number | null;
  feelslike_c: number | null;
  feelslike_f: number | null;
  freshsnow_cm: number | null;
  freshsnow_in: number | null;
  windspd_mph: number | null;
  windgst_mph: number | null;
  wx_desc: string | null;
}

interface ForecastTimeframe {
  date: string;
  time: string;
  base: ElevationData;
  mid: ElevationData;
  upper: ElevationData;
  frzglvl_ft: number | null;
  snow_in: number | null;
  totalcloud_pct: number | null;
  vis_mi: number | null;
}

interface WeatherUnlockedResponse {
  id: number;
  name: string;
  country: string;
  forecast: ForecastTimeframe[];
}

export async function fetchWeatherUnlocked(
  resort: ResortContext,
): Promise<SourceReading | null> {
  const resortId = resort.metadata?.weather_unlocked_id;
  if (!resortId) return null;

  const appId = process.env.WEATHER_UNLOCKED_APP_ID;
  const apiKey = process.env.WEATHER_UNLOCKED_API_KEY;
  if (!appId || !apiKey) {
    console.warn("[PeakCam] Weather Unlocked credentials not configured");
    return null;
  }

  try {
    const url = `https://api.weatherunlocked.com/api/resortforecast/${resortId}?app_id=${appId}&app_key=${apiKey}&num_of_days=3&hourly_interval=6`;

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return null;

    const data: WeatherUnlockedResponse = await res.json();
    if (!data.forecast || data.forecast.length === 0) return null;

    const reading = emptyReading(resort.id, "weather_unlocked");

    // Use the first timeframe for current conditions
    const current = data.forecast[0];

    // Prefer mid-mountain temps (most representative for skiing)
    const elev = current.mid ?? current.base ?? current.upper;
    if (elev) {
      reading.temp_f = elev.temp_f;
    }

    // Base temp for low, summit for high
    if (current.base?.temp_f != null) {
      reading.temp_low_f = current.base.temp_f;
    }
    if (current.upper?.temp_f != null) {
      reading.temp_high_f = current.upper.temp_f;
    }

    // Fresh snow at base (most conservative/reliable)
    if (current.base?.freshsnow_in != null) {
      reading.new_snow_24h_in = current.base.freshsnow_in;
    }

    // Sky cover and visibility
    if (current.totalcloud_pct != null) {
      reading.sky_cover_pct = current.totalcloud_pct;
    }

    // Wind from summit (worst-case for operations)
    if (current.upper?.windgst_mph != null) {
      reading.wind_gust_mph = current.upper.windgst_mph;
    }

    // Freezing level as snow level approximation
    if (current.frzglvl_ft != null) {
      reading.snow_level_ft = current.frzglvl_ft;
    }

    // Sum snow forecast over 48h (all timeframes in first 2 days)
    const now = new Date();
    const in48h = new Date(now.getTime() + 48 * 3600_000);
    let snowSum = 0;
    let maxHigh = -999;

    for (const tf of data.forecast) {
      const tfDate = new Date(`${tf.date}T${tf.time || "00:00"}`);
      if (tfDate > in48h) break;

      if (tf.snow_in != null) snowSum += tf.snow_in;
      if (tf.upper?.temp_f != null && tf.upper.temp_f > maxHigh) {
        maxHigh = tf.upper.temp_f;
      }
    }

    if (snowSum > 0) reading.forecast_snow_48h_in = snowSum;
    if (maxHigh > -999) reading.forecast_high_48h_f = maxHigh;

    reading.source_confidence = 0.6;
    reading.raw_json = data as unknown as Record<string, unknown>;

    return reading;
  } catch (err) {
    console.warn(`[PeakCam] Weather Unlocked fetch failed for ${resort.slug}:`, err);
    return null;
  }
}
