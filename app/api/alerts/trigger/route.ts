import { NextRequest, NextResponse } from "next/server";
import { EmailSendError, sendPowderAlertEmail } from "@/lib/email";
import { checkFreshness } from "@/lib/feed-freshness";
import { sendFeedFreshnessAlertEmail } from "@/lib/alerts/freshness-email";
import { getOpenMeteoForecast } from "@/lib/open-meteo";
import { findForecastAlert } from "@/lib/alerts/forecast";
import type { WeatherPeriod } from "@/lib/types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CRON_SECRET = process.env.CRON_SECRET;

function sbFetch(path: string, init?: RequestInit) {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    // Without this, a hung DB hangs every one of this route's five
    // sequential queries (and the cron run with it) — the anon-client
    // timeout wrapper doesn't cover this raw service-role fetch.
    signal: AbortSignal.timeout(8_000),
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

interface Subscriber {
  id: string;
  email: string;
  manage_token: string;
}

interface AlertPreference {
  subscriber_id: string;
  resort_id: string;
  threshold_inches: number;
  alert_subscribers: Subscriber;
  resorts: { name: string; slug: string };
}

interface SnowReport {
  resort_id: string;
  new_snow_24h: number | null;
  updated_at: string | null;
}

interface ResortLocation {
  id: string;
  lat: number;
  lng: number;
}

interface FreshnessSummary {
  ageHours: number | null;
  stale: boolean;
  alerted: boolean;
}

interface AlertLog {
  subscriber_id: string;
  resort_id: string;
  new_snow_inches: number;
  alert_date: string;
  kind?: "live" | "forecast";
  storm_start_date?: string | null;
}

const FORECAST_LOOKBACK_DAYS = 14;
const FORECAST_COOLDOWN_DAYS = 3;
const FORECAST_GROWTH_INCHES = 1;
// Live alerts share the forecast cooldown window but need a bigger jump to
// re-fire: new_snow_24h is a rolling total that stays above a 6" threshold on
// every day of a multi-day storm, and each of those days used to mail again.
const LIVE_COOLDOWN_DAYS = FORECAST_COOLDOWN_DAYS;
const LIVE_GROWTH_INCHES = 6;
// latest_snow_reports has no upper bound on row age, so when a feed dies its
// last total sits there looking current. Older than this it is not evidence
// about today. (The global runFreshnessCheck below only pages an admin.)
const MAX_REPORT_AGE_HOURS = 36;

type SkipCounts = { live_cooldown: number; forecast_cooldown: number; stale_report: number };

function dateOffset(date: Date, days: number): string {
  return new Date(date.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

function daysSince(alertDate: string, today: string): number | null {
  const then = Date.parse(`${alertDate}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(then) || !Number.isFinite(now)) return null;
  return Math.floor((now - then) / 86_400_000);
}

function isFreshReport(updatedAt: string | null | undefined, nowMs: number): boolean {
  if (!updatedAt) return false;
  const then = Date.parse(updatedAt);
  return Number.isFinite(then) && nowMs - then <= MAX_REPORT_AGE_HOURS * 3_600_000;
}

function shouldSuppressLive(
  logs: AlertLog[],
  hasMetadata: boolean,
  subscriberId: string,
  resortId: string,
  newSnow: number,
  today: string,
): boolean {
  const matching = logs.filter((log) => log.subscriber_id === subscriberId && log.resort_id === resortId);
  // One email per pair per day whatever its kind: a forecast mailed earlier
  // today already announced this storm.
  if (matching.some((log) => log.alert_date === today)) return true;

  // Without the `kind` column every row counts as a live send.
  const recentLive = matching.filter((log) =>
    (!hasMetadata || log.kind === "live") && (daysSince(log.alert_date, today) ?? 99) < LIVE_COOLDOWN_DAYS
  );
  if (recentLive.length === 0) return false;
  const last = recentLive.reduce((a, b) =>
    b.alert_date > a.alert_date || (b.alert_date === a.alert_date && b.new_snow_inches > a.new_snow_inches) ? b : a
  );
  return newSnow < last.new_snow_inches + LIVE_GROWTH_INCHES;
}

function shouldSuppressForecast(
  logs: AlertLog[],
  hasMetadata: boolean,
  subscriberId: string,
  resortId: string,
  forecast: { snowInches: number; stormStartDate: string | null },
  today: string,
): boolean {
  const matching = logs.filter((log) => log.subscriber_id === subscriberId && log.resort_id === resortId);
  if (!hasMetadata) {
    // Legacy schema has no `kind` column: any matching row inside the cooldown
    // suppresses. (The kind test made this branch dead code pre-migration.)
    return matching.some((log) => (daysSince(log.alert_date, today) ?? 99) < FORECAST_COOLDOWN_DAYS);
  }
  if (!forecast.stormStartDate) {
    return matching.some((log) => log.kind === "forecast" && (daysSince(log.alert_date, today) ?? 99) < FORECAST_COOLDOWN_DAYS);
  }

  const sameStorm = matching.filter((log) =>
    log.kind === "forecast" && log.storm_start_date === forecast.stormStartDate
  );
  if (sameStorm.length > 0) {
    const highestTotal = Math.max(...sameStorm.map((log) => log.new_snow_inches));
    return forecast.snowInches < highestTotal + FORECAST_GROWTH_INCHES;
  }

  // Rows written before storm metadata was available still get a short cooldown.
  return matching.some((log) =>
    log.kind === "forecast" && !log.storm_start_date && (daysSince(log.alert_date, today) ?? 99) < FORECAST_COOLDOWN_DAYS
  );
}

/** Null when neither query succeeded — the caller must not send blind. */
async function loadAlertLogs(now: Date): Promise<{ logs: AlertLog[]; hasMetadata: boolean } | null> {
  const lookback = dateOffset(now, -FORECAST_LOOKBACK_DAYS);
  try {
    const response = await sbFetch(
      `/powder_alert_log?alert_date=gte.${lookback}&select=subscriber_id,resort_id,new_snow_inches,alert_date,kind,storm_start_date`
    );
    if (response.ok) return { logs: await response.json(), hasMetadata: true };
  } catch {
    // Fall through to the legacy query below.
  }

  // Older environments may not have the forecast metadata columns yet. Use a
  // short lookback supported by the original schema as a safe cooldown.
  try {
    const response = await sbFetch(
      `/powder_alert_log?alert_date=gte.${dateOffset(now, -FORECAST_COOLDOWN_DAYS)}&select=subscriber_id,resort_id,new_snow_inches,alert_date`
    );
    if (response.ok) return { logs: await response.json(), hasMetadata: false };
  } catch {
    // Reported below as a failed read.
  }
  return null;
}

async function insertAlertLogs(entries: Array<Record<string, unknown>>): Promise<boolean> {
  let response: Response;
  try {
    response = await sbFetch("/powder_alert_log", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates" },
      body: JSON.stringify(entries),
    });
  } catch {
    return false;
  }
  if (response.ok) return true;
  if (response.status !== 400 && response.status !== 404) return false;

  // Unknown-column fallback for databases that have not run the metadata migration.
  const legacyEntries = entries.map(({ kind: _kind, storm_start_date: _stormStartDate, ...entry }) => entry);
  try {
    const fallback = await sbFetch("/powder_alert_log", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates" },
      body: JSON.stringify(legacyEntries),
    });
    return fallback.ok;
  } catch {
    return false;
  }
}

// Dead-man's switch on the two production snow feeds (snotel-sync,
// model-sync — both write snow_reports on independent 6h schedules, and
// nothing else watches them). Fully isolated from the powder-alert path
// below in both directions: a broken freshness check must never block
// powder alerts, and a broken powder-alert run must never skip it. Detection
// latency is bounded by this cron's own schedule (daily, 13:00 UTC) — a feed
// that dies right after a run stays undetected for up to ~24h.
async function runFreshnessCheck(): Promise<FreshnessSummary> {
  try {
    const latestResp = await sbFetch(
      `/snow_reports?select=updated_at&order=updated_at.desc&limit=1`
    );
    // A failed query is treated the same as an empty table — stale, not a crash.
    const latestRows: Array<{ updated_at: string }> = latestResp.ok ? await latestResp.json() : [];
    const latest = latestRows[0]?.updated_at ?? null;
    const { ageHours, stale } = checkFreshness(Date.now(), latest);

    let alerted = false;
    if (stale) {
      try {
        const result = await sendFeedFreshnessAlertEmail({ ageHours });
        alerted = result.ok;
        if (!result.ok) {
          console.error(`[alerts/trigger] freshness alert email failed: ${result.error.kind}`);
        }
      } catch (err) {
        console.error(`[alerts/trigger] freshness alert email threw:`, err);
      }
    }
    return {
      ageHours: ageHours === null ? null : Math.round(ageHours * 10) / 10,
      stale,
      alerted,
    };
  } catch (err) {
    console.error(`[alerts/trigger] freshness check failed:`, err);
    return { ageHours: null, stale: true, alerted: false };
  }
}

// Shared handler for both GET (Vercel Cron) and POST (script) invocations.
// Protected by Authorization: Bearer <CRON_SECRET>
// Checks latest SNOTEL data against subscriber thresholds and fires emails.
async function handleTrigger(request: NextRequest) {
  // Auth check — fail closed when CRON_SECRET is not configured
  if (!CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Runs regardless of what happens below — see runFreshnessCheck's isolation note.
  const freshness = await runFreshnessCheck();

  // 1. Load all alert preferences with subscriber + resort info
  const prefsResp = await sbFetch(
    `/alert_preferences?select=subscriber_id,resort_id,threshold_inches,alert_subscribers(id,email,manage_token),resorts(name,slug)`
  );
  if (!prefsResp.ok) {
    return NextResponse.json({ error: "Failed to load preferences", freshness }, { status: 500 });
  }
  const prefs: AlertPreference[] = await prefsResp.json();
  const skipped: SkipCounts = { live_cooldown: 0, forecast_cooldown: 0, stale_report: 0 };

  if (prefs.length === 0) {
    return NextResponse.json({
      ok: true,
      attempted: 0,
      sent: 0,
      failed: 0,
      logFailures: 0,
      message: "No active subscriptions",
      skipped,
      freshness,
    });
  }

  // 2. Load latest snow reports for all relevant resort IDs. updated_at comes
  // along so a resort whose feed has stopped moving can be rejected below.
  const resortIds = [...new Set(prefs.map((p) => p.resort_id))];
  const snowResp = await sbFetch(
    `/latest_snow_reports?resort_id=in.(${resortIds.map((id) => `"${id}"`).join(",")})&select=resort_id,new_snow_24h,updated_at`
  );
  if (!snowResp.ok) {
    return NextResponse.json({ error: "Failed to load snow reports", freshness }, { status: 500 });
  }
  const snowReports: SnowReport[] = await snowResp.json();
  const nowMs = Date.now();
  const snowByResort = new Map(snowReports.map((s) => [s.resort_id, {
    newSnow: s.new_snow_24h ?? 0,
    fresh: isFreshReport(s.updated_at, nowMs),
  }]));

  // Alerts use seven-day Open-Meteo forecasts. US resort pages use NWS,
  // so their numbers can differ. Forecast failures must not block live alerts.
  const forecastByResort = new Map<string, WeatherPeriod[]>();
  try {
    const locationsResp = await sbFetch(
      `/resorts?id=in.(${resortIds.map((id) => `"${id}"`).join(",")})&select=id,lat,lng`
    );
    const locations: ResortLocation[] = locationsResp.ok ? await locationsResp.json() : [];
    await Promise.all(locations.map(async (location) => {
      try {
        const periods = await getOpenMeteoForecast(location.lat, location.lng);
        if (periods) forecastByResort.set(location.id, periods);
      } catch {
        // Includes malformed provider responses; omit only this resort's forecast.
      }
    }));
  } catch {
    // Location lookup is optional too: continue with the live reports already loaded.
  }

  // 3. Group triggered alerts by subscriber
  // Map: subscriber_id → { subscriber, alerts[] }
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const loaded = await loadAlertLogs(new Date());
  if (!loaded) {
    // Without the log a first alert is indistinguishable from a repeat, and
    // re-mailing every subscriber their last storm is worse than a missed run.
    console.error("[alerts/trigger] alert log read failed — no alerts sent");
    return NextResponse.json({ error: "Failed to load alert log", freshness }, { status: 500 });
  }
  const { logs, hasMetadata } = loaded;
  const todayLog = logs.filter((log) => log.alert_date === today);

  type AlertEntry = {
    resortName: string;
    slug: string;
    newSnow: number;
    threshold: number;
    resort_id: string;
    forecastLeadDays?: number;
    forecastDays?: number;
    stormStartDate?: string | null;
  };
  const bySubscriber = new Map<string, { subscriber: Subscriber; alerts: AlertEntry[] }>();
  const staleResorts = new Set<string>();

  for (const pref of prefs) {
    const report = snowByResort.get(pref.resort_id);
    const newSnow = report?.newSnow ?? 0;
    const periods = forecastByResort.get(pref.resort_id);
    // Include tomorrow. A qualifying live reading takes priority, and the existing
    // subscriber/resort/day log deduplicates either kind of alert for today.
    const forecast = periods ? findForecastAlert(periods, pref.threshold_inches) : null;
    let hasLiveAlert = newSnow >= pref.threshold_inches;
    if (hasLiveAlert && !report?.fresh) {
      // A dead feed's last total must not mail. The forecast is independent
      // of that feed, so it is still evaluated below.
      skipped.stale_report++;
      staleResorts.add(pref.resort_id);
      hasLiveAlert = false;
    }
    if (!hasLiveAlert && !forecast) continue;

    const todayRows = todayLog.filter((log) =>
      log.subscriber_id === pref.subscriber_id && log.resort_id === pref.resort_id
    );
    if (hasLiveAlert && shouldSuppressLive(
      logs,
      hasMetadata,
      pref.subscriber_id,
      pref.resort_id,
      newSnow,
      today,
    )) {
      skipped.live_cooldown++;
      continue;
    }
    if (!hasLiveAlert && todayRows.some((log) => log.kind !== "forecast")) continue;
    if (!hasLiveAlert && forecast && shouldSuppressForecast(
      logs,
      hasMetadata,
      pref.subscriber_id,
      pref.resort_id,
      forecast,
      today,
    )) {
      skipped.forecast_cooldown++;
      continue;
    }

    const sub = pref.alert_subscribers;
    if (!bySubscriber.has(pref.subscriber_id)) {
      bySubscriber.set(pref.subscriber_id, { subscriber: sub, alerts: [] });
    }
    bySubscriber.get(pref.subscriber_id)!.alerts.push({
      resortName: pref.resorts.name,
      slug: pref.resorts.slug,
      newSnow: hasLiveAlert ? newSnow : forecast!.snowInches,
      threshold: pref.threshold_inches,
      resort_id: pref.resort_id,
      ...(hasLiveAlert ? {} : {
        forecastLeadDays: forecast!.leadDays,
        forecastDays: forecast!.forecastDays,
        stormStartDate: forecast!.stormStartDate,
      }),
    });
  }

  if (staleResorts.size > 0) {
    console.warn(
      `[alerts/trigger] skipped ${skipped.stale_report} live alert(s): snow report older than ` +
        `${MAX_REPORT_AGE_HOURS}h or untimestamped for resort(s) ${[...staleResorts].join(", ")}`
    );
  }

  if (bySubscriber.size === 0) {
    return NextResponse.json({
      ok: true,
      attempted: 0,
      sent: 0,
      failed: 0,
      logFailures: 0,
      message: "No thresholds exceeded",
      skipped,
      freshness,
    });
  }

  // 4. Send emails and log
  const attempted = bySubscriber.size;
  let sent = 0;
  let failed = 0;
  let logFailures = 0;
  // Distinct failure reasons, surfaced in the response so a dead API key shows
  // up in the cron result itself instead of only in the logs.
  const errors = new Set<string>();

  for (const [subscriberId, { subscriber, alerts }] of bySubscriber) {
    try {
      await sendPowderAlertEmail({
        email: subscriber.email,
        manageToken: subscriber.manage_token,
        alerts,
      });

      // Log sent alerts (ON CONFLICT DO NOTHING for dedup safety)
      const logEntries = alerts.map((a) => ({
        subscriber_id: subscriberId,
        resort_id: a.resort_id,
        new_snow_inches: Math.round(a.newSnow),
        alert_date: today,
        kind: a.forecastLeadDays != null ? "forecast" : "live",
        storm_start_date: a.forecastLeadDays != null ? a.stormStartDate ?? null : null,
      }));

      sent++;
      if (!await insertAlertLogs(logEntries)) {
        logFailures++;
        failed++;
        errors.add("log_insert_failed");
      }
    } catch (err) {
      console.error(`[alerts/trigger] Failed to send to ${subscriber.email}:`, err);
      failed++;
      if (err instanceof EmailSendError) {
        errors.add(`${err.kind}${err.resendErrorName ? `:${err.resendErrorName}` : ""}`);
      } else {
        errors.add(err instanceof Error ? err.name : "unknown_error");
      }
    }
  }

  const summary = {
    ok: failed === 0,
    attempted,
    sent,
    failed,
    logFailures,
    skipped,
    ...(errors.size > 0 ? { errors: [...errors] } : {}),
    freshness,
  };

  console.log(
    `[alerts/trigger] Done — ${sent}/${attempted} emails sent, ${failed} failed` +
      (errors.size > 0 ? ` (${[...errors].join(", ")})` : "")
  );

  // Any failure is reported as a failed cron run — otherwise a broken key stays
  // invisible until someone reads the logs.
  return NextResponse.json(summary, { status: failed > 0 ? 500 : 200 });
}

// GET — Vercel Cron invokes routes via GET
export async function GET(request: NextRequest) {
  return handleTrigger(request);
}

// POST — powder-alert-check.mjs script uses POST
export async function POST(request: NextRequest) {
  return handleTrigger(request);
}
