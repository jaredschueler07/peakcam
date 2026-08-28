import { NextRequest, NextResponse } from "next/server";
import { loadManageData } from "@/lib/alerts/manage-data";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

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

/** Mirrors clampThreshold in lib/alerts/subscribe-core.ts. */
function clampThreshold(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 6;
  return Math.max(1, Math.min(48, Math.round(n)));
}

// GET /api/alerts/manage?token=xxx
// Returns the subscriber's current preferences + all available resorts
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  const data = await loadManageData(token);
  if (!data) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 404 });
  }

  return NextResponse.json(data);
}

// PUT /api/alerts/manage
// Body: { token, resort_ids[], thresholds?: { [resort_id]: inches } }
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null);

  if (!body?.token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }
  if (!Array.isArray(body?.resort_ids)) {
    return NextResponse.json({ error: "resort_ids must be an array" }, { status: 400 });
  }

  const subResp = await sbFetch(
    `/alert_subscribers?manage_token=eq.${encodeURIComponent(body.token)}&select=id&limit=1`
  );
  const subscribers = subResp.ok ? await subResp.json() : [];
  if (!subscribers.length) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 404 });
  }
  const subscriberId = subscribers[0].id;

  // Delete all existing preferences
  await sbFetch(`/alert_preferences?subscriber_id=eq.${subscriberId}`, { method: "DELETE" });

  // If no resorts selected, subscriber keeps their account but has no active alerts
  if (body.resort_ids.length === 0) {
    return NextResponse.json({ ok: true, resort_count: 0 });
  }

  const thresholds: Record<string, unknown> = body.thresholds ?? {};
  const prefs = body.resort_ids.map((rid: string) => ({
    subscriber_id: subscriberId,
    resort_id: rid,
    // Same clamp as the subscribe path. Guarding the type as well as the range
    // matters here: a non-numeric threshold fell straight through Math.min to
    // NaN, which Postgres rejects — losing the whole save after the delete
    // above had already cleared the subscriber's existing preferences.
    threshold_inches: clampThreshold(thresholds[rid]),
  }));

  const insertResp = await sbFetch("/alert_preferences", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify(prefs),
  });

  if (!insertResp.ok) {
    return NextResponse.json({ error: "Failed to update preferences" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, resort_count: prefs.length });
}
