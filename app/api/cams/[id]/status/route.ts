import { z } from "zod";
import { unstable_cache } from "next/cache";
import { supabase } from "@/lib/supabase";
import { brownriceCamera, checkBrownrice } from "@/lib/cam-status/brownrice";

const check = unstable_cache(async (embed: string) => ({ state: await checkBrownrice(embed), checkedAt: new Date().toISOString() }), ["camera-playlist-status-v1"], { revalidate: 60 });
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Invalid camera" }, { status: 400 });
  const { data: cam, error } = await supabase.from("cams").select("embed_type,embed_url,resort_id").eq("id", id).eq("is_active", true).maybeSingle();
  if (error) return Response.json({ error: "Camera check unavailable" }, { status: 503 });
  if (!cam) return Response.json({ error: "Camera not found" }, { status: 404 });
  const { data: resort } = await supabase.from("resorts").select("cam_page_url,website_url").eq("id", cam.resort_id).eq("is_active", true).maybeSingle();
  const raw = resort?.cam_page_url || resort?.website_url;
  let resortUrl: string | null = null;
  try { const u = new URL(raw ?? ""); if (u.protocol === "https:" && !u.username && !u.password) resortUrl = u.href; } catch { /* no fallback URL */ }
  const result = cam.embed_type === "iframe" && brownriceCamera(cam.embed_url ?? "") ? await check(cam.embed_url) : { state: "unknown", checkedAt: new Date().toISOString() };
  return Response.json({ ...result, resortUrl }, { headers: { "Cache-Control": "public, s-maxage=60, max-age=0" } });
}
