import { createClient } from "@supabase/supabase-js";
import type { Resort, Cam, SnowReport, ResortWithData, LiveConditions, SnowQuality, ComfortLevel, UserCondition } from "./types";
import { withResolvedCamNames } from "./cam-name";

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

const SUPABASE_FETCH_TIMEOUT_MS = 8_000;

/**
 * Wraps `fetch` so every request the client makes aborts after `ms` instead
 * of hanging indefinitely (the Aug 3 outage: a single stuck connection held
 * page renders for 8+ minutes). An abort rejects the fetch like any other
 * network failure, which — combined with the fail-closed error handling in
 * this file's query functions — means ISR keeps serving the last good stale
 * page instead of hanging the revalidation. Preserves any signal the caller
 * already supplied (none of the current call sites do, but this keeps the
 * wrapper correct if that changes).
 */
export function withFetchTimeout(fetchImpl: typeof fetch, ms: number): typeof fetch {
  return (input, init) =>
    fetchImpl(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(ms) });
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: withFetchTimeout(fetch, SUPABASE_FETCH_TIMEOUT_MS) },
});

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

  // Group cams by resort using push() to avoid O(n²) spread. Names are
  // resolved here so every consumer gets the same non-blank label without each
  // one re-parsing cam URLs at render time.
  const camsByResort = new Map<string, Cam[]>();
  for (const c of withResolvedCamNames<Cam>(camResult.data ?? [])) {
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

/**
 * Fetch a single resort by slug with full cam list and latest snow report.
 *
 * Returns `null` only for a genuine "no such resort" — the query succeeded
 * and returned zero rows. A failed query (network error, DB outage, etc.)
 * throws instead of returning `null`, so callers can tell "doesn't exist"
 * (real 404) apart from "couldn't check" (should fail closed, not 404).
 */
export async function getResortBySlug(slug: string): Promise<ResortWithData | null> {
  const { data: resort, error: resortError } = await supabase
    .from("resorts")
    .select("*")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();

  if (resortError) throw resortError;
  if (!resort) return null;

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

  if (snowResult.error) throw snowResult.error;
  if (camResult.error) throw camResult.error;

  return {
    ...resort,
    snow_report: snowResult.data ?? null,
    cams: withResolvedCamNames<Cam>(camResult.data ?? []),
  };
}

/**
 * The three outcomes of resolving a slug, kept distinct on purpose.
 *
 * `absent` is the only one a caller may turn into a 404. `errored` means we
 * couldn't check — 404ing on it would bake "this resort doesn't exist" into
 * the ISR cache for the length of the revalidate window, outliving the outage
 * that caused it.
 */
export type ResortNameLookup =
  | { status: "found"; name: string }
  | { status: "absent" }
  | { status: "errored" };

/**
 * Resolve a slug to a display name in one round trip.
 *
 * For callers that only need "is this a real resort, and what's it called?" —
 * `getResortBySlug` answers the same question but costs three queries (resort
 * + snow report + cams) to get there.
 */
export async function lookupResortNameBySlug(slug: string): Promise<ResortNameLookup> {
  const { data, error } = await supabase
    .from("resorts")
    .select("name")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.warn(`[PeakCam] Could not resolve resort slug "${slug}":`, error.message);
    return { status: "errored" };
  }
  return data?.name ? { status: "found", name: data.name } : { status: "absent" };
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
// User Conditions Reports
// ─────────────────────────────────────────────────────────────

/** Fetch recent user-submitted conditions reports for a resort (last 48 hours, unflagged). */
export async function getUserConditions(resortId: string, limit = 10): Promise<UserCondition[]> {
  const { data, error } = await supabase
    .from("user_conditions")
    .select("*")
    .eq("resort_id", resortId)
    .eq("is_flagged", false)
    .gte("submitted_at", new Date(Date.now() - 48 * 3600_000).toISOString())
    .order("submitted_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.warn("[PeakCam] Could not fetch user conditions:", error.message);
    return [];
  }
  return data ?? [];
}

// ─────────────────────────────────────────────────────────────
// Pipeline Queries
// ─────────────────────────────────────────────────────────────

/** Fetch blended conditions summary for a single resort. */
export async function getResortConditionsSummary(resortId: string) {
  const { data, error } = await supabase
    .from("resort_conditions_summary")
    .select("*")
    .eq("resort_id", resortId)
    .maybeSingle();

  if (error) {
    console.warn("[PeakCam] Could not fetch conditions summary:", error.message);
    return null;
  }
  return data;
}

/** Fetch all blended conditions summaries (one per resort). */
export async function getAllConditionsSummaries() {
  const { data, error } = await supabase
    .from("resort_conditions_summary")
    .select("*");

  if (error) {
    console.warn("[PeakCam] Could not fetch all conditions summaries:", error.message);
    return [];
  }
  return data ?? [];
}

/** Fetch a resort by slug with its metadata joined. */
export async function getResortWithMetadata(slug: string) {
  const { data, error } = await supabase
    .from("resorts")
    .select("*, resort_metadata(*)")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.warn("[PeakCam] Could not fetch resort with metadata:", error.message);
    return null;
  }
  return data;
}

/** Midpoint elevation (base+summit)/2 in feet, for resorts with resort_metadata. Returns base-only or null if incomplete/missing. */
export async function getResortElevationFt(resortId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from("resort_metadata")
    .select("elevation_base_ft, elevation_summit_ft")
    .eq("resort_id", resortId)
    .maybeSingle();

  if (error || !data) return null;
  const { elevation_base_ft, elevation_summit_ft } = data;
  if (elevation_base_ft != null && elevation_summit_ft != null) {
    return Math.round((elevation_base_ft + elevation_summit_ft) / 2);
  }
  return elevation_base_ft ?? null;
}

// ─────────────────────────────────────────────────────────────
// Static Params
// ─────────────────────────────────────────────────────────────

export interface ResortSitemapEntry {
  slug: string;
  /** updated_at of the latest snow report, null when a resort has none. */
  lastReportAt: string | null;
}

/** Slugs plus real last-report timestamps — used for sitemap lastModified. */
export async function getResortSitemapEntries(): Promise<ResortSitemapEntry[]> {
  const [resortsRes, reportsRes] = await Promise.all([
    supabase.from("resorts").select("id, slug").eq("is_active", true),
    supabase.from("latest_snow_reports").select("resort_id, updated_at"),
  ]);
  if (resortsRes.error) throw resortsRes.error;
  if (reportsRes.error) throw reportsRes.error;

  const lastByResort = new Map<string, string>(
    (reportsRes.data ?? []).map((r) => [r.resort_id, r.updated_at]),
  );
  return (resortsRes.data ?? []).map((r) => ({
    slug: r.slug,
    lastReportAt: lastByResort.get(r.id) ?? null,
  }));
}

/** Fetch all resort slugs — used for generateStaticParams. */
export async function getAllResortSlugs(): Promise<string[]> {
  const { data, error } = await supabase
    .from("resorts")
    .select("slug")
    .eq("is_active", true);

  if (error) throw error;
  return data?.map((r) => r.slug) ?? [];
}
