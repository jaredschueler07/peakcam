import { NextRequest, NextResponse } from "next/server";
import { EmailSendError, sendPowderAlertEmail } from "@/lib/email";
import { checkFreshness } from "@/lib/feed-freshness";
import { sendFeedFreshnessAlertEmail } from "@/lib/alerts/freshness-email";
import {
  selectPowderAlerts,
  cooldownLookbackDate,
  type AlertPreference,
  type AlertLogRow,
  type SnowSnapshot,
} from "@/lib/alerts/powder-trigger";

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

  // 2. Load latest snow reports for all relevant resort IDs.
  // updated_at comes along so the freshness rule in selectPowderAlerts can
  // reject a resort whose feed has stopped moving.
  const resortIds = [...new Set(prefs.map((p) => p.resort_id))];
  const snowResp = await sbFetch(
    `/latest_snow_reports?resort_id=in.(${resortIds.map((id) => `"${id}"`).join(",")})&select=resort_id,new_snow_24h,updated_at`
  );
  if (!snowResp.ok) {
    return NextResponse.json({ error: "Failed to load snow reports", freshness }, { status: 500 });
  }
  const snow: SnowSnapshot[] = await snowResp.json();

  const now = new Date();
  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD

  // 3. Load the alert log back over the whole cooldown window, not just today.
  // A same-day-only read (what this used to do) can never catch the repeat
  // sends the cooldown exists to prevent, since the cron runs once a day.
  const logResp = await sbFetch(
    `/powder_alert_log?alert_date=gte.${cooldownLookbackDate(now)}` +
      `&select=subscriber_id,resort_id,new_snow_inches,alert_date`
  );
  if (!logResp.ok) {
    // Fail closed: with no log we cannot tell a first alert from a repeat, and
    // re-mailing everyone their last storm is worse than skipping a run.
    console.error("[alerts/trigger] alert log read failed — skipping send");
    return NextResponse.json(
      { error: "Failed to load alert log", freshness },
      { status: 500 }
    );
  }
  const recentLog: AlertLogRow[] = await logResp.json();

  // 4. Apply the threshold / freshness / cooldown rules.
  const { batches, skipped } = selectPowderAlerts({ prefs, snow, recentLog, now });

  if (batches.length === 0) {
    return NextResponse.json({
      ok: true,
      attempted: 0,
      sent: 0,
      failed: 0,
      message: "No alerts due",
      skipped,
      freshness,
    });
  }

  // 5. Send emails and log
  const attempted = batches.length;
  let sent = 0;
  let failed = 0;
  // Distinct failure reasons, surfaced in the response so a dead API key shows
  // up in the cron result itself instead of only in the logs.
  const errors = new Set<string>();

  for (const { subscriber, alerts } of batches) {
    try {
      await sendPowderAlertEmail({
        email: subscriber.email,
        manageToken: subscriber.manage_token,
        alerts,
      });

      // Logged only after the mail is accepted: this row is what the cooldown
      // reads next run, so writing it first would silence a subscriber for the
      // whole window on the strength of an email that never went out.
      const logEntries = alerts.map((a) => ({
        subscriber_id: subscriber.id,
        resort_id: a.resort_id,
        new_snow_inches: a.newSnow,
        alert_date: today,
      }));

      const logWrite = await sbFetch("/powder_alert_log", {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates" },
        body: JSON.stringify(logEntries),
      });
      if (!logWrite.ok) {
        // The email is already out; the run is not a failure. But the cooldown
        // is now blind to this send, so say so loudly rather than let a silent
        // repeat next run look like correct behaviour.
        console.error(
          `[alerts/trigger] alert log write failed for ${subscriber.email} — ` +
            `cooldown will not suppress a repeat: ${await logWrite.text()}`
        );
        errors.add("log_write_failed");
      }

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
