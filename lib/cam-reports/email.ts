// lib/cam-reports/email.ts
//
// Fire-and-forget notification email for a new cam report.
//
// - Per-submission email (no batching).
// - Rollup subject when a cam has ≥ 2 prior reports in 24h (so this is the 3rd+).
// - In-process volume guard: if > 20 reports land in any 10-minute rolling
//   window across all cams, pause email sending for the next hour. DB is
//   unaffected; this is just to stop us from burning Resend quota during a
//   bot flood on a warm serverless instance.

import { Resend } from "resend";
import type { CamReportReason } from "@/lib/types";

const SUPABASE_PROJECT = "owsxnogvufankayfwczl";
const FALLBACK_ADMIN_EMAIL = "jaredschuelerspotify@gmail.com";
const FROM = "PeakCam Alerts <alerts@peakcam.io>";
const MAX_REPORTS_PER_10M = 20;
const PAUSE_MS = 60 * 60 * 1000;     // 60 min
const WINDOW_MS = 10 * 60 * 1000;    // 10 min

// Rolling-window counter + pause flag. Module-level = shared across requests
// on the same warm Lambda instance. Resets on cold start, which is fine.
const recentSendTimestamps: number[] = [];
let emailPausedUntil = 0;

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

function recipient(): string {
  return (
    process.env.CAM_REPORT_ADMIN_EMAIL ||
    process.env.ALERT_ADMIN_EMAIL ||
    FALLBACK_ADMIN_EMAIL
  );
}

const REASON_LABEL: Record<CamReportReason, string> = {
  broken: "Broken / won't load",
  wrong_view: "Wrong view / wrong location",
  other: "Something else",
};

export interface CamReportEmailInput {
  reportId: string;
  createdAt: string;
  sessionId: string;
  reason: CamReportReason;
  resort_link_dead: boolean;
  suggested_url: string | null;
  cam: {
    id: string;
    name: string;
    embed_type: string;
    embed_url: string | null;
    youtube_id: string | null;
  };
  resort: { name: string; state: string };
  priorReportsIn24h: number;    // count EXCLUDING the one we just wrote
  priorReportsIn7d: number;     // count INCLUDING the one we just wrote
}

function ordinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function buildSubject(input: CamReportEmailInput): string {
  const base = `Cam report · ${input.resort.name} — ${input.cam.name}`;
  if (input.priorReportsIn24h >= 2) {
    const nth = input.priorReportsIn24h + 1;
    return `🔥 ${base} (${nth}${ordinalSuffix(nth)} in 24h)`;
  }
  return `🚨 ${base} (${REASON_LABEL[input.reason].toLowerCase()})`;
}

function buildBody(input: CamReportEmailInput): string {
  const lines = [
    `Reason:        ${REASON_LABEL[input.reason]}`,
    `Resort site:   ${input.resort_link_dead ? "also dead" : "not flagged"}`,
    `Suggested:     ${input.suggested_url ?? "(none)"}`,
    "",
    `Cam:    ${input.cam.name}`,
    `Resort: ${input.resort.name} · ${input.resort.state}`,
    `Embed:  ${input.cam.embed_type} · ${input.cam.youtube_id || input.cam.embed_url || "(no url)"}`,
    "",
    `Session: ${input.sessionId.slice(0, 8)}… · ${input.createdAt} · ${input.priorReportsIn7d} report(s) in last 7d`,
    `Supabase: https://supabase.com/dashboard/project/${SUPABASE_PROJECT}/editor?table=cam_reports&filter=cam_id:eq:${input.cam.id}`,
  ];
  return lines.join("\n");
}

function volumeGuardPermits(now: number): boolean {
  if (now < emailPausedUntil) return false;

  // prune old timestamps out of the rolling window
  const cutoff = now - WINDOW_MS;
  while (recentSendTimestamps.length && recentSendTimestamps[0] < cutoff) {
    recentSendTimestamps.shift();
  }

  if (recentSendTimestamps.length >= MAX_REPORTS_PER_10M) {
    emailPausedUntil = now + PAUSE_MS;
    console.warn(
      `[cam-reports] email paused for 60m — ${recentSendTimestamps.length} reports in last 10m`,
    );
    return false;
  }
  return true;
}

export async function sendCamReportEmail(input: CamReportEmailInput): Promise<void> {
  const now = Date.now();
  if (!volumeGuardPermits(now)) return;

  const client = getResend();
  if (!client) {
    console.warn("[cam-reports] RESEND_API_KEY not set; skipping email");
    return;
  }

  recentSendTimestamps.push(now);

  const subject = buildSubject(input);
  const text = buildBody(input);

  try {
    await client.emails.send({
      from: FROM,
      to: recipient(),
      subject,
      text,
    });
  } catch (err) {
    console.error("[cam-reports] Resend send failed:", err);
  }
}
