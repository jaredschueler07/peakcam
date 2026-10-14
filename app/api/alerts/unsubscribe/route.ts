import { NextRequest, NextResponse } from "next/server";

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

/** Removes the subscriber entirely (cascades to preferences + alert log). */
async function unsubscribe(token: string | null) {
  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  const resp = await sbFetch(
    `/alert_subscribers?manage_token=eq.${encodeURIComponent(token)}`,
    { method: "DELETE" }
  );

  if (!resp.ok) {
    const text = await resp.text();
    console.error("[alerts/unsubscribe] delete failed:", text);
    return NextResponse.json({ error: "Failed to unsubscribe" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/alerts/unsubscribe?token=xxx — the manage page's button.
export async function DELETE(request: NextRequest) {
  return unsubscribe(request.nextUrl.searchParams.get("token"));
}

// POST /api/alerts/unsubscribe?token=xxx — RFC 8058 one-click unsubscribe.
// This is the URL in every alert email's List-Unsubscribe header (lib/email.ts).
// Gmail and Yahoo require bulk senders to honour the mail client's own
// unsubscribe button, which POSTs here with no user interaction, so it must
// act immediately rather than return a confirmation page.
export async function POST(request: NextRequest) {
  return unsubscribe(request.nextUrl.searchParams.get("token"));
}
