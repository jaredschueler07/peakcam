// ─────────────────────────────────────────────────────────────
// Server-side data access behind the /alerts/manage capability-token page
// and the /api/alerts/manage route. Both call these functions directly. The
// page used to fetch its own API over HTTP through NEXT_PUBLIC_SITE_URL
// (falling back to localhost), which turned a missing or apex-valued env var
// into an error page for every subscriber following an email link.
//
// Every read here throws on a non-2xx PostgREST response instead of degrading
// to an empty list. A manage page rendered from a failed preferences read
// would show zero resorts selected, and one click of "Save" would then wipe
// the subscriber's real alerts — an error page is the safer failure.
// ─────────────────────────────────────────────────────────────

import { inList, serviceFetch } from "./service-fetch";
import { clampThreshold } from "./validate";

export interface ManageSubscriber {
  id: string;
  email: string;
  created_at: string;
}

export interface ManagePreference {
  resort_id: string;
  threshold_inches: number;
}

export interface ManageResort {
  id: string;
  name: string;
  state: string;
  region: string;
  slug: string;
}

export interface ManageState {
  subscriber: ManageSubscriber;
  preferences: ManagePreference[];
  resorts: ManageResort[];
}

async function fetchRows<T>(path: string, what: string): Promise<T[]> {
  const resp = await serviceFetch(path);
  if (!resp.ok) {
    throw new Error(`[alerts/manage] ${what} query failed: HTTP ${resp.status}`);
  }
  return (await resp.json()) as T[];
}

/** Resolves a manage_token to its subscriber, or null when no row matches. */
export async function findSubscriberByToken(token: string): Promise<ManageSubscriber | null> {
  const rows = await fetchRows<ManageSubscriber>(
    `/alert_subscribers?manage_token=eq.${encodeURIComponent(token)}&select=id,email,created_at&limit=1`,
    "subscriber"
  );
  return rows[0] ?? null;
}

/**
 * Everything the manage page needs: the subscriber the token belongs to,
 * their current preferences, and the active-resort catalogue to pick from.
 * Null means the token matches no subscriber (invalid, or already
 * unsubscribed); a database failure throws.
 */
export async function getManageState(token: string): Promise<ManageState | null> {
  const subscriber = await findSubscriberByToken(token);
  if (!subscriber) return null;

  const [preferences, resorts] = await Promise.all([
    fetchRows<ManagePreference>(
      `/alert_preferences?subscriber_id=eq.${subscriber.id}&select=resort_id,threshold_inches`,
      "preferences"
    ),
    fetchRows<ManageResort>(
      `/resorts?is_active=eq.true&select=id,name,state,region,slug&order=name`,
      "resorts"
    ),
  ]);

  return { subscriber, preferences, resorts };
}

/** The subset of `resortIds` that exist and are active — the same gate subscribe-core applies. */
export async function findActiveResortIds(resortIds: string[]): Promise<string[]> {
  if (resortIds.length === 0) return [];
  const rows = await fetchRows<{ id: string }>(
    `/resorts?id=in.(${inList(resortIds)})&select=id&is_active=eq.true`,
    "active resorts"
  );
  return rows.map((r) => r.id);
}

/**
 * Replaces a subscriber's alert set: upsert the wanted rows first, then
 * delete whatever is no longer wanted. Ordered this way so that a failure at
 * any point leaves the subscriber with at least the alerts they already had —
 * never fewer. (The previous delete-then-insert left them with none whenever
 * the insert failed.) Returns false when either write is rejected.
 */
export async function replacePreferences(
  subscriberId: string,
  resortIds: string[],
  thresholds: Record<string, number>
): Promise<boolean> {
  if (resortIds.length > 0) {
    // on_conflict names the (subscriber_id, resort_id) unique constraint so an
    // already-followed resort gets its threshold updated rather than ignored.
    const upsert = await serviceFetch("/alert_preferences?on_conflict=subscriber_id,resort_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(
        resortIds.map((rid) => ({
          subscriber_id: subscriberId,
          resort_id: rid,
          threshold_inches: clampThreshold(thresholds[rid]),
        }))
      ),
    });
    if (!upsert.ok) {
      console.error("[alerts/manage] prefs upsert failed:", await upsert.text());
      return false;
    }
  }

  const keep = resortIds.length > 0 ? `&resort_id=not.in.(${inList(resortIds)})` : "";
  const remove = await serviceFetch(`/alert_preferences?subscriber_id=eq.${subscriberId}${keep}`, {
    method: "DELETE",
  });
  if (!remove.ok) {
    console.error("[alerts/manage] prefs delete failed:", await remove.text());
    return false;
  }

  return true;
}
