import { NextRequest, NextResponse } from "next/server";
import { loadManageData } from "@/lib/alerts/manage-data";
import { parsePreferenceUpdate } from "@/lib/alerts/subscribe-core";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sbFetch(path: string, init?: RequestInit) {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    signal: AbortSignal.timeout(8_000),
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

// Quoted and URL-encoded for a PostgREST `in.()` filter on a service-role
// request; ids have already passed the uuid check in parsePreferenceUpdate.
function inList(ids: string[]): string {
  return ids.map((id) => encodeURIComponent(`"${id}"`)).join(",");
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
  const parsed = parsePreferenceUpdate(await request.json().catch(() => null));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { token, resortIds, thresholds } = parsed.value;

  const subResp = await sbFetch(
    `/alert_subscribers?manage_token=eq.${encodeURIComponent(token)}&select=id&limit=1`
  );
  const subscribers: Array<{ id: string }> = subResp.ok ? await subResp.json() : [];
  if (!subscribers.length) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 404 });
  }
  const subscriberId = subscribers[0].id;

  // Every row is validated and built before the first write. A resort id the
  // FK would reject must surface here, while the stored rows are still intact.
  let rows: Array<{ subscriber_id: string; resort_id: string; threshold_inches: number }> = [];
  if (resortIds.length > 0) {
    const resortsResp = await sbFetch(
      `/resorts?id=in.(${inList(resortIds)})&is_active=eq.true&select=id`
    );
    if (!resortsResp.ok) {
      return NextResponse.json({ error: "Failed to validate resorts" }, { status: 500 });
    }
    const active = new Set((await resortsResp.json() as Array<{ id: string }>).map((r) => r.id));
    rows = resortIds
      .filter((id) => active.has(id))
      .map((id) => ({ subscriber_id: subscriberId, resort_id: id, threshold_inches: thresholds[id] }));
    if (rows.length === 0) {
      return NextResponse.json({ error: "No valid resort IDs provided" }, { status: 400 });
    }
  }

  // Upsert first, prune second (there is no RPC to do both in one
  // transaction). Ordered this way, a failure at either step leaves the
  // subscriber with at least the resorts they asked for: a failed upsert
  // changes nothing, a failed prune leaves stale extras rather than nothing.
  if (rows.length > 0) {
    const upsertResp = await sbFetch("/alert_preferences?on_conflict=subscriber_id,resort_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(rows),
    });
    if (!upsertResp.ok) {
      return NextResponse.json({ error: "Failed to update preferences" }, { status: 500 });
    }
  }

  const keep = rows.length > 0 ? `&resort_id=not.in.(${inList(rows.map((r) => r.resort_id))})` : "";
  const pruneResp = await sbFetch(`/alert_preferences?subscriber_id=eq.${subscriberId}${keep}`, {
    method: "DELETE",
  });
  if (!pruneResp.ok) {
    return NextResponse.json({ error: "Failed to remove unselected resorts" }, { status: 500 });
  }

  // If no resorts selected, subscriber keeps their account but has no active alerts
  return NextResponse.json({ ok: true, resort_count: rows.length });
}
