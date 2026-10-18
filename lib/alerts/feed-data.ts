// ─────────────────────────────────────────────────────────────
// Row loading for the powder feeds. Resort and snow_reports rows come from
// the public anon client (public-read tables); powder_alert_log rows need
// the service role (deny-all RLS) and are only ever aggregated — a feed
// exposes "a forecast alert was logged for this resort", never who got it.
// ─────────────────────────────────────────────────────────────

import { supabase } from "@/lib/supabase";
import { serviceFetch } from "./service-fetch";
import { FEED_FORECAST_LOOKBACK_DAYS, FEED_LOOKBACK_DAYS, type FeedForecastLog, type FeedReport } from "./feeds";

export interface FeedResortRow {
  id: string;
  slug: string;
  name: string;
  lat: number;
  lng: number;
  created_at: string;
}

/** Null only for "no such active resort"; a failed query throws so ISR keeps the last good feed. */
export async function loadFeedResort(slug: string): Promise<FeedResortRow | null> {
  const { data, error } = await supabase
    .from("resorts")
    .select("id,slug,name,lat,lng,created_at")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return (data as FeedResortRow | null) ?? null;
}

/** Reports in the lookback window, newest first. Throws on a failed query. */
export async function loadFeedReports(resortId: string, now: Date = new Date()): Promise<FeedReport[]> {
  const since = new Date(now.getTime() - FEED_LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("snow_reports")
    .select("new_snow_24h,updated_at")
    .eq("resort_id", resortId)
    .gte("updated_at", since)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data as FeedReport[] | null) ?? [];
}

/**
 * Forecast alert rows for a resort (optionally one subscriber's). Fails
 * soft: the measured entries are the feed's core, a missing log read only
 * drops the forecast entries.
 */
export async function loadForecastLogs(
  resortId: string,
  options: { subscriberId?: string; now?: Date } = {},
): Promise<FeedForecastLog[]> {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - FEED_FORECAST_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const subscriber = options.subscriberId ? `&subscriber_id=eq.${encodeURIComponent(options.subscriberId)}` : "";
  try {
    const resp = await serviceFetch(
      `/powder_alert_log?resort_id=eq.${encodeURIComponent(resortId)}&kind=eq.forecast&alert_date=gte.${since}${subscriber}` +
        `&select=new_snow_inches,alert_date,storm_start_date,sent_at&order=alert_date.desc&limit=100`,
    );
    if (!resp.ok) return [];
    return (await resp.json()) as FeedForecastLog[];
  } catch {
    return [];
  }
}

export interface SubscriberFeedResort {
  resort: FeedResortRow;
  threshold: number;
}

/** The subscriber's followed resorts with thresholds. Throws on a failed read. */
export async function loadSubscriberResorts(subscriberId: string): Promise<SubscriberFeedResort[]> {
  const resp = await serviceFetch(
    `/alert_preferences?subscriber_id=eq.${encodeURIComponent(subscriberId)}&select=threshold_inches,resorts(id,slug,name,lat,lng,created_at)`,
  );
  if (!resp.ok) throw new Error(`[alerts/feed] preferences query failed: HTTP ${resp.status}`);
  const rows = (await resp.json()) as Array<{ threshold_inches: number; resorts: FeedResortRow | null }>;
  return rows
    .filter((row): row is { threshold_inches: number; resorts: FeedResortRow } => row.resorts !== null)
    .map((row) => ({ resort: row.resorts, threshold: row.threshold_inches }))
    .sort((a, b) => a.resort.name.localeCompare(b.resort.name));
}
