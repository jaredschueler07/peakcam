import { NextRequest, NextResponse } from "next/server";
import { EmailSendError, sendOpeningDayEmail } from "@/lib/email";
import {
  planOpeningDayEmails,
  type OpeningLogEntry,
  type OpeningPreference,
  type OpeningTodayResort,
} from "@/lib/alerts/opening-day";
import {
  feedOpeningMailVerdict,
  feedOpeningQueryDays,
  seasonLogStart,
  type FeedOpeningMailRow,
} from "@/lib/alerts/feed-opening-email";
import { inList, serviceFetch } from "@/lib/alerts/service-fetch";
import { CURRENT_SEASON, formatOpeningDate } from "@/lib/openings";

// ── Same-day opening email for a feed-detected opening ──────────────────────
// scripts/operator-sync.ts calls this (Bearer CRON_SECRET) on a run where a
// resort's stored feed_open is that resort's local today. The call carries no
// resort list: this route reads resort_openings itself and mails only what
// lib/alerts/feed-opening-email.ts allows (same local day, before the lifts
// close, no confirmed date owning the email). Dedupe is season-wide and
// claimed before sending, so overlapping calls can never mail a subscriber
// twice about a resort: the log row is inserted first, the unique index on
// (subscriber, resort, day, kind, …) lets exactly one insert win, and only
// the winner sends. A failed send removes its claim so a later call that
// same day can try again.

export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;

interface Summary {
  resortsOpening: number;
  attempted: number;
  sent: number;
  failed: number;
  skipped: Record<string, string>;
  errors?: string[];
}

interface LogRow {
  id: string;
  resort_id: string;
}

/** Inserts one opening log row; returns its id when this call won the claim, null when it was already there. */
async function claim(subscriberId: string, resortId: string, day: string): Promise<string | null> {
  const res = await serviceFetch("/powder_alert_log", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      subscriber_id: subscriberId,
      resort_id: resortId,
      new_snow_inches: 0,
      alert_date: day,
      kind: "opening",
      storm_start_date: null,
    }),
  });
  // 409: the unique index already holds this (subscriber, resort, day) — someone else sent it.
  // Anything else is a failed write; either way this call does not send.
  if (!res.ok) {
    if (res.status !== 409) console.error(`[alerts/feed-openings] claim insert failed (${res.status}):`, await res.text());
    return null;
  }
  const rows = (await res.json()) as LogRow[];
  return rows[0]?.id ?? null;
}

async function release(ids: string[]): Promise<void> {
  if (!ids.length) return;
  try {
    await serviceFetch(`/powder_alert_log?id=in.(${inList(ids)})`, { method: "DELETE" });
  } catch (err) {
    console.error("[alerts/feed-openings] releasing a failed send's claim threw:", err);
  }
}

async function run(now: Date): Promise<{ status: number; body: Summary }> {
  const summary: Summary = { resortsOpening: 0, attempted: 0, sent: 0, failed: 0, skipped: {} };
  const errors = new Set<string>();
  const done = (status = errors.size ? 500 : 200) => ({ status, body: errors.size ? { ...summary, errors: [...errors] } : summary });

  const { from, to } = feedOpeningQueryDays(now);
  const rowsResp = await serviceFetch(
    `/resort_openings?season=eq.${CURRENT_SEASON}&feed_open=gte.${from}&feed_open=lte.${to}` +
      `&select=resort_id,season,confirmed_open,feed_open,resorts(name,slug,state,country,lat,lng)`,
  );
  if (!rowsResp.ok) {
    errors.add("openings_query_failed");
    return done();
  }
  const rows: FeedOpeningMailRow[] = await rowsResp.json();
  const mailable: Array<FeedOpeningMailRow & { resorts: NonNullable<FeedOpeningMailRow["resorts"]>; feed_open: string }> = [];
  for (const row of rows) {
    const verdict = feedOpeningMailVerdict(row, now);
    if (verdict.mail && row.resorts && row.feed_open) mailable.push({ ...row, resorts: row.resorts, feed_open: row.feed_open });
    else if (!verdict.mail) summary.skipped[row.resorts?.slug ?? row.resort_id] = verdict.reason;
  }
  summary.resortsOpening = mailable.length;
  if (!mailable.length) return done();

  const ids = inList(mailable.map((r) => r.resort_id));
  const [prefsResp, logResp, camsResp] = await Promise.all([
    serviceFetch(
      `/alert_preferences?resort_id=in.(${ids})&opening_day=is.true&select=subscriber_id,resort_id,alert_subscribers(id,email,manage_token)`,
    ),
    // The whole season, not just today: one opening email per resort per season.
    serviceFetch(`/powder_alert_log?kind=eq.opening&alert_date=gte.${seasonLogStart()}&resort_id=in.(${ids})&select=subscriber_id,resort_id`),
    serviceFetch(`/cams?resort_id=in.(${ids})&is_active=eq.true&select=resort_id`),
  ]);
  if (!prefsResp.ok) errors.add("openings_prefs_query_failed");
  // Fail closed: with no log there is no way to know who already heard.
  if (!logResp.ok) errors.add("openings_log_query_failed");
  if (errors.size) return done();
  const prefs: OpeningPreference[] = await prefsResp.json();
  const alreadySent: OpeningLogEntry[] = await logResp.json();
  const camRows: Array<{ resort_id: string }> = camsResp.ok ? await camsResp.json() : [];
  const camCount = new Map<string, number>();
  for (const cam of camRows) camCount.set(cam.resort_id, (camCount.get(cam.resort_id) ?? 0) + 1);

  const dayById = new Map(mailable.map((r) => [r.resort_id, r.feed_open]));
  const openings: OpeningTodayResort[] = mailable.map((r) => ({
    resort_id: r.resort_id,
    name: r.resorts.name,
    slug: r.resorts.slug,
    camCount: camCount.get(r.resort_id) ?? 0,
  }));
  const plans = planOpeningDayEmails(openings, prefs, alreadySent);
  summary.attempted = plans.length;

  for (const plan of plans) {
    // Claim each (subscriber, resort) before sending; mail only the resorts this call won.
    const claims = await Promise.all(plan.resortIds.map((id) => claim(plan.subscriber.id, id, dayById.get(id)!)));
    const won = plan.resorts.filter((_, i) => claims[i] !== null);
    const claimIds = claims.filter((id): id is string => id !== null);
    if (!won.length) continue;
    // Every mailable resort's feed_open is its local today; label with the first won resort's.
    const firstWon = plan.resortIds[claims.findIndex((id) => id !== null)];
    const dateLabel = formatOpeningDate(dayById.get(firstWon)!, "long");
    try {
      await sendOpeningDayEmail({ email: plan.subscriber.email, manageToken: plan.subscriber.manage_token, dateLabel, resorts: won });
      summary.sent++;
    } catch (err) {
      console.error(`[alerts/feed-openings] opening email to subscriber ${plan.subscriber.id} failed:`, err);
      summary.failed++;
      errors.add(err instanceof EmailSendError ? `${err.kind}${err.resendErrorName ? `:${err.resendErrorName}` : ""}` : err instanceof Error ? err.name : "unknown_error");
      await release(claimIds);
    }
  }
  return done();
}

export async function POST(request: NextRequest) {
  if (!CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await run(new Date());
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error("[alerts/feed-openings] run threw:", err);
    return NextResponse.json({ error: err instanceof Error && err.name !== "Error" ? err.name : "feed_openings_threw" }, { status: 500 });
  }
}
