// app/api/cam-reports/submit/route.ts
//
// POST /api/cam-reports/submit
// Anonymous cam report submission. Session-based rate limit (1 per
// cam per session per 24h). Writes via service role; RLS denies
// direct anon writes.

import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { parseCamReportBody } from "@/lib/cam-reports/validate";
import { sendCamReportEmail } from "@/lib/cam-reports/email";

export const runtime = "nodejs";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase service role env not configured");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  const salt = process.env.CAM_REPORT_SALT;
  if (!salt) return null;
  const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  return crypto.createHash("sha256").update(`${ip}${salt}${today}`).digest("hex");
}

function extractIp(req: NextRequest): string | null {
  // Vercel sets x-forwarded-for; first hop is the original client.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip");
}

export async function POST(req: NextRequest) {
  // 1. Parse body
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // 2. Validate shape
  const parsed = parseCamReportBody(raw);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { cam_id, session_id, reason, resort_link_dead, suggested_url } = parsed.value;

  const supabase = getServiceClient();

  // 3. Verify cam exists and fetch context for the email
  const { data: cam, error: camErr } = await supabase
    .from("cams")
    .select("id, name, embed_type, embed_url, youtube_id, resort_id")
    .eq("id", cam_id)
    .single();

  if (camErr || !cam) {
    return NextResponse.json({ error: "Cam not found" }, { status: 404 });
  }

  const { data: resort, error: resortErr } = await supabase
    .from("resorts")
    .select("name, state")
    .eq("id", cam.resort_id)
    .single();

  if (resortErr || !resort) {
    return NextResponse.json({ error: "Resort not found" }, { status: 404 });
  }

  // 4. Rate limit: one report per cam per session per 24h
  const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: recent } = await supabase
    .from("cam_reports")
    .select("id")
    .eq("cam_id", cam_id)
    .eq("session_id", session_id)
    .gte("created_at", since24h)
    .limit(1);

  if (recent && recent.length > 0) {
    return NextResponse.json(
      { error: "Already reported recently" },
      { status: 429 },
    );
  }

  // 5. Insert
  const ip = extractIp(req);
  const ip_hash = hashIp(ip);
  const user_agent = (req.headers.get("user-agent") || "").slice(0, 500) || null;

  const { data: inserted, error: insertErr } = await supabase
    .from("cam_reports")
    .insert({
      cam_id,
      session_id,
      reason,
      resort_link_dead,
      suggested_url,
      user_agent,
      ip_hash,
    })
    .select("id, created_at")
    .single();

  if (insertErr || !inserted) {
    console.error("[cam-reports] insert failed:", insertErr?.message);
    return NextResponse.json({ error: "Failed to save report" }, { status: 500 });
  }

  // 6. Counts for email context — fire-and-forget, don't block client
  (async () => {
    try {
      const since7d = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
      const [{ count: n24 }, { count: n7d }] = await Promise.all([
        supabase
          .from("cam_reports")
          .select("id", { count: "exact", head: true })
          .eq("cam_id", cam_id)
          .gte("created_at", since24h)
          .neq("id", inserted.id),
        supabase
          .from("cam_reports")
          .select("id", { count: "exact", head: true })
          .eq("cam_id", cam_id)
          .gte("created_at", since7d),
      ]);

      await sendCamReportEmail({
        reportId: inserted.id,
        createdAt: inserted.created_at,
        sessionId: session_id,
        reason,
        resort_link_dead,
        suggested_url,
        cam: {
          id: cam.id,
          name: cam.name,
          embed_type: cam.embed_type,
          embed_url: cam.embed_url,
          youtube_id: cam.youtube_id,
        },
        resort: { name: resort.name, state: resort.state },
        priorReportsIn24h: n24 ?? 0,
        priorReportsIn7d: n7d ?? 1,
      });
    } catch (err) {
      console.error("[cam-reports] post-insert email/context failed:", err);
    }
  })();

  return NextResponse.json({ ok: true }, { status: 201 });
}
