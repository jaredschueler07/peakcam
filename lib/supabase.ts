import { createClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import type { Resort, Cam, SnowReport, ResortWithData, LiveConditions, SnowQuality, ComfortLevel, UserCondition, PowderProbability, PowderProbabilityForecast, PowderProbabilityWindow, ResortStationJoined, StationObservation, StationRole, StationRow } from "./types";
import type { ResortOpening } from "./openings";
import type { StationNormalsSummary } from "./resort-faq";
import { withResolvedCamNames } from "./cam-name";
import { clampHours, pickResortTimeline, shapeTimeline, toFrame, MAX_TIMELINE_HOURS, type CamStillRow, type CamTimeline, type CamTimelineFrame } from "./cam-timeline";

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

/**
 * Per-attempt fetch timeout. 8 s at runtime keeps a stuck connection from
 * holding an ISR revalidation (see withFetchTimeout). During `next build`
 * the 148+ prerenders share PostgREST's 10-connection pool with the Mac
 * mini's jobs (stills every 15 min, hourly stations sync, the daily cam
 * health check's 640 PATCHes); a burst from those queued build reads past
 * 8 s on 2026-10-20 01:51 UTC with an otherwise idle database. A build has
 * no user waiting, so it tolerates a long wait better than a failed deploy.
 */
const IS_NEXT_BUILD =
  process.env.NEXT_PHASE === "phase-production-build" || process.env.npm_lifecycle_event === "build";
const SUPABASE_FETCH_TIMEOUT_MS = IS_NEXT_BUILD ? 25_000 : 8_000;
const RESORT_CATALOG_REVALIDATE_SECONDS = 60 * 60;
// Stations refresh hourly on the mini; a 15-minute cache keeps "age" honest without a query per request.
const PUBLIC_API_STATIONS_REVALIDATE_SECONDS = 15 * 60;

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

/** Status codes PostgREST and the Supabase gateway return while they are briefly unavailable. */
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const RETRY_DELAYS_MS = [1_000, 3_000, 6_000];

/**
 * Retries idempotent requests (GET/HEAD) that fail transiently: a 502/503/504
 * from the gateway, a network error, or the per-attempt timeout above.
 *
 * Why: PostgREST answers 503 `PGRST002` ("Could not query the database for the
 * schema cache") for roughly a minute after any DDL on the project, and the
 * schema-cache queries themselves took 13-20 s on 2026-10-20 01:33 UTC. Vercel
 * builds that happened to prerender in that window failed on the 8 s abort
 * even though the database itself was idle; Next's own
 * `staticGenerationRetryCount` could not help because the whole retry budget
 * elapsed inside the outage. Three retries with 1/3/6 s backoff cover that
 * window at the cost of at most ~34 s on a request that would have failed
 * anyway. Writes are never retried. A caller-supplied signal that aborts
 * stops the retries immediately.
 */
export function withFetchRetry(fetchImpl: typeof fetch, delays: readonly number[] = RETRY_DELAYS_MS): typeof fetch {
  return async (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const idempotent = method === "GET" || method === "HEAD";
    let attempt = 0;
    for (;;) {
      try {
        const res = await fetchImpl(input, init);
        if (!idempotent || !RETRYABLE_STATUS.has(res.status) || attempt >= delays.length) return res;
      } catch (err) {
        if (!idempotent || attempt >= delays.length || init?.signal?.aborted) throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      attempt += 1;
    }
  };
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: withFetchRetry(withFetchTimeout(fetch, SUPABASE_FETCH_TIMEOUT_MS)) },
});

// ─────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────

/**
 * Share a cold catalog load between overlapping requests in this runtime.
 * Next's Data Cache below handles reuse across requests and function instances;
 * this promise only lives for the duration of a load and is cleared on success
 * or failure, so it cannot extend the data freshness window or retain errors.
 */
function singleFlight<T>(load: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | undefined;
  return () => {
    if (inFlight) return inFlight;

    const current = Promise.resolve().then(load);
    inFlight = current;
    current.then(
      () => { if (inFlight === current) inFlight = undefined; },
      () => { if (inFlight === current) inFlight = undefined; },
    );
    return current;
  };
}

/** Fetch all active resorts with their latest snow report. */
async function fetchAllResorts(): Promise<ResortWithData[]> {
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

// This is public, anon-readable catalog data: it contains no session-specific
// rows or credentials. Persist it across routes/instances for the same one-hour
// window as their ISR pages. Next's cache writes only a successfully resolved
// value; failed cold loads still throw and stale cache entries are served while
// Next retries revalidation. During ISR, a failed refresh can therefore extend
// the age of the last good value until a later refresh succeeds. The process-local
// single-flight above also avoids duplicate PostgREST work when several cold
// renders overlap in one runtime.
const fetchAllResortsSingleFlight = singleFlight(fetchAllResorts);
const getAllResortsCached = unstable_cache(
  () => fetchAllResortsSingleFlight(),
  ["peakcam:get-all-resorts:v1", supabaseUrl],
  { revalidate: RESORT_CATALOG_REVALIDATE_SECONDS, tags: ["peakcam-resort-catalog"] },
);

export function getAllResorts(): Promise<ResortWithData[]> {
  return getAllResortsCached();
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
// Opening dates
// ─────────────────────────────────────────────────────────────

/** PostgREST's "relation does not exist" — the table is missing, not unreachable. */
const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01"]);

/**
 * Every `resort_openings` row (one per resort, public-read — migration 020).
 * /opening-dates joins these to getAllResorts() in lib/openings.ts.
 *
 * A failed query throws so the ISR revalidation fails and the last good page
 * keeps serving (same policy as getAllResorts). The one exception is a
 * database that has not run migration 020 yet: that is "no dates known",
 * not an outage, so it returns [] — the page then shows every resort as TBA
 * instead of failing the build.
 */
export async function getResortOpenings(): Promise<ResortOpening[]> {
  const { data, error } = await supabase
    .from("resort_openings")
    .select("*");

  if (error) {
    if (MISSING_TABLE_CODES.has(error.code)) {
      console.warn("[PeakCam] resort_openings table missing — apply migration 020; showing every resort as TBA");
      return [];
    }
    throw error;
  }
  return data ?? [];
}

// ─────────────────────────────────────────────────────────────
// Powder probabilities (WeatherNext 3, migration 021)
// ─────────────────────────────────────────────────────────────

function toPowderWindow(row: PowderProbability): PowderProbabilityWindow {
  return {
    window_kind: row.window_kind,
    valid_start: row.valid_start,
    valid_end: row.valid_end,
    p_ge_6in: row.p_ge_6in,
    p_ge_8in: row.p_ge_8in,
    p_ge_12in: row.p_ge_12in,
    p10_snow_in: row.p10_snow_in,
    p50_snow_in: row.p50_snow_in,
    p90_snow_in: row.p90_snow_in,
    degraded: row.degraded,
  };
}

/**
 * Latest derived powder probabilities for one resort, grouped by
 * window (migration 021's `latest_powder_probabilities` view).
 *
 * Optional enrichment, never core data: every failure mode returns
 * null so callers render nothing. That covers a database without
 * migration 021 yet (MISSING_TABLE_CODES), the pre-gate RLS posture
 * (zero rows until calibration + terms review pass), a resort with
 * no forecast, and a partial run missing its `next_72h` row. A
 * `best_7d` row is only paired when it comes from the same run and
 * method as the `next_72h` row — mixing runs would pair one run's
 * probabilities with another run's dates. Freshness is the caller's
 * decision: runs disseminate ~7h45m after init, so surface
 * `model_init_at`; windows anchor at `horizon_start_at`, not "now".
 * No UI calls this yet.
 */
export async function getPowderProbabilities(resortId: string): Promise<PowderProbabilityForecast | null> {
  const { data, error } = await supabase
    .from("latest_powder_probabilities")
    .select("*")
    .eq("resort_id", resortId);

  if (error) {
    if (MISSING_TABLE_CODES.has(error.code)) {
      console.warn("[PeakCam] latest_powder_probabilities missing — apply migration 021; powder probabilities unavailable");
    } else {
      console.warn("[PeakCam] Could not fetch powder probabilities:", error.message);
    }
    return null;
  }

  const rows = (data ?? []) as PowderProbability[];
  const next = rows.find((r) => r.window_kind === "next_72h");
  if (!next) return null;
  const best = rows.find(
    (r) => r.window_kind === "best_7d"
      && r.model_init_at === next.model_init_at
      && r.method_version === next.method_version,
  );

  return {
    resort_id: next.resort_id,
    model_init_at: next.model_init_at,
    horizon_start_at: next.horizon_start_at,
    computed_at: next.computed_at,
    probability_kind: next.probability_kind,
    method_version: next.method_version,
    next72h: toPowderWindow(next),
    best7d: best ? toPowderWindow(best) : null,
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
// User Conditions Reports
// ─────────────────────────────────────────────────────────────

/** Fetch recent user-submitted conditions reports for a resort (last 48 hours, unflagged). */
export async function getUserConditions(resortId: string, limit = 10): Promise<UserCondition[]> {
  const { data, error } = await supabase
    .from("user_conditions")
    .select("*")
    .eq("resort_id", resortId)
    .eq("is_flagged", false)
    .gte("created_at", new Date(Date.now() - 48 * 3600_000).toISOString())
    .order("created_at", { ascending: false })
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

export interface ResortElevationRow {
  base_ft: number | null;
  summit_ft: number | null;
}

async function fetchResortElevationIndex(): Promise<Record<string, ResortElevationRow>> {
  // Migration 025 made resorts.elevation_base_ft/summit_ft the canonical
  // home; resort_metadata (migration 007) is the legacy copy and only fills a
  // gap the profile row leaves. A missing legacy table is not an outage.
  const [profileRes, legacyRes] = await Promise.all([
    supabase.from("resorts").select("id, elevation_base_ft, elevation_summit_ft").eq("is_active", true),
    supabase.from("resort_metadata").select("resort_id, elevation_base_ft, elevation_summit_ft"),
  ]);
  if (profileRes.error) throw profileRes.error;
  if (legacyRes.error && !MISSING_TABLE_CODES.has(legacyRes.error.code)) throw legacyRes.error;
  const out: Record<string, ResortElevationRow> = {};
  for (const row of legacyRes.data ?? []) {
    out[row.resort_id] = { base_ft: row.elevation_base_ft ?? null, summit_ft: row.elevation_summit_ft ?? null };
  }
  for (const row of profileRes.data ?? []) {
    const legacy = out[row.id];
    out[row.id] = {
      base_ft: row.elevation_base_ft ?? legacy?.base_ft ?? null,
      summit_ft: row.elevation_summit_ft ?? legacy?.summit_ft ?? null,
    };
  }
  return out;
}

/**
 * Base/summit elevation for every resort, keyed by resort id: the `resorts`
 * profile columns first, the legacy `resort_metadata` row where the profile
 * is blank. One pass for the whole catalogue (the public API serialises all
 * resorts per revalidation), cached alongside the catalogue for the same
 * window and tag. A failed query throws like getAllResorts so the ISR route
 * keeps serving its last good document.
 */
export const getResortElevationIndex = unstable_cache(
  fetchResortElevationIndex,
  ["peakcam:resort-elevations:v2", supabaseUrl],
  { revalidate: RESORT_CATALOG_REVALIDATE_SECONDS, tags: ["peakcam-resort-catalog"] },
);

// ─────────────────────────────────────────────────────────────
// Station layer (migration 026): each resort's stations with the newest
// observation per station. One query for the whole catalogue through
// PostgREST's embedded ordering/limit, so the API, the resort page and the
// MCP tool share a 15-minute cache like the catalogue. A database without
// migration 026 yet returns an empty index rather than failing the page.
// ─────────────────────────────────────────────────────────────

const RESORT_STATIONS_SELECT =
  "resort_id, role, distance_km, rank, " +
  "station:stations!inner(id, source, source_id, name, lat, lng, elevation_ft, kind, " +
  "station_observations(station_id, observed_at, snow_depth_in, swe_in, new_snow_in, temp_f, wind_mph))";

interface ResortStationQueryRow {
  resort_id: string;
  role: StationRole;
  distance_km: number | string | null;
  rank: number;
  station: StationRow & { station_observations: Array<Omit<StationObservation, "source_payload">> | null };
}

async function fetchResortStationsIndex(): Promise<Record<string, ResortStationJoined[]>> {
  const { data, error } = await supabase
    .from("resort_stations")
    .select(RESORT_STATIONS_SELECT)
    .neq("role", "approach")
    .order("rank", { ascending: true })
    .order("observed_at", { referencedTable: "stations.station_observations", ascending: false })
    .limit(1, { referencedTable: "stations.station_observations" });
  if (error) {
    if (MISSING_TABLE_CODES.has(error.code)) return {};
    throw error;
  }
  const out: Record<string, ResortStationJoined[]> = {};
  for (const row of (data ?? []) as unknown as ResortStationQueryRow[]) {
    if (!row.station) continue;
    const { station_observations, ...station } = row.station;
    const latest = station_observations?.[0] ?? null;
    const num = (v: number | string | null | undefined) => (v == null ? null : Number(v));
    (out[row.resort_id] ??= []).push({
      role: row.role,
      distance_km: num(row.distance_km),
      rank: row.rank,
      station: { ...station, elevation_ft: num(station.elevation_ft) },
      latest: latest
        ? {
            station_id: latest.station_id,
            observed_at: latest.observed_at,
            snow_depth_in: num(latest.snow_depth_in),
            swe_in: num(latest.swe_in),
            new_snow_in: num(latest.new_snow_in),
            temp_f: num(latest.temp_f),
            wind_mph: num(latest.wind_mph),
            source_payload: null,
          }
        : null,
    });
  }
  return out;
}

/** Stations and their newest observation for every resort, keyed by resort id. Cached with the catalogue. */
export const getResortStationsIndex = unstable_cache(
  fetchResortStationsIndex,
  ["peakcam:resort-stations:v1", supabaseUrl],
  { revalidate: PUBLIC_API_STATIONS_REVALIDATE_SECONDS, tags: ["peakcam-resort-catalog"] },
);

/** Midpoint elevation (base+summit)/2 in feet from the cached index (profile columns, legacy fallback). Base-only or null when incomplete. */
export async function getResortElevationFt(resortId: string): Promise<number | null> {
  let index: Record<string, ResortElevationRow>;
  try {
    index = await getResortElevationIndex();
  } catch {
    return null;
  }
  const row = index[resortId];
  if (!row) return null;
  if (row.base_ft != null && row.summit_ft != null) return Math.round((row.base_ft + row.summit_ft) / 2);
  return row.base_ft ?? null;
}

// ─────────────────────────────────────────────────────────────
// Static Params
// ─────────────────────────────────────────────────────────────

export interface ResortSitemapEntry {
  slug: string;
  name: string;
  /** Raw `resorts.state` ("CO", "BC", "Chile") — groups the entry into its /ski-cams hub. */
  state: string;
  region: string;
  /** updated_at of the latest snow report, null when a resort has none. */
  lastReportAt: string | null;
}

/**
 * Slugs plus real last-report timestamps — used for sitemap lastModified.
 * Carries name/state/region too (it satisfies lib/hubs.ts HubResortLike), so
 * the sitemap can emit the /ski-cams hub URLs from the same two light queries
 * instead of the three-query getAllResorts().
 */
export async function getResortSitemapEntries(): Promise<ResortSitemapEntry[]> {
  const [resortsRes, reportsRes] = await Promise.all([
    supabase.from("resorts").select("id, slug, name, state, region").eq("is_active", true),
    supabase.from("latest_snow_reports").select("resort_id, updated_at"),
  ]);
  if (resortsRes.error) throw resortsRes.error;
  if (reportsRes.error) throw reportsRes.error;

  const lastByResort = new Map<string, string>(
    (reportsRes.data ?? []).map((r) => [r.resort_id, r.updated_at]),
  );
  return (resortsRes.data ?? []).map((r) => ({
    slug: r.slug,
    name: r.name,
    state: r.state,
    region: r.region,
    lastReportAt: lastByResort.get(r.id) ?? null,
  }));
}

async function fetchAllResortSlugs(): Promise<string[]> {
  const { data, error } = await supabase
    .from("resorts")
    .select("slug")
    .eq("is_active", true);

  if (error) throw error;
  return data?.map((r) => r.slug) ?? [];
}

// Single-flight: the resort page family (overview, snow-report, webcams) runs
// three generateStaticParams concurrently while `next build` collects page
// data, and they must all see the same slug list — one query, three callers.
const fetchAllResortSlugsSingleFlight = singleFlight(fetchAllResortSlugs);

/** Fetch all resort slugs — used for generateStaticParams. */
export function getAllResortSlugs(): Promise<string[]> {
  return fetchAllResortSlugsSingleFlight();
}

// ─────────────────────────────────────────────────────────────
// Cam still archive (migration 024)
// ─────────────────────────────────────────────────────────────

/**
 * Rows from the public `cam_still_timeline` view for one cam: everything in
 * the last `hours` plus the newest keeper of any age, deduplicated. The view
 * only exposes archive_allowed, active cams, so a cam switched off returns
 * nothing. Fails soft (null): the strip is decoration on a page whose core
 * data comes from getResortBySlug, and a missing view (migration 024 not
 * applied) must not fail the ISR revalidation.
 */
async function fetchCamStillRows(filter: { camId?: string; resortId?: string }, hours: number, now: Date): Promise<CamStillRow[] | null> {
  const since = new Date(now.getTime() - hours * 3_600_000).toISOString();
  const base = () => {
    let q = supabase.from("cam_still_timeline").select("*");
    if (filter.camId) q = q.eq("cam_id", filter.camId);
    if (filter.resortId) q = q.eq("resort_id", filter.resortId);
    return q;
  };
  const [win, keep] = await Promise.all([
    base().gte("captured_at", since).order("captured_at", { ascending: false }).limit(filter.camId ? MAX_TIMELINE_HOURS : 240),
    base().eq("keeper", true).order("captured_at", { ascending: false }).limit(filter.camId ? 1 : 12),
  ]);
  const error = win.error ?? keep.error;
  if (error) {
    if (MISSING_TABLE_CODES.has(error.code)) {
      console.warn("[PeakCam] cam_still_timeline missing — apply migration 024; cam history unavailable");
    } else {
      console.warn("[PeakCam] Could not fetch cam still timeline:", error.message);
    }
    return null;
  }
  const seen = new Set<number>();
  const rows: CamStillRow[] = [];
  for (const row of [...(win.data ?? []), ...(keep.data ?? [])] as CamStillRow[]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }
  return rows;
}

/**
 * Archived frames for one cam or one resort as public-URL frames, for the MCP
 * `get_cam_timeline` tool and the ask router: every in-window frame plus the
 * newest keeper per query, deduplicated, any order (the tool shapes them with
 * lib/cam-timeline shapeTimeline). Null when the view is unavailable.
 */
export async function getCamStillFrames(filter: { camId?: string; resortId?: string }, hours = 24): Promise<CamTimelineFrame[] | null> {
  const rows = await fetchCamStillRows(filter, clampHours(hours), new Date());
  return rows ? rows.map((row) => toFrame(row, supabaseUrl)) : null;
}

/**
 * Timeline for one archive-allowed cam: up to four frames from the last
 * `hours` (clamped to 48) and the newest storm keeper. Null when nothing is
 * on tape, the cam is not archive-allowed, or the query failed. This is the
 * function the MCP `get_cam_timeline(slug, camId, hours)` tool should call.
 */
export async function getCamTimeline(camId: string, hours = 24): Promise<CamTimeline | null> {
  const h = clampHours(hours);
  const now = new Date();
  const rows = await fetchCamStillRows({ camId }, h, now);
  if (!rows) return null;
  return shapeTimeline(rows, { camId, hours: h, now, supabaseUrl });
}

/**
 * The strip for a resort page: one query for every archived cam the resort
 * has, then the lead cam's timeline when it has frames, else the first cam
 * that does (lib/cam-timeline pickResortTimeline). `camOrder` is the page's
 * cam order, lead cam first.
 */
export async function getResortCamTimeline(resortId: string, camOrder: readonly string[], hours = 24): Promise<CamTimeline | null> {
  const h = clampHours(hours);
  const now = new Date();
  const rows = await fetchCamStillRows({ resortId }, h, now);
  if (!rows) return null;
  return pickResortTimeline(rows, camOrder, { hours: h, now, supabaseUrl });
}

/** Newest archived frame for a resort (any cam, any age) — the OG image background. Null when none. */
export async function getLatestArchivedStill(resortId: string): Promise<CamTimelineFrame | null> {
  const { data, error } = await supabase
    .from("cam_still_timeline")
    .select("*")
    .eq("resort_id", resortId)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (!MISSING_TABLE_CODES.has(error.code)) console.warn("[PeakCam] Could not fetch latest archived still:", error.message);
    return null;
  }
  return data ? toFrame(data as CamStillRow, supabaseUrl) : null;
}

// ─────────────────────────────────────────────────────────────
// Resort subpages (parity plan P2): history, normals, every cam's timeline
// ─────────────────────────────────────────────────────────────

/** One `snowpack_daily` row as the snow-report subpage reads it (migration 005). */
export interface SnowpackHistoryRow {
  date: string;
  station_id: string;
  snow_depth_in: number | null;
  swe_in: number | null;
  precip_accum_in: number | null;
  temp_max_f: number | null;
  temp_min_f: number | null;
  qc_flag: string;
}

const SNOWPACK_HISTORY_COLUMNS = "date,station_id,snow_depth_in,swe_in,precip_accum_in,temp_max_f,temp_min_f,qc_flag";

/**
 * The most recent `days` rows of `snowpack_daily` for a resort, newest first
 * (the same columns the MCP get_snow_history tool reads). Fails soft to []:
 * the history table is one section of the snow-report subpage, whose core
 * numbers come from getResortBySlug, and a missing table must not fail the
 * ISR revalidation.
 */
export async function getSnowpackHistory(resortId: string, days = 7): Promise<SnowpackHistoryRow[]> {
  const { data, error } = await supabase
    .from("snowpack_daily")
    .select(SNOWPACK_HISTORY_COLUMNS)
    .eq("resort_id", resortId)
    .order("date", { ascending: false })
    .limit(Math.max(1, Math.min(days, 60)));
  if (error) {
    if (!MISSING_TABLE_CODES.has(error.code)) console.warn("[PeakCam] Could not fetch snowpack history:", error.message);
    return [];
  }
  return (data ?? []) as unknown as SnowpackHistoryRow[];
}

/**
 * The peak of a station's 1991–2020 median snow depth across the water year
 * (`snotel_normals`, migration 005): the "typical season" figure the FAQ
 * quotes. Null for a resort without a station, a station the normals seed
 * does not cover, or a failed query (the FAQ then drops the question).
 */
export async function getStationNormalsSummary(stationId: string | null | undefined): Promise<StationNormalsSummary | null> {
  if (!stationId) return null;
  // Live-DB drift: migration 005 names these columns median_depth_in /
  // median_swe_in, but the table in prod (what scripts/seed-snotel-normals.ts
  // writes and scripts/snotel-sync.ts reads) has median_depth / median_swe.
  const { data, error } = await supabase
    .from("snotel_normals")
    .select("day_of_water_year, median_depth, median_swe")
    .eq("station_id", stationId)
    .not("median_depth", "is", null)
    .order("median_depth", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (!MISSING_TABLE_CODES.has(error.code)) console.warn("[PeakCam] Could not fetch station normals:", error.message);
    return null;
  }
  if (!data || data.median_depth == null) return null;
  const peak = Number(data.median_depth);
  if (!Number.isFinite(peak) || peak <= 0) return null;
  return {
    peakMedianDepthIn: peak,
    peakDayOfWaterYear: Number(data.day_of_water_year),
    peakMedianSweIn: data.median_swe == null ? null : Number(data.median_swe),
  };
}

/**
 * A timeline per archive-allowed cam for the webcams subpage: one query for
 * the resort, shaped per cam, in `camOrder`. Cams with nothing on tape are
 * absent from the map. Null when the view is missing or the query failed.
 */
export async function getResortCamTimelines(resortId: string, camOrder: readonly string[], hours = 24): Promise<Map<string, CamTimeline> | null> {
  const h = clampHours(hours);
  const now = new Date();
  const rows = await fetchCamStillRows({ resortId }, h, now);
  if (!rows) return null;
  const ids = new Set(rows.map((r) => r.cam_id));
  const out = new Map<string, CamTimeline>();
  for (const camId of [...camOrder.filter((id) => ids.has(id)), ...[...ids].filter((id) => !camOrder.includes(id))]) {
    const t = shapeTimeline(rows, { camId, hours: h, now, supabaseUrl });
    if (t) out.set(camId, t);
  }
  return out;
}
