import { NextRequest, NextResponse } from "next/server";
import {
  findActiveResortIds,
  findSubscriberByToken,
  getManageState,
  replacePreferences,
} from "@/lib/alerts/manage";
import { isTimeoutError, SERVICE_TIMEOUT } from "@/lib/alerts/service-fetch";
import { parseManageUpdate } from "@/lib/alerts/validate";

function timeoutResponse() {
  return NextResponse.json(SERVICE_TIMEOUT.body, { status: SERVICE_TIMEOUT.status });
}

// GET /api/alerts/manage?token=xxx
// Returns the subscriber's current preferences + all available resorts.
// The /alerts/manage page no longer calls this — it reads getManageState
// directly — but the route keeps the same response shape for other clients.
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  try {
    const state = await getManageState(token);
    if (!state) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 404 });
    }
    return NextResponse.json({
      email: state.subscriber.email,
      created_at: state.subscriber.created_at,
      preferences: state.preferences,
      resorts: state.resorts,
    });
  } catch (err) {
    if (isTimeoutError(err)) return timeoutResponse();
    throw err;
  }
}

// PUT /api/alerts/manage
// Body: { token, resort_ids[], thresholds?: { [resort_id]: inches } }
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null);

  // Shape is validated in full before any database call — see parseManageUpdate.
  const parsed = parseManageUpdate(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { token, resortIds, thresholds } = parsed.update;

  try {
    const subscriber = await findSubscriberByToken(token);
    if (!subscriber) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 404 });
    }

    // Unknown or inactive ids are dropped the way subscribe does. A request
    // that named resorts but matched none is rejected rather than treated as
    // "follow nothing" — that would silently delete every alert.
    const activeIds = await findActiveResortIds(resortIds);
    if (resortIds.length > 0 && activeIds.length === 0) {
      return NextResponse.json({ error: "No valid resort IDs provided" }, { status: 400 });
    }

    const ok = await replacePreferences(subscriber.id, activeIds, thresholds);
    if (!ok) {
      return NextResponse.json({ error: "Failed to update preferences" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, resort_count: activeIds.length });
  } catch (err) {
    if (isTimeoutError(err)) return timeoutResponse();
    throw err;
  }
}
