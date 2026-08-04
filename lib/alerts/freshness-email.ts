// lib/alerts/freshness-email.ts
//
// Admin notification for the snow-feed dead-man's switch (see
// lib/feed-freshness.ts). Fire-and-forget by design, same as cam report
// notifications: never throws, so a broken Resend key can't take down the
// /api/alerts/trigger cron or the powder alerts it also sends.

import { sendEmail, type EmailClient, type EmailResult } from "@/lib/email";

const FALLBACK_ADMIN_EMAIL = "jaredschuelerspotify@gmail.com";

// Reuses the admin-recipient env var already established for cam report
// notifications (lib/cam-reports/email.ts) rather than adding a new one.
function recipient(): string {
  return process.env.ALERT_ADMIN_EMAIL || FALLBACK_ADMIN_EMAIL;
}

function buildBody(ageHours: number | null): string {
  const ageLine =
    ageHours === null
      ? "snow_reports has no rows at all — either the table is empty or the freshness query itself failed."
      : `The newest snow_reports row is ${ageHours.toFixed(1)}h old.`;

  return [
    `${ageLine}`,
    "",
    "Two production feeds write this table on independent 6h schedules — either",
    "or both may be the cause:",
    "  - snotel-sync   (scripts/snotel-sync.ts, launchd com.peakcam.snotel-sync)",
    "  - model-sync    (scripts/model-sync.ts, launchd com.peakcam.model-sync)",
    "",
    "Check scripts/snotel-sync.log and scripts/model-sync.log on the Mac mini",
    "for the last successful run and any errors.",
    "",
    "This check runs once daily inside the /api/alerts/trigger cron (13:00 UTC),",
    "so detection latency is up to ~24h from when a feed actually stopped.",
  ].join("\n");
}

/**
 * Fire-and-forget by design: a failed freshness notification must never fail
 * the cron run that also sends powder alerts. Returns the send result instead
 * of throwing so the caller can report `alerted` without a try/catch of its
 * own, but callers should still wrap this in try/catch for full isolation.
 */
export async function sendFeedFreshnessAlertEmail(
  params: { ageHours: number | null },
  client?: EmailClient
): Promise<EmailResult> {
  return sendEmail(
    {
      emailType: "feed_freshness",
      to: recipient(),
      logPrefix: "alerts-freshness",
      payload: {
        subject: "PeakCam snow feeds are stale",
        text: buildBody(params.ageHours),
      },
    },
    client
  );
}
