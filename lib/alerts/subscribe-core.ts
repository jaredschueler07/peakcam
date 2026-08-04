// ─────────────────────────────────────────────────────────────
// POST /api/alerts/subscribe — decision logic.
//
// Extracted from the route handler so both branches (new address vs. address
// that is already subscribed) can be tested without a database.
//
// The rule this file exists to enforce: a caller who supplies an email address
// proves nothing about owning it, so an address that is already subscribed is
// NEVER mutated by this endpoint. Before this change the handler upserted on
// `email` and then deleted every existing alert_preferences row for that
// subscriber, so anyone who knew a victim's address could silently repoint
// their powder alerts at the wrong mountains. Edits now require the
// manage_token, which only reaches the address's real owner — so the response
// to an already-subscribed address is to re-send that manage link.
//
// Both branches return the identical body, so the endpoint cannot be used to
// test whether an address is subscribed (account enumeration).
// ─────────────────────────────────────────────────────────────

export interface Subscriber {
  id: string;
  email: string;
  manage_token: string;
}

export interface ResortRef {
  id: string;
  name: string;
}

export interface SubscribeDeps {
  /** Service-role lookup by exact (lower-cased) email. */
  findSubscriberByEmail(email: string): Promise<Subscriber | null>;
  /** Service-role insert; returns the created row including its manage_token. */
  createSubscriber(email: string): Promise<Subscriber | null>;
  /** Filters the caller's resort_ids down to rows that exist and are active. */
  findActiveResorts(resortIds: string[]): Promise<ResortRef[]>;
  /** Inserts the initial preference rows for a brand-new subscriber. */
  insertPreferences(
    prefs: Array<{ subscriber_id: string; resort_id: string; threshold_inches: number }>
  ): Promise<boolean>;
  sendWelcomeEmail(params: {
    email: string;
    manageToken: string;
    resortNames: string[];
  }): Promise<void>;
  /** Sent to an address that is already subscribed, instead of editing it. */
  sendManageLinkEmail(params: { email: string; manageToken: string }): Promise<void>;
  logError(message: string, detail: unknown): void;
}

export interface SubscribeResult {
  status: number;
  body: Record<string, unknown>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MAX_RESORTS_PER_REQUEST = 200;

/**
 * The single success response. Deliberately carries no information about
 * whether the address was new, how many resorts were stored, or what the
 * subscriber's existing preferences are.
 */
const SUCCESS: SubscribeResult = {
  status: 200,
  body: {
    ok: true,
    message: "Check your email — we've sent you a link to confirm your alerts.",
  },
};

function clampThreshold(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 6;
  return Math.max(1, Math.min(48, Math.round(n)));
}

export async function handleSubscribe(
  body: unknown,
  deps: SubscribeDeps
): Promise<SubscribeResult> {
  const input = (body ?? {}) as {
    email?: unknown;
    resort_ids?: unknown;
    thresholds?: unknown;
  };

  if (typeof input.email !== "string" || !Array.isArray(input.resort_ids) || input.resort_ids.length === 0) {
    return {
      status: 400,
      body: { error: "email and at least one resort_id are required" },
    };
  }

  const email = input.email.toLowerCase().trim();
  if (!EMAIL_RE.test(email)) {
    return { status: 400, body: { error: "Invalid email address" } };
  }

  const resortIds = input.resort_ids
    .filter((id): id is string => typeof id === "string")
    .slice(0, MAX_RESORTS_PER_REQUEST);
  if (resortIds.length === 0) {
    return { status: 400, body: { error: "No valid resort IDs provided" } };
  }

  const thresholds: Record<string, unknown> =
    input.thresholds && typeof input.thresholds === "object"
      ? (input.thresholds as Record<string, unknown>)
      : {};

  // Resort validation happens before the subscriber lookup so that a malformed
  // request fails the same way regardless of whether the address is already
  // subscribed.
  const validResorts = await deps.findActiveResorts(resortIds);
  if (validResorts.length === 0) {
    return { status: 400, body: { error: "No valid resort IDs provided" } };
  }

  const existing = await deps.findSubscriberByEmail(email);

  // Do not touch a stored subscription. Mail the manage link to the address
  // itself — whoever reads that inbox is the only party who can act on it,
  // which is exactly the ownership proof this endpoint otherwise lacks.
  async function resendManageLink(subscriber: Subscriber): Promise<SubscribeResult> {
    try {
      await deps.sendManageLinkEmail({
        email: subscriber.email,
        manageToken: subscriber.manage_token,
      });
    } catch (err) {
      deps.logError("[alerts/subscribe] manage-link email failed:", err);
    }
    return SUCCESS;
  }

  if (existing) return resendManageLink(existing);

  const subscriber = await deps.createSubscriber(email);
  if (!subscriber) {
    // Either a real failure or a lost race against a concurrent signup for the
    // same address (email is unique). If a row exists now, the address is
    // subscribed and must not be edited — fall through to the manage link.
    const raced = await deps.findSubscriberByEmail(email);
    if (!raced) {
      return { status: 500, body: { error: "Failed to create subscription" } };
    }
    return resendManageLink(raced);
  }

  const prefsOk = await deps.insertPreferences(
    validResorts.map((r) => ({
      subscriber_id: subscriber.id,
      resort_id: r.id,
      threshold_inches: clampThreshold(thresholds[r.id]),
    }))
  );
  if (!prefsOk) {
    return { status: 500, body: { error: "Failed to save preferences" } };
  }

  try {
    await deps.sendWelcomeEmail({
      email: subscriber.email,
      manageToken: subscriber.manage_token,
      resortNames: validResorts.map((r) => r.name),
    });
  } catch (err) {
    deps.logError("[alerts/subscribe] welcome email failed:", err);
  }

  return SUCCESS;
}
