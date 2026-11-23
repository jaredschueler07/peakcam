// ─────────────────────────────────────────────────────────────
// Public API — /api/v1/status, derived from the data itself.
//
// Pure: a function of the cached catalogue and its `now`. Checks with
// thresholds the body states: snow-report freshness overall and per sync
// source (`snotel`, `open_meteo`, so a dead sync job is not masked by another
// healthy source), cam health (share of checked cams whose last probe passed),
// cam-still archive freshness (captures run every 15 min, so > 2 h means the
// job is down), plus station/score freshness when those indices are loaded.
// The HTTP status stays 200 when degraded so the body can be read; a 503 means
// the catalogue read itself failed.
// ─────────────────────────────────────────────────────────────

import type { PublicApiCatalog } from "./data";
import { PUBLIC_API_ATTRIBUTION } from "./headers";
import type { StatusPublic } from "./schema";
import { camLive, toIsoInstant } from "./serialize";

export const STATUS_REPORT_MAX_AGE_HOURS = 12;
export const STATUS_STALE_RESORT_HOURS = 24;
export const STATUS_CAM_LIVE_MIN_RATIO = 0.9;
export const STATUS_STILL_MAX_AGE_HOURS = 2;
export const STATUS_STATION_MAX_AGE_HOURS = 24;
export const STATUS_SCORE_MAX_AGE_DAYS = 2;
/** Active sync sources whose per-source freshness determines snowReports status. */
export const STATUS_FRESHNESS_SOURCES = ["snotel", "open_meteo"] as const;
/** CDN window for the status document. */
export const STATUS_CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=600";

export function buildStatus(catalog: PublicApiCatalog): StatusPublic {
  const now = catalog.now.getTime();
  const reports = catalog.resorts.map((r) => r.snow_report).filter((r): r is NonNullable<typeof r> => Boolean(r));
  let newestMs: number | null = null;
  let stale = 0;
  const bySource: Record<string, number> = {};
  const bySourceNewestMs: Record<string, number> = {};
  for (const report of reports) {
    const ms = Date.parse(report.updated_at);
    if (!Number.isNaN(ms)) {
      if (newestMs === null || ms > newestMs) newestMs = ms;
      if (now - ms > STATUS_STALE_RESORT_HOURS * 3_600_000) stale++;
      const prev = bySourceNewestMs[report.source];
      if (prev === undefined || ms > prev) bySourceNewestMs[report.source] = ms;
    }
    bySource[report.source] = (bySource[report.source] ?? 0) + 1;
  }
  const ageHours = newestMs === null ? null : Math.round(((now - newestMs) / 3_600_000) * 10) / 10;
  const bySourceNewestAt: Record<string, string> = {};
  const bySourceAgeHours: Record<string, number> = {};
  const staleSources: Array<{ source: string; ageHours: number }> = [];
  for (const src of STATUS_FRESHNESS_SOURCES) {
    const srcMs = bySourceNewestMs[src];
    if (srcMs === undefined) continue;
    bySourceNewestAt[src] = new Date(srcMs).toISOString();
    const srcAge = Math.round(((now - srcMs) / 3_600_000) * 10) / 10;
    bySourceAgeHours[src] = srcAge;
    if (srcAge > STATUS_REPORT_MAX_AGE_HOURS) staleSources.push({ source: src, ageHours: srcAge });
  }
  const overallReportsOk = reports.length > 0 && ageHours !== null && ageHours <= STATUS_REPORT_MAX_AGE_HOURS;
  const reportsOk = overallReportsOk && staleSources.length === 0;

  const cams = catalog.resorts.flatMap((r) => r.cams);
  let live = 0;
  let down = 0;
  let unchecked = 0;
  let newestCheck: number | null = null;
  for (const cam of cams) {
    const state = camLive(cam);
    if (state === true) live++;
    else if (state === false) down++;
    else unchecked++;
    const ms = cam.last_checked_at ? Date.parse(cam.last_checked_at) : NaN;
    if (!Number.isNaN(ms) && (newestCheck === null || ms > newestCheck)) newestCheck = ms;
  }
  const checked = live + down;
  const liveRatio = checked ? Math.round((live / checked) * 1000) / 1000 : null;
  const camsOk = liveRatio === null ? cams.length === 0 : liveRatio >= STATUS_CAM_LIVE_MIN_RATIO;

  const stillMs = catalog.newestCamStillAt ? Date.parse(catalog.newestCamStillAt) : NaN;
  const newestCapturedAt = Number.isNaN(stillMs) ? null : new Date(stillMs).toISOString();
  const stillAgeHours = newestCapturedAt === null ? null : Math.round(((now - stillMs) / 3_600_000) * 10) / 10;
  const stillsOk = stillAgeHours !== null && stillAgeHours <= STATUS_STILL_MAX_AGE_HOURS;

  const issues: string[] = [];
  if (!overallReportsOk) {
    issues.push(
      reports.length === 0
        ? "No resort has a snow report."
        : `The newest snow report is ${ageHours} h old; the sync jobs should write one at least every ${STATUS_REPORT_MAX_AGE_HOURS} h.`,
    );
  } else if (staleSources.length > 0) {
    for (const { source, ageHours: srcAge } of staleSources) {
      issues.push(
        `The newest ${source} snow report is ${srcAge} h old; the sync jobs should write one at least every ${STATUS_REPORT_MAX_AGE_HOURS} h.`,
      );
    }
  }
  if (!camsOk) issues.push(`Only ${Math.round((liveRatio ?? 0) * 100)} % of checked cams passed their last probe (threshold ${STATUS_CAM_LIVE_MIN_RATIO * 100} %).`);
  if (!stillsOk) {
    issues.push(
      stillAgeHours === null
        ? "No cam still has been captured."
        : `The newest cam still is ${stillAgeHours} h old; the capture job writes every 15 min.`,
    );
  }

  let stationsCheck: StatusPublic["checks"]["stations"];
  if (catalog.stations != null) {
    const entries = Object.values(catalog.stations).filter((list) => list.length > 0);
    if (entries.length > 0) {
      let stationMs: number | null = null;
      for (const list of entries) {
        for (const row of list) {
          const obsMs = row.latest?.observed_at ? Date.parse(row.latest.observed_at) : NaN;
          if (!Number.isNaN(obsMs) && (stationMs === null || obsMs > stationMs)) stationMs = obsMs;
        }
      }
      const stationAgeHours = stationMs === null ? null : Math.round(((now - stationMs) / 3_600_000) * 10) / 10;
      const stationsOk = stationAgeHours !== null && stationAgeHours <= STATUS_STATION_MAX_AGE_HOURS;
      stationsCheck = {
        status: stationsOk ? "ok" : "degraded",
        resorts: entries.length,
        newestObservedAt: stationMs === null ? null : new Date(stationMs).toISOString(),
        ageHours: stationAgeHours,
      };
      if (!stationsOk) {
        issues.push(
          stationAgeHours === null
            ? "No station observation timestamp is available."
            : `The newest station observation is ${stationAgeHours} h old (threshold ${STATUS_STATION_MAX_AGE_HOURS} h).`,
        );
      }
    }
  }

  let scoresCheck: StatusPublic["checks"]["scores"];
  if (catalog.scores != null) {
    const scoreRows = Object.values(catalog.scores);
    let newestScoreDate: string | null = null;
    for (const row of scoreRows) {
      if (row.date && (!newestScoreDate || row.date > newestScoreDate)) newestScoreDate = row.date;
    }
    const todayUtc = new Date(now).toISOString().slice(0, 10);
    const todayMs = Date.parse(`${todayUtc}T00:00:00Z`);
    const scoreMs = newestScoreDate ? Date.parse(`${newestScoreDate}T00:00:00Z`) : NaN;
    const ageDays = Number.isNaN(scoreMs) ? null : Math.max(0, Math.round((todayMs - scoreMs) / 86_400_000));
    const scoresOk = ageDays !== null && ageDays <= STATUS_SCORE_MAX_AGE_DAYS;
    scoresCheck = {
      status: scoresOk ? "ok" : "degraded",
      resorts: scoreRows.length,
      newestScoreDate,
      ageDays,
    };
    if (!scoresOk) {
      issues.push(
        ageDays === null
          ? "No Snow Score row has been computed yet."
          : `The newest Snow Score is ${ageDays} d old (threshold ${STATUS_SCORE_MAX_AGE_DAYS} d).`,
      );
    }
  }

  return {
    status: issues.length ? "degraded" : "ok",
    generatedAt: catalog.now.toISOString(),
    checks: {
      snowReports: {
        status: reportsOk ? "ok" : "degraded",
        resorts: catalog.resorts.length,
        reporting: reports.length,
        newestReportAt: newestMs === null ? null : new Date(newestMs).toISOString(),
        ageHours,
        staleResorts: stale,
        bySource,
        ...(Object.keys(bySourceNewestAt).length ? { bySourceNewestAt, bySourceAgeHours } : {}),
      },
      cams: {
        status: camsOk ? "ok" : "degraded",
        total: cams.length,
        live,
        down,
        unchecked,
        liveRatio,
        newestCheckAt: newestCheck === null ? null : toIsoInstant(new Date(newestCheck).toISOString()),
      },
      camStills: {
        status: stillsOk ? "ok" : "degraded",
        newestCapturedAt,
        ageHours: stillAgeHours,
      },
      ...(stationsCheck ? { stations: stationsCheck } : {}),
      ...(scoresCheck ? { scores: scoresCheck } : {}),
    },
    thresholds: {
      reportMaxAgeHours: STATUS_REPORT_MAX_AGE_HOURS,
      camLiveMinRatio: STATUS_CAM_LIVE_MIN_RATIO,
      stillMaxAgeHours: STATUS_STILL_MAX_AGE_HOURS,
    },
    issues,
    attribution: PUBLIC_API_ATTRIBUTION,
  };
}
