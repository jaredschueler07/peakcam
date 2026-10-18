// ─────────────────────────────────────────────────────────────
// Public API — /api/v1/status, derived from the data itself.
//
// Pure: a function of the cached catalogue and its `now`. Two checks, each
// with a threshold the body states: snow-report freshness (the sync jobs
// write every 6 h, so a newest report older than 12 h means a job is down)
// and cam health (share of checked cams whose last probe passed). The HTTP
// status stays 200 when degraded so the body can be read; a 503 means the
// catalogue read itself failed.
// ─────────────────────────────────────────────────────────────

import type { PublicApiCatalog } from "./data";
import { PUBLIC_API_ATTRIBUTION } from "./headers";
import type { StatusPublic } from "./schema";
import { camLive, toIsoInstant } from "./serialize";

export const STATUS_REPORT_MAX_AGE_HOURS = 12;
export const STATUS_STALE_RESORT_HOURS = 24;
export const STATUS_CAM_LIVE_MIN_RATIO = 0.9;
/** CDN window for the status document. */
export const STATUS_CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=600";

export function buildStatus(catalog: PublicApiCatalog): StatusPublic {
  const now = catalog.now.getTime();
  const reports = catalog.resorts.map((r) => r.snow_report).filter((r): r is NonNullable<typeof r> => Boolean(r));
  let newestMs: number | null = null;
  let stale = 0;
  const bySource: Record<string, number> = {};
  for (const report of reports) {
    const ms = Date.parse(report.updated_at);
    if (!Number.isNaN(ms)) {
      if (newestMs === null || ms > newestMs) newestMs = ms;
      if (now - ms > STATUS_STALE_RESORT_HOURS * 3_600_000) stale++;
    }
    bySource[report.source] = (bySource[report.source] ?? 0) + 1;
  }
  const ageHours = newestMs === null ? null : Math.round(((now - newestMs) / 3_600_000) * 10) / 10;
  const reportsOk = reports.length > 0 && ageHours !== null && ageHours <= STATUS_REPORT_MAX_AGE_HOURS;

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

  const issues: string[] = [];
  if (!reportsOk) {
    issues.push(
      reports.length === 0
        ? "No resort has a snow report."
        : `The newest snow report is ${ageHours} h old; the sync jobs should write one at least every ${STATUS_REPORT_MAX_AGE_HOURS} h.`,
    );
  }
  if (!camsOk) issues.push(`Only ${Math.round((liveRatio ?? 0) * 100)} % of checked cams passed their last probe (threshold ${STATUS_CAM_LIVE_MIN_RATIO * 100} %).`);

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
    },
    thresholds: { reportMaxAgeHours: STATUS_REPORT_MAX_AGE_HOURS, camLiveMinRatio: STATUS_CAM_LIVE_MIN_RATIO },
    issues,
    attribution: PUBLIC_API_ATTRIBUTION,
  };
}
