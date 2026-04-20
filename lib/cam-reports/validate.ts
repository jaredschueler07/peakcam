// lib/cam-reports/validate.ts
import type { CamReportReason } from "@/lib/types";

const REASON_VALUES: CamReportReason[] = ["broken", "wrong_view", "other"];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

// Block localhost, loopback, and RFC1918 private ranges.
// We don't want the admin clicking a suggested URL that points inside
// our own infra or at a private network.
const BLOCKED_HOST_RE =
  /^(localhost|0\.0\.0\.0|::1|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/i;

export function isSafePublicUrl(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  if (raw.length > 500) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (BLOCKED_HOST_RE.test(u.hostname)) return false;
  return true;
}

export interface ParsedCamReport {
  cam_id: string;
  session_id: string;
  reason: CamReportReason;
  resort_link_dead: boolean;
  suggested_url: string | null;
}

export type ParseResult =
  | { ok: true; value: ParsedCamReport }
  | { ok: false; error: string };

export function parseCamReportBody(body: unknown): ParseResult {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid JSON body" };
  }
  const b = body as Record<string, unknown>;

  if (!isUuid(b.cam_id)) {
    return { ok: false, error: "cam_id must be a UUID" };
  }
  if (!isUuid(b.session_id)) {
    return { ok: false, error: "session_id must be a UUID" };
  }
  if (
    typeof b.reason !== "string" ||
    !REASON_VALUES.includes(b.reason as CamReportReason)
  ) {
    return { ok: false, error: "Invalid reason" };
  }
  if (typeof b.resort_link_dead !== "boolean") {
    return { ok: false, error: "resort_link_dead must be boolean" };
  }

  let suggested_url: string | null = null;
  if (b.suggested_url !== undefined && b.suggested_url !== null && b.suggested_url !== "") {
    if (!isSafePublicUrl(b.suggested_url)) {
      return { ok: false, error: "suggested_url must be a public http(s) URL" };
    }
    suggested_url = b.suggested_url;
  }

  return {
    ok: true,
    value: {
      cam_id: b.cam_id,
      session_id: b.session_id,
      reason: b.reason as CamReportReason,
      resort_link_dead: b.resort_link_dead,
      suggested_url,
    },
  };
}
