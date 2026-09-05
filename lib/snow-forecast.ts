import type { HourlyWeather, SnowReport } from "./types";

const HOUR_MS = 60 * 60 * 1000;

/** Forecast evidence only; this never confirms snowfall in a webcam. */
export function hasCurrentSnowForecast(
  hourly: readonly Pick<HourlyWeather, "time" | "shortForecast" | "precipProbability">[] | null | undefined,
  nowMs = Date.now(),
): boolean {
  const current = hourly?.find((hour) => {
    const start = Date.parse(hour.time);
    return start <= nowMs && nowMs < start + HOUR_MS;
  });
  if (!current) return false;

  const text = current.shortForecast;
  // A possibility, blowing old snow, or freezing rain is not a snowfall signal.
  if (/\b(chance|possible|patchy|areas|blowing|drifting)\b/i.test(text)) return false;
  if (!/\b(snow|snowfall|flurries|flurry|blizzard)\b/i.test(text)) return false;
  return current.precipProbability == null || current.precipProbability >= 50;
}

/** The legacy DB flag is a forecast, and must not outlive its sampled hour. */
export function hasFreshSnowForecast(
  report: Pick<SnowReport, "snowing_now" | "updated_at"> | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!report?.snowing_now) return false;
  const updated = Date.parse(report.updated_at);
  const hourEnd = Math.floor(updated / HOUR_MS) * HOUR_MS + HOUR_MS;
  return updated <= nowMs && nowMs < hourEnd;
}
