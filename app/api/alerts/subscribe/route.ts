import { NextRequest, NextResponse } from "next/server";
import { sendWelcomeEmail } from "@/lib/email";

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

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  if (!body?.email || !Array.isArray(body?.resort_ids) || body.resort_ids.length === 0) {
    return NextResponse.json(
      { error: "email and at least one resort_id are required" },
      { status: 400 }
    );
  }

  const email: string = body.email.toLowerCase().trim();
  const resortIds: string[] = body.resort_ids;
  // thresholds: { [resort_id]: inches } — defaults to 6
  const thresholds: Record<string, number> = body.thresholds ?? {};

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  // Upsert subscriber (idempotent on email)
  const subResp = await sbFetch("/alert_subscribers?on_conflict=email", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ email }),
  });

  if (!subResp.ok) {
    const text = await subResp.text();
    console.error("[alerts/subscribe] subscriber upsert failed:", text);
    return NextResponse.json({ error: "Failed to create subscription" }, { status: 500 });
  }

  const [subscriber] = await subResp.json();

  // Verify resort IDs exist
  const resortCheck = await sbFetch(
    `/resorts?id=in.(${resortIds.map((id) => `"${id}"`).join(",")})&select=id,name&is_active=eq.true`
  );
  const validResorts: Array<{ id: string; name: string }> = resortCheck.ok
    ? await resortCheck.json()
    : [];

  if (validResorts.length === 0) {
    return NextResponse.json({ error: "No valid resort IDs provided" }, { status: 400 });
  }

  // Delete existing preferences and re-insert (simplest idempotent approach)
  await sbFetch(`/alert_preferences?subscriber_id=eq.${subscriber.id}`, {
    method: "DELETE",
  });

  const prefs = validResorts.map((r) => ({
    subscriber_id: subscriber.id,
    resort_id: r.id,
    threshold_inches: Math.max(1, Math.min(48, thresholds[r.id] ?? 6)),
  }));

  const prefsResp = await sbFetch("/alert_preferences", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify(prefs),
  });

  if (!prefsResp.ok) {
    const text = await prefsResp.text();
    console.error("[alerts/subscribe] prefs insert failed:", text);
    return NextResponse.json({ error: "Failed to save preferences" }, { status: 500 });
  }

  // Send welcome email (non-blocking — don't fail the request if email fails)
  try {
    await sendWelcomeEmail({
      email: subscriber.email,
      manageToken: subscriber.manage_token,
      resortNames: validResorts.map((r) => r.name),
    });
  } catch (err) {
    console.error("[alerts/subscribe] welcome email failed:", err);
  }

  return NextResponse.json({ ok: true, resort_count: validResorts.length });
}
