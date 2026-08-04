// lib/feed-freshness.ts
//
// Pure dead-man's-switch logic for the snow feeds. Two production scripts —
// snotel-sync and model-sync — each write snow_reports on an independent 6h
// launchd schedule; neither is watched for silence. This just answers "is the
// newest row too old?" given a clock and a timestamp, so the /api/alerts/trigger
// cron can decide whether to page someone without any I/O of its own.

export const FRESHNESS_THRESHOLD_HOURS = 8;

export interface FreshnessResult {
  /** Hours since the newest snow_reports row, or null if the table is empty
   *  (or the timestamp couldn't be parsed) — treated as maximally stale. */
  ageHours: number | null;
  stale: boolean;
}

/**
 * @param nowMs Current time in epoch ms (inject for testability).
 * @param latestUpdatedAtIso The `updated_at` of the newest snow_reports row,
 *   or null when the table has no rows.
 */
export function checkFreshness(
  nowMs: number,
  latestUpdatedAtIso: string | null,
  thresholdHours: number = FRESHNESS_THRESHOLD_HOURS
): FreshnessResult {
  if (!latestUpdatedAtIso) {
    return { ageHours: null, stale: true };
  }

  const latestMs = new Date(latestUpdatedAtIso).getTime();
  if (Number.isNaN(latestMs)) {
    return { ageHours: null, stale: true };
  }

  const ageHours = (nowMs - latestMs) / (60 * 60 * 1000);
  return { ageHours, stale: ageHours > thresholdHours };
}
