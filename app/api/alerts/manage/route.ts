import { NextRequest, NextResponse } from "next/server";
import {
  addWebhookDestination,
  findWebhookDestination,
  removeDestination,
} from "@/lib/alerts/destinations";
import {
  findActiveResortIds,
  findSubscriberByToken,
  getManageState,
  replacePreferences,
} from "@/lib/alerts/manage";
import { isTimeoutError, SERVICE_TIMEOUT } from "@/lib/alerts/service-fetch";
import { isUuid, parseManageAction, parseManageUpdate } from "@/lib/alerts/validate";
import { buildPowderTestEvent, deliverWebhook, validateWebhookUrl } from "@/lib/alerts/webhooks";

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
      // The flag is stored per row but offered as one switch; "on" when any
      // followed resort has it, which is the only state the UI can produce.
      opening_alerts: state.preferences.some((p) => p.opening_day),
      resorts: state.resorts,
      // Webhooks without their secrets (shown once at creation only) and
      // the subscriber's own Atom / iCal feed URLs.
      destinations: state.destinations,
      feeds: state.feeds,
    });
  } catch (err) {
    if (isTimeoutError(err)) return timeoutResponse();
    throw err;
  }
}

// PUT /api/alerts/manage
// Body: { token, resort_ids[], thresholds?: { [resort_id]: inches }, opening_alerts?: boolean }
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null);

  // Shape is validated in full before any database call — see parseManageUpdate.
  const parsed = parseManageUpdate(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { token, resortIds, thresholds, openingAlerts } = parsed.update;

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

    const ok = await replacePreferences(subscriber.id, activeIds, thresholds, openingAlerts);
    if (!ok) {
      return NextResponse.json({ error: "Failed to update preferences" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, resort_count: activeIds.length });
  } catch (err) {
    if (isTimeoutError(err)) return timeoutResponse();
    throw err;
  }
}

// POST /api/alerts/manage
// Body: { token, action: "add_webhook", url }
//    → 201 { destination, secret }   the secret is returned here and nowhere else
// Body: { token, action: "test_webhook", destination_id }
//    → 200 { ok, status, attempts }  one signed powder.test delivery, no retries
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = parseManageAction(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { action } = parsed;

  try {
    const subscriber = await findSubscriberByToken(action.token);
    if (!subscriber) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 404 });
    }

    if (action.kind === "add_webhook") {
      // Plain-http loopback targets are admitted only when the local e2e
      // run asks for it; production never sets the flag.
      const check = validateWebhookUrl(action.url, { allowInsecure: process.env.ALERT_WEBHOOK_ALLOW_LOOPBACK === "1" });
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
      const result = await addWebhookDestination(subscriber.id, check.url);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
      return NextResponse.json({ ok: true, destination: result.destination, secret: result.secret }, { status: 201 });
    }

    const destination = await findWebhookDestination(subscriber.id, action.destinationId);
    if (!destination) {
      return NextResponse.json({ error: "No such webhook" }, { status: 404 });
    }
    const delivery = await deliverWebhook({
      url: destination.target,
      secret: destination.secret,
      body: JSON.stringify(buildPowderTestEvent(new Date().toISOString())),
      maxAttempts: 1,
    });
    return NextResponse.json(
      { ok: delivery.ok, status: delivery.status, attempts: delivery.attempts, ...(delivery.error ? { error: delivery.error } : {}) },
      { status: delivery.ok ? 200 : 502 },
    );
  } catch (err) {
    if (isTimeoutError(err)) return timeoutResponse();
    throw err;
  }
}

// DELETE /api/alerts/manage?token=xxx&destination=<uuid>
// Removes one webhook. (Removing the whole subscription is /api/alerts/unsubscribe.)
export async function DELETE(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const destinationId = request.nextUrl.searchParams.get("destination");
  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }
  if (!isUuid(destinationId)) {
    return NextResponse.json({ error: "destination must be a destination UUID" }, { status: 400 });
  }

  try {
    const subscriber = await findSubscriberByToken(token);
    if (!subscriber) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 404 });
    }
    const removed = await removeDestination(subscriber.id, destinationId.toLowerCase());
    if (!removed) {
      return NextResponse.json({ error: "No such webhook" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isTimeoutError(err)) return timeoutResponse();
    throw err;
  }
}
