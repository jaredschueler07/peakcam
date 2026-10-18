// ─────────────────────────────────────────────────────────────
// alert_destinations (migration 023): where a subscriber's alerts go
// besides their email. Service-role access only — the table is deny-all
// under RLS and holds webhook signing secrets.
//
// Reads for the manage page never return `secret`; the one place it leaves
// the database is the trigger's delivery path.
// ─────────────────────────────────────────────────────────────

import { inList, serviceFetch } from "./service-fetch";
import {
  generateWebhookSecret,
  MAX_WEBHOOKS_PER_SUBSCRIBER,
  WEBHOOK_DISABLE_AFTER_FAILURES,
} from "./webhooks";

export type DestinationKind = "email" | "webhook";

/** What the manage page and GET /api/alerts/manage see. No secret. */
export interface DestinationView {
  id: string;
  kind: DestinationKind;
  target: string;
  created_at: string;
  last_delivered_at: string | null;
  failures: number;
  disabled_at: string | null;
}

/** What the trigger needs to deliver. */
export interface WebhookDestination extends DestinationView {
  subscriber_id: string;
  secret: string;
}

const VIEW_COLUMNS = "id,kind,target,created_at,last_delivered_at,failures,disabled_at";

/** PostgREST's "relation does not exist": migration 023 not applied yet. */
function isMissingTable(resp: Response): boolean {
  return resp.status === 404;
}

/**
 * A subscriber's destinations, newest first. A database without migration
 * 023 answers 404 for the table; that is "no destinations", not an error,
 * so the manage page keeps working through the deploy window.
 */
export async function listDestinations(subscriberId: string): Promise<DestinationView[]> {
  const resp = await serviceFetch(
    `/alert_destinations?subscriber_id=eq.${encodeURIComponent(subscriberId)}&select=${VIEW_COLUMNS}&order=created_at.desc`,
  );
  if (resp.ok) return (await resp.json()) as DestinationView[];
  if (isMissingTable(resp)) {
    console.error("[alerts/destinations] alert_destinations missing — apply migration 023");
    return [];
  }
  throw new Error(`[alerts/destinations] list failed: HTTP ${resp.status}`);
}

export type AddWebhookResult =
  | { ok: true; destination: DestinationView; secret: string }
  | { ok: false; status: 409 | 422 | 500 | 503; error: string };

/**
 * Registers a webhook URL and returns the secret exactly once — it is not
 * readable through any later request. Enforces the per-subscriber cap and
 * the (subscriber, kind, target) uniqueness the table carries.
 */
export async function addWebhookDestination(subscriberId: string, url: string): Promise<AddWebhookResult> {
  const existing = await listDestinations(subscriberId);
  if (existing.filter((d) => d.kind === "webhook").length >= MAX_WEBHOOKS_PER_SUBSCRIBER) {
    return { ok: false, status: 422, error: `At most ${MAX_WEBHOOKS_PER_SUBSCRIBER} webhooks per subscription` };
  }
  if (existing.some((d) => d.kind === "webhook" && d.target === url)) {
    return { ok: false, status: 409, error: "That webhook URL is already registered" };
  }

  const secret = generateWebhookSecret();
  const resp = await serviceFetch(`/alert_destinations?select=${VIEW_COLUMNS}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ subscriber_id: subscriberId, kind: "webhook", target: url, secret }),
  });
  if (resp.status === 409) return { ok: false, status: 409, error: "That webhook URL is already registered" };
  if (isMissingTable(resp)) {
    console.error("[alerts/destinations] alert_destinations missing — apply migration 023");
    return { ok: false, status: 503, error: "Webhooks are not available yet" };
  }
  if (!resp.ok) {
    console.error("[alerts/destinations] insert failed:", await resp.text());
    return { ok: false, status: 500, error: "Failed to save the webhook" };
  }
  const [row] = (await resp.json()) as DestinationView[];
  if (!row) return { ok: false, status: 500, error: "Failed to save the webhook" };
  return { ok: true, destination: row, secret };
}

/** Removes one destination belonging to the subscriber. False when nothing matched or the delete failed. */
export async function removeDestination(subscriberId: string, destinationId: string): Promise<boolean> {
  const resp = await serviceFetch(
    `/alert_destinations?id=eq.${encodeURIComponent(destinationId)}&subscriber_id=eq.${encodeURIComponent(subscriberId)}`,
    { method: "DELETE", headers: { Prefer: "return=representation" } },
  );
  if (!resp.ok) {
    console.error("[alerts/destinations] delete failed:", await resp.text());
    return false;
  }
  const rows = (await resp.json()) as unknown[];
  return rows.length > 0;
}

/** One destination with its secret, scoped to the subscriber — for the manage route's test delivery. */
export async function findWebhookDestination(subscriberId: string, destinationId: string): Promise<WebhookDestination | null> {
  const resp = await serviceFetch(
    `/alert_destinations?id=eq.${encodeURIComponent(destinationId)}&subscriber_id=eq.${encodeURIComponent(subscriberId)}&kind=eq.webhook&select=${VIEW_COLUMNS},subscriber_id,secret&limit=1`,
  );
  if (!resp.ok) return null;
  const rows = (await resp.json()) as WebhookDestination[];
  return rows[0] ?? null;
}

/**
 * Every enabled webhook for the given subscribers — the trigger's fan-out
 * read. Fails soft: a missing table or a failed read means no webhooks
 * this run, never a failed run (the emails still go).
 */
export async function loadWebhookDestinations(subscriberIds: string[]): Promise<WebhookDestination[]> {
  if (subscriberIds.length === 0) return [];
  try {
    const resp = await serviceFetch(
      `/alert_destinations?subscriber_id=in.(${inList(subscriberIds)})&kind=eq.webhook&disabled_at=is.null&select=${VIEW_COLUMNS},subscriber_id,secret`,
    );
    if (!resp.ok) {
      if (!isMissingTable(resp)) console.error(`[alerts/trigger] webhook destinations read failed: HTTP ${resp.status}`);
      return [];
    }
    return (await resp.json()) as WebhookDestination[];
  } catch (err) {
    console.error("[alerts/trigger] webhook destinations read threw:", err);
    return [];
  }
}

export interface DeliveryOutcomePatch {
  failures: number;
  last_delivered_at?: string;
  disabled_at?: string | null;
}

/**
 * The row update after one run's deliveries to a destination: success
 * resets the consecutive-failure count and stamps the delivery; failure
 * increments it and disables the destination at the tenth in a row.
 */
export function deliveryOutcomePatch(destination: { failures: number }, delivered: boolean, now: Date): DeliveryOutcomePatch {
  if (delivered) return { failures: 0, last_delivered_at: now.toISOString() };
  const failures = destination.failures + 1;
  return failures >= WEBHOOK_DISABLE_AFTER_FAILURES
    ? { failures, disabled_at: now.toISOString() }
    : { failures };
}

export async function recordDeliveryOutcome(destinationId: string, patch: DeliveryOutcomePatch): Promise<void> {
  try {
    const resp = await serviceFetch(`/alert_destinations?id=eq.${encodeURIComponent(destinationId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    if (!resp.ok) console.error(`[alerts/trigger] destination update failed: HTTP ${resp.status}`);
  } catch (err) {
    console.error("[alerts/trigger] destination update threw:", err);
  }
}
