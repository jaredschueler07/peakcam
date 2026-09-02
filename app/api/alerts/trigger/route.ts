import { NextRequest, NextResponse } from "next/server";
import { EmailSendError, sendPowderAlertEmail } from "@/lib/email";
import { checkFreshness } from "@/lib/feed-freshness";
import { sendFeedFreshnessAlertEmail } from "@/lib/alerts/freshness-email";
import { createSbFetch } from "@/lib/api/sb-fetch";
import { jsonError } from "@/lib/api/response";

const CRON_SECRET = process.env.CRON_SECRET;

// Without the timeout, a hung DB hangs every one of this route's five
// sequential queries (and the cron run with it) — the anon-client timeout
// wrapper doesn't cover this raw service-role fetch.
const sbFetch = createSbFetch({ timeoutMs: 8_000 });

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
}

interface FreshnessSummary {
  ageHours: number | null;
  stale: boolean;
  alerted: boolean;
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
    return jsonError("CRON_SECRET not configured", 500);
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return jsonError("Unauthorized", 401);
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

  if (prefs.length === 0) {
    return NextResponse.json({
      ok: true,
      attempted: 0,
      sent: 0,
      failed: 0,
      message: "No active subscriptions",
      freshness,
    });
  }

  // 2. Load latest snow reports for all relevant resort IDs
  const resortIds = [...new Set(prefs.map((p) => p.resort_id))];
  const snowResp = await sbFetch(
    `/latest_snow_reports?resort_id=in.(${resortIds.map((id) => `"${id}"`).join(",")})&select=resort_id,new_snow_24h`
  );
  if (!snowResp.ok) {
    return NextResponse.json({ error: "Failed to load snow reports", freshness }, { status: 500 });
  }
  const snowReports: SnowReport[] = await snowResp.json();
  const snowByResort = new Map(snowReports.map((s) => [s.resort_id, s.new_snow_24h ?? 0]));

  // 3. Group triggered alerts by subscriber
  // Map: subscriber_id → { subscriber, alerts[] }
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Load already-sent alerts for today (dedup check)
  const logResp = await sbFetch(
    `/powder_alert_log?alert_date=eq.${today}&select=subscriber_id,resort_id`
  );
  const todayLog: Array<{ subscriber_id: string; resort_id: string }> = logResp.ok
    ? await logResp.json()
    : [];
  const alreadySent = new Set(todayLog.map((l) => `${l.subscriber_id}:${l.resort_id}`));

  type AlertEntry = { resortName: string; slug: string; newSnow: number; threshold: number; resort_id: string };
  const bySubscriber = new Map<string, { subscriber: Subscriber; alerts: AlertEntry[] }>();

  for (const pref of prefs) {
    const newSnow = snowByResort.get(pref.resort_id) ?? 0;
    if (newSnow < pref.threshold_inches) continue;

    const dedupKey = `${pref.subscriber_id}:${pref.resort_id}`;
    if (alreadySent.has(dedupKey)) continue;

    const sub = pref.alert_subscribers;
    if (!bySubscriber.has(pref.subscriber_id)) {
      bySubscriber.set(pref.subscriber_id, { subscriber: sub, alerts: [] });
    }
    bySubscriber.get(pref.subscriber_id)!.alerts.push({
      resortName: pref.resorts.name,
      slug: pref.resorts.slug,
      newSnow,
      threshold: pref.threshold_inches,
      resort_id: pref.resort_id,
    });
  }

  if (bySubscriber.size === 0) {
    return NextResponse.json({
      ok: true,
      attempted: 0,
      sent: 0,
      failed: 0,
      message: "No thresholds exceeded",
      freshness,
    });
  }

  // 4. Send emails and log
  const attempted = bySubscriber.size;
  let sent = 0;
  let failed = 0;
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
        new_snow_inches: a.newSnow,
        alert_date: today,
      }));

      await sbFetch("/powder_alert_log", {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates" },
        body: JSON.stringify(logEntries),
      });

      sent++;
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
