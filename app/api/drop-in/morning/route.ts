import { dailyMorningConditions } from "@/lib/game/server/morning-snapshot";
import { resortMorning } from "@/lib/game/server/ranked-conditions";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Schedule hourly with existing CRON_SECRET; only each resort's 07:00 hour captures. */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const now = Date.now();
  const captured: string[] = [];
  try {
    for (const slug of ["breckenridge", "heavenly", "ski-portillo"]) {
      if (resortMorning(now, slug).hour !== 7) continue;
      await dailyMorningConditions(slug, now);
      captured.push(slug);
    }
    return Response.json({ captured });
  } catch { return Response.json({ error: "Morning capture unavailable" }, { status: 503 }); }
}
