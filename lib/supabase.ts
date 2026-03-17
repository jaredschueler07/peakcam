import { createClient } from "@supabase/supabase-js";
import type { Resort, Cam, SnowReport, ResortWithData, LiveConditions, SnowQuality, ComfortLevel } from "./types";

// ─────────────────────────────────────────────────────────────
// Client
// ─────────────────────────────────────────────────────────────

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase environment variables. " +
    "Copy .env.local.example → .env.local and fill in your project values."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ─────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────

/** Fetch all active resorts with their latest snow report. */
export async function getAllResorts(): Promise<ResortWithData[]> {
  const { data: resorts, error: resortError } = await supabase
    .from("resorts")
    .select("*")
    .eq("is_active", true)
    .order("name");

  if (resortError) throw resortError;
  if (!resorts?.length) return [];

  const resortIds = resorts.map((r) => r.id);

  // Fetch snow reports and cams in parallel
  const [snowResult, camResult] = await Promise.all([
    // Use the latest_snow_reports view — DB-side DISTINCT ON (resort_id)
    supabase
      .from("latest_snow_reports")
      .select("*")
      .in("resort_id", resortIds),
    // Active cams only
    supabase
      .from("cams")
      .select("*")
      .in("resort_id", resortIds)
      .eq("is_active", true),
  ]);

  if (snowResult.error) throw snowResult.error;
  if (camResult.error) throw camResult.error;

  // Index snow reports by resort (view already returns one per resort)
  const snowByResort = new Map<string, SnowReport>();
  for (const s of snowResult.data ?? []) {
    snowByResort.set(s.resort_id, s);
  }

  // Group cams by resort using push() to avoid O(n²) spread
  const camsByResort = new Map<string, Cam[]>();
  for (const c of camResult.data ?? []) {
    if (!camsByResort.has(c.resort_id)) {
      camsByResort.set(c.resort_id, []);
    }
    camsByResort.get(c.resort_id)!.push(c);
  }

  return resorts.map((r) => ({
    ...r,
    snow_report: snowByResort.get(r.id) ?? null,
    cams: camsByResort.get(r.id) ?? [],
  }));
}

/** Fetch a single resort by slug with full cam list and latest snow report. */
export async function getResortBySlug(slug: string): Promise<ResortWithData | null> {
  const { data: resort, error: resortError } = await supabase
    .from("resorts")
    .select("*")
    .eq("slug", slug)
    .eq("is_active", true)
    .single();

  if (resortError || !resort) return null;

  const [snowResult, camResult] = await Promise.all([
    supabase
      .from("latest_snow_reports")
      .select("*")
      .eq("resort_id", resort.id)
      .maybeSingle(),
    supabase
      .from("cams")
      .select("*")
      .eq("resort_id", resort.id)
      .eq("is_active", true)
      .order("name"),
  ]);

  return {
    ...resort,
    snow_report: snowResult.data ?? null,
    cams: camResult.data ?? [],
  };
}

// ─────────────────────────────────────────────────────────────
// User-Verified Conditions
// ─────────────────────────────────────────────────────────────

/** Fetch live crowd-sourced conditions for a resort (last 12 hours). */
export async function getLiveConditions(resortId: string): Promise<LiveConditions | null> {
  const { data, error } = await supabase
    .from("resort_conditions_live")
    .select("*")
    .eq("resort_id", resortId)
    .maybeSingle();

  if (error) {
    console.warn("[PeakCam] Could not fetch live conditions:", error.message);
    return null;
  }
  return data;
}

/** Submit a condition vote (anonymous, session-based). */
export async function submitConditionVote(
  resortId: string,
  sessionId: string,
  snowQuality: SnowQuality | null,
  comfort: ComfortLevel | null,
  comment?: string
): Promise<{ ok: boolean; error?: string }> {
  // Rate limit: max 1 vote per resort per session per hour
  const { data: recent } = await supabase
    .from("condition_votes")
    .select("id")
    .eq("resort_id", resortId)
    .eq("session_id", sessionId)
    .gte("created_at", new Date(Date.now() - 3600_000).toISOString())
    .limit(1);

  if (recent && recent.length > 0) {
    return { ok: false, error: "You've already reported conditions here recently. Try again in an hour." };
  }

  const { error } = await supabase
    .from("condition_votes")
    .insert({
      resort_id: resortId,
      session_id: sessionId,
      snow_quality: snowQuality,
      comfort,
      comment: comment?.slice(0, 280) ?? null,
    });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// Static Params
// ─────────────────────────────────────────────────────────────

/** Fetch all resort slugs — used for generateStaticParams. */
export async function getAllResortSlugs(): Promise<string[]> {
  const { data, error } = await supabase
    .from("resorts")
    .select("slug")
    .eq("is_active", true);

  if (error) throw error;
  return data?.map((r) => r.slug) ?? [];
}
