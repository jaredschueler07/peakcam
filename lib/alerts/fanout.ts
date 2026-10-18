// ─────────────────────────────────────────────────────────────
// Webhook fan-out for one trigger run: every enabled webhook of every
// subscriber who has alerts this run gets one signed `powder.alert` event
// per resort. Destinations are processed in parallel and each event retries
// on its own (lib/alerts/webhooks.ts); the destination's consecutive-failure
// count moves once per run, not once per event.
//
// Delivery and bookkeeping are injectable so lib/alerts/fanout.test.ts
// covers the counting and the disable rule without network or database.
// ─────────────────────────────────────────────────────────────

import { deliveryOutcomePatch, recordDeliveryOutcome, type WebhookDestination } from "./destinations";
import { deliverWebhook, type PowderAlertEvent, type WebhookDeliveryResult } from "./webhooks";

export interface WebhookFanoutSummary {
  /** Enabled webhook rows among the alerted subscribers. */
  destinations: number;
  /** Events attempted (destinations × their subscriber's alerts). */
  attempted: number;
  /** Events that got a 2xx. */
  delivered: number;
  /** Events that exhausted their attempts. */
  failed: number;
  /** Destinations switched off this run (tenth consecutive failed run). */
  disabled: number;
  errors?: string[];
}

export interface FanoutDeps {
  deliver?: (options: { url: string; secret: string; body: string; deadline: number }) => Promise<WebhookDeliveryResult>;
  record?: (destinationId: string, patch: ReturnType<typeof deliveryOutcomePatch>) => Promise<void>;
  now?: () => Date;
}

export async function fanOutWebhooks(
  destinations: readonly WebhookDestination[],
  eventsBySubscriber: ReadonlyMap<string, readonly PowderAlertEvent[]>,
  deadline: number,
  deps: FanoutDeps = {},
): Promise<WebhookFanoutSummary> {
  const deliver = deps.deliver ?? ((options) => deliverWebhook(options));
  const record = deps.record ?? recordDeliveryOutcome;
  const now = deps.now ?? (() => new Date());

  const summary: WebhookFanoutSummary = { destinations: 0, attempted: 0, delivered: 0, failed: 0, disabled: 0 };
  const errors = new Set<string>();

  await Promise.all(
    destinations.map(async (destination) => {
      const events = eventsBySubscriber.get(destination.subscriber_id) ?? [];
      if (events.length === 0) return;
      summary.destinations++;

      const results = await Promise.all(
        events.map((event) => {
          summary.attempted++;
          return deliver({ url: destination.target, secret: destination.secret, body: JSON.stringify(event), deadline });
        }),
      );

      let allOk = true;
      for (const result of results) {
        if (result.ok) {
          summary.delivered++;
        } else {
          allOk = false;
          summary.failed++;
          errors.add(result.error ?? "delivery_failed");
        }
      }

      const patch = deliveryOutcomePatch(destination, allOk, now());
      if (patch.disabled_at) summary.disabled++;
      await record(destination.id, patch);
    }),
  );

  return errors.size > 0 ? { ...summary, errors: [...errors] } : summary;
}
