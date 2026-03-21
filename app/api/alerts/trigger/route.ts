import { NextRequest, NextResponse } from "next/server";
import { sendPowderAlertEmail } from "@/lib/email";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CRON_SECRET = process.env.CRON_SECRET;

function sbFetch(path: string, init?: RequestInit) {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
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
  subscribers: Subscriber;
  resorts: { name: string; slug: string };
}

interface SnowReport {
  resort_id: string;
  new_snow_24h: number | null;
}

// POST /api/alerts/trigger
// Protected by Authorization: Bearer <CRON_SECRET>
// Checks latest SNOTEL data against subscriber thresholds and fires emails.
export async function POST(request: NextRequest) {
  // Auth check
  if (CRON_SECRET) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // 1. Load all alert preferences with subscriber + resort info
  const prefsResp = await sbFetch(
    `/alert_preferences?select=subscriber_id,resort_id,threshold_inches,subscribers(id,email,manage_token),resorts(name,slug)`
  );
  if (!prefsResp.ok) {
    return NextResponse.json({ error: "Failed to load preferences" }, { status: 500 });
  }
  const prefs: AlertPreference[] = await prefsResp.json();

  if (prefs.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, message: "No active subscriptions" });
  }

  // 2. Load latest snow reports for all relevant resort IDs
  const resortIds = [...new Set(prefs.map((p) => p.resort_id))];
  const snowResp = await sbFetch(
    `/latest_snow_reports?resort_id=in.(${resortIds.map((id) => `"${id}"`).join(",")})&select=resort_id,new_snow_24h`
  );
  if (!snowResp.ok) {
    return NextResponse.json({ error: "Failed to load snow reports" }, { status: 500 });
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

    const sub = pref.subscribers;
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
    return NextResponse.json({ ok: true, sent: 0, message: "No thresholds exceeded" });
  }

  // 4. Send emails and log
  let sent = 0;
  let failed = 0;

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
    }
  }

  console.log(`[alerts/trigger] Done — ${sent} emails sent, ${failed} failed`);
  return NextResponse.json({ ok: true, sent, failed });
}
