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
  /** Opening-day email opt-in for this resort (migration 020). */
  opening_day: boolean;
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
    fetchPreferences(subscriber.id),
    fetchRows<ManageResort>(
      `/resorts?is_active=eq.true&select=id,name,state,region,slug&order=name`,
      "resorts"
    ),
  ]);

  return { subscriber, preferences, resorts };
}

/**
 * The subscriber's rows including `opening_day`. A database that has not run
 * migration 020 answers 400 for the unknown column; fall back to the original
 * two-column read with the flag off rather than turning every manage link
 * into an error page during the deploy window. Any other failure throws.
 */
async function fetchPreferences(subscriberId: string): Promise<ManagePreference[]> {
  const base = `/alert_preferences?subscriber_id=eq.${subscriberId}`;
  const resp = await serviceFetch(`${base}&select=resort_id,threshold_inches,opening_day`);
  if (resp.ok) return (await resp.json()) as ManagePreference[];
  if (resp.status !== 400) {
    throw new Error(`[alerts/manage] preferences query failed: HTTP ${resp.status}`);
  }
  console.error("[alerts/manage] opening_day column missing — apply migration 020; serving preferences with the flag off");
  const legacy = await fetchRows<Omit<ManagePreference, "opening_day">>(
    `${base}&select=resort_id,threshold_inches`,
    "preferences"
  );
  return legacy.map((row) => ({ ...row, opening_day: false }));
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
  thresholds: Record<string, number>,
  /** Opening-day flag for every row; undefined leaves each row's stored value alone. */
  openingDay?: boolean
): Promise<boolean> {
  if (resortIds.length > 0) {
    // on_conflict names the (subscriber_id, resort_id) unique constraint so an
    // already-followed resort gets its threshold updated rather than ignored.
    // merge-duplicates only touches the columns in the body, which is what
    // makes "openingDay undefined → unchanged" work.
    const rows = resortIds.map((rid) => ({
      subscriber_id: subscriberId,
      resort_id: rid,
      threshold_inches: clampThreshold(thresholds[rid]),
      ...(openingDay === undefined ? {} : { opening_day: openingDay }),
    }));
    const upsertRows = (body: unknown) =>
      serviceFetch("/alert_preferences?on_conflict=subscriber_id,resort_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(body),
      });

    let upsert = await upsertRows(rows);
    if (!upsert.ok && upsert.status === 400 && openingDay !== undefined) {
      // Pre-migration-020 database: the column does not exist yet. Save the
      // resorts and thresholds anyway (the subscriber's real intent) and say
      // so loudly — the flag is the only thing lost.
      console.error("[alerts/manage] opening_day column missing — apply migration 020; saving preferences without the flag");
      upsert = await upsertRows(rows.map(({ opening_day: _openingDay, ...row }) => row));
    }
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
