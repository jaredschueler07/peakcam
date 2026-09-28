import { NextRequest, NextResponse } from "next/server";
import { isTimeoutError, SERVICE_TIMEOUT, serviceFetch } from "@/lib/alerts/service-fetch";

// DELETE /api/alerts/unsubscribe?token=xxx
// Removes the subscriber entirely (cascades to preferences + alert log)
export async function DELETE(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  try {
    const resp = await serviceFetch(
      `/alert_subscribers?manage_token=eq.${encodeURIComponent(token)}`,
      { method: "DELETE" }
    );

    if (!resp.ok) {
      const text = await resp.text();
      console.error("[alerts/unsubscribe] delete failed:", text);
      return NextResponse.json({ error: "Failed to unsubscribe" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isTimeoutError(err)) {
      return NextResponse.json(SERVICE_TIMEOUT.body, { status: SERVICE_TIMEOUT.status });
    }
    throw err;
  }
}
