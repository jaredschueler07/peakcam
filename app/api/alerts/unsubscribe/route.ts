import { NextRequest, NextResponse } from "next/server";
import { createSbFetch } from "@/lib/api/sb-fetch";
import { jsonError } from "@/lib/api/response";

const sbFetch = createSbFetch();

// DELETE /api/alerts/unsubscribe?token=xxx
// Removes the subscriber entirely (cascades to preferences + alert log)
export async function DELETE(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return jsonError("token is required", 400);
  }

  const resp = await sbFetch(
    `/alert_subscribers?manage_token=eq.${encodeURIComponent(token)}`,
    { method: "DELETE" }
  );

  if (!resp.ok) {
    const text = await resp.text();
    console.error("[alerts/unsubscribe] delete failed:", text);
    return jsonError("Failed to unsubscribe", 500);
  }

  return NextResponse.json({ ok: true });
}
