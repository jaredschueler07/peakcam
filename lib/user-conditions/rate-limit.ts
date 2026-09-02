// ─────────────────────────────────────────────────────────────
// "One report per resort per user per hour" for /api/user-conditions/submit.
//
// The check used to run on the cookie-bound RLS client, which cannot see the
// rows it is looking for: the only SELECT policy on `user_conditions` is
// `using (is_flagged = false)`, and there is no "read your own rows" policy. A
// report whose notes trip the profanity filter is stored with is_flagged=true,
// becomes invisible to this query, and therefore never counts against the
// limit — so the users who trip the filter are exactly the users with no rate
// limit at all.
//
// The existence check is therefore made with the service-role key, which
// bypasses RLS. Scope note: the service role is used for THIS READ ONLY. The
// insert stays on the user's RLS-scoped client so the database still enforces
// that a user can only write rows for themselves.
// ─────────────────────────────────────────────────────────────

import { readServiceEnv } from "@/lib/api/service-env";

export const RATE_LIMIT_WINDOW_MS = 3_600_000;

/**
 * PostgREST path for "does this user have a report for this resort inside the
 * window?". Every caller-influenced value is URL-encoded — `resortId` comes
 * straight from the request body, and an unencoded `&` there would otherwise
 * append attacker-chosen parameters to a service-role request.
 */
export function recentReportPath(
  resortId: string,
  userId: string,
  sinceIso: string
): string {
  const q = new URLSearchParams({
    select: "id",
    resort_id: `eq.${resortId}`,
    user_id: `eq.${userId}`,
    submitted_at: `gte.${sinceIso}`,
    limit: "1",
  });
  return `/user_conditions?${q.toString()}`;
}

/**
 * Returns true when the user is inside their cooldown for this resort.
 *
 * Fails open (returns false) if the service-role read cannot be made at all,
 * matching the route's previous behaviour of ignoring query errors: a
 * transient Supabase failure should not block every honest condition report on
 * the site. The failure is logged so it is visible if it stops being transient.
 */
export async function hasRecentReport(params: {
  /** Defaults to NEXT_PUBLIC_SUPABASE_URL. */
  supabaseUrl?: string | undefined;
  /** Defaults to SUPABASE_SERVICE_ROLE_KEY. */
  serviceKey?: string | undefined;
  resortId: string;
  userId: string;
  now?: number;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const { resortId, userId } = params;
  // Only omitted keys fall back to the environment. An explicitly-passed
  // `undefined` stays undefined, so a caller can still exercise fail-open.
  const env = readServiceEnv();
  const supabaseUrl = "supabaseUrl" in params ? params.supabaseUrl : env.url;
  const serviceKey = "serviceKey" in params ? params.serviceKey : env.serviceKey;
  if (!supabaseUrl || !serviceKey) {
    console.error("[PeakCam] rate-limit check skipped: service-role env missing");
    return false;
  }

  const sinceIso = new Date((params.now ?? Date.now()) - RATE_LIMIT_WINDOW_MS).toISOString();
  const doFetch = params.fetchImpl ?? fetch;

  try {
    const resp = await doFetch(
      `${supabaseUrl}/rest/v1${recentReportPath(resortId, userId, sinceIso)}`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        cache: "no-store",
      }
    );
    if (!resp.ok) {
      console.error("[PeakCam] rate-limit check failed:", await resp.text());
      return false;
    }
    const rows = await resp.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch (err) {
    console.error("[PeakCam] rate-limit check errored:", err);
    return false;
  }
}
