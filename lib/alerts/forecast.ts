import type { WeatherPeriod } from "../types";

/** Earliest future storm meeting the threshold over at most three days.
 * Open-Meteo periods start with today; leadDays is the storm's first snowy day.
 */
export function findForecastAlert(
  periods: WeatherPeriod[],
  thresholdInches: number,
): { snowInches: number; leadDays: number; forecastDays: number; stormStartDate: string | null } | null {
  if (!Number.isFinite(thresholdInches) || thresholdInches <= 0) return null;
  const snow = periods.slice(0, 7).map(p =>
    Number.isFinite(p.snowInches) ? Math.max(0, p.snowInches) : 0);
  for (let start = 1; start < snow.length; start++) {
    if (snow[start] === 0) continue;
    const total = snow.slice(start, start + 3).reduce((sum, n) => sum + n, 0);
    if (total >= thresholdInches) {
      return {
        snowInches: Math.round(total * 10) / 10,
        leadDays: start,
        forecastDays: Math.min(3, snow.length - start),
        stormStartDate: periods[start]?.date ?? null,
      };
    }
  }
  return null;
}
